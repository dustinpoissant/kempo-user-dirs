import { mkdir, writeFile, rm, stat } from 'fs/promises';
import path from 'path';
import { sql, eq } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { createUser, deleteUser, createSession } from 'kempo/server/sdk.js';
import {
  storeUpload, listFiles, deleteFile,
  createDirectory, listDirectories, deleteDirectory,
  directoryPath, FILES_ROOT,
} from 'kempo-files/sdk';
import { kempoUserDir, kempoUserDirPlan } from '../server/db/schema.js';
import {
  getSpace, provisionSpace, updateSpace, deprovisionSpace, listSpaces, describeSpace,
} from '../server/utils/spaces/spaces.js';
import { resolveSpace, requireWithinSpace, requireFileWithinSpace } from '../server/utils/spaces/scope.js';
import { createPlan, listPlans, deletePlan, defaultPlan } from '../server/utils/plans/plans.js';
import { measureSpace, recalculateUsage, reserveBytes } from '../server/utils/quota/usage.js';
import beforeUpload from '../hooks/file-before-upload.js';
import fileUploaded from '../hooks/file-uploaded.js';
import beforeDownload from '../hooks/file-before-download.js';

/*
  The whole extension against a real database and a real kempo-files library.

  The unit suites cover the arithmetic; what only shows up here is everything that involves two
  systems agreeing — a folder chain that has to resolve back to the right owner, a quota that has
  to be enforced through a hook fired by somebody else's route, a space that has to survive being
  removed and re-created without losing its contents.

  It reaches kempo-files only through its SDK, never its tables. That is the same boundary the
  production code keeps, and testing across it would prove the wrong thing works.

  Requires a reachable Postgres carrying kempo's schema, kempo-files' and this extension's
  (`npx drizzle-kit push --force`). Skips itself when there is none rather than failing.
*/

const databaseReachable = await db.execute(sql`select 1`).then(() => true).catch(() => false);

const skipped = reason => ({
  'data layer (SKIPPED)': async ({ pass }) => pass(`skipped: ${reason}`),
});

const purge = async () => {
  await db.delete(kempoUserDir).catch(() => {});
  await db.delete(kempoUserDirPlan).catch(() => {});

  const [, files] = await listFiles({ limit: 1000 });
  for(const file of files?.files || []) await deleteFile({ id: file.id }).catch(() => {});

  /*
    Deepest first: kempo-files refuses to delete a folder that still has anything in it, which is
    correct behaviour and means the order here matters.
  */
  const [, data] = await listDirectories({ all: true });
  const rows = data?.directories || [];
  const byId = new Map(rows.map(row => [row.id, row]));
  const depthOf = row => {
    let count = 0;
    let current = row;
    while(current?.parentId){ current = byId.get(current.parentId); count++; }
    return count;
  };

  for(const row of [...rows].sort((a, b) => depthOf(b) - depthOf(a))){
    await deleteDirectory({ id: row.id }).catch(() => {});
  }
};

const makeUser = async label => {
  const [error, created] = await createUser({
    name: `Test ${label}`,
    email: `zz-user-dirs-${label}-${Date.now()}@example.test`,
    password: 'TestPassword123!',
  });
  if(error) throw new Error(error.msg);
  return created.user?.id || created.id;
};

const bytes = size => Buffer.alloc(size, 0x61);

const sessionFor = async userId => {
  const [error, created] = await createSession(userId);
  if(error) throw new Error(error.msg);
  return { cookies: { session_token: created.sessionToken } };
};

const refusal = async work => {
  try {
    await work();
    return null;
  } catch(error) {
    return error;
  }
};

const suite = {
  'provisioning creates a folder named after the user, inside the root folder': async ({ pass, fail }) => {
    await purge();
    const userId = await makeUser('provision');

    try {
      const [error, space] = await provisionSpace({ userId });
      if(error) return fail(error.msg);

      const [, roots] = await listDirectories({ parentId: null });
      const root = roots.directories.find(directory => directory.name === 'users');
      if(!root) return fail('no "users" root folder was created');

      const [, children] = await listDirectories({ parentId: root.id });
      const home = children.directories.find(directory => directory.id === space.directoryId);
      if(!home) return fail('the space folder is not inside the root folder');

      /*
        Named with the user's id rather than their name or email: both of those change, and a
        rename on disk this extension did not perform is how a space silently loses its contents.
      */
      if(home.name !== userId) return fail(`folder is named "${home.name}", expected the user id`);

      const [pathError, absolute] = await directoryPath(space.directoryId);
      if(pathError) return fail(pathError.msg);
      await stat(absolute);

      pass('the folder exists on disk, in the right place, under the right name');
    } finally {
      await deleteUser(userId);
    }
  },

  'provisioning twice returns the same space rather than a second one': async ({ pass, fail }) => {
    await purge();
    const userId = await makeUser('idempotent');

    try {
      const [, first] = await provisionSpace({ userId });
      const [error, second] = await provisionSpace({ userId });
      if(error) return fail(error.msg);
      if(first.id !== second.id) return fail('a second space was created');

      const rows = await db.select().from(kempoUserDir).where(eq(kempoUserDir.userId, userId));
      if(rows.length !== 1) return fail(`expected 1 row, found ${rows.length}`);

      pass('lazy provisioning is safe to call from anywhere');
    } finally {
      await deleteUser(userId);
    }
  },

  'a folder resolves back to the space that owns it, however deep': async ({ pass, fail }) => {
    await purge();
    const userId = await makeUser('scope');

    try {
      const [, space] = await provisionSpace({ userId });

      const [, one] = await createDirectory({ name: 'projects', parentId: space.directoryId, ownerId: userId });
      const [, two] = await createDirectory({ name: 'archive', parentId: one.id, ownerId: userId });

      const [error, owner] = await resolveSpace(two.id);
      if(error) return fail(error.msg);
      if(owner?.id !== space.id) return fail('a nested folder did not resolve to its space');

      const [withinError] = await requireWithinSpace(space, two.id);
      if(withinError) return fail(`containment check refused a folder in its own space: ${withinError.msg}`);

      pass('containment follows the folder chain, not a path string');
    } finally {
      await deleteUser(userId);
    }
  },

  'one space cannot reach into another': async ({ pass, fail }) => {
    await purge();
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');

    try {
      const [, aliceSpace] = await provisionSpace({ userId: alice });
      const [, bobSpace] = await provisionSpace({ userId: bob });

      const [, bobFolder] = await createDirectory({ name: 'private', parentId: bobSpace.directoryId, ownerId: bob });

      /*
        This is the check the whole extension rests on. Passing another user's folder id is an
        entirely ordinary-looking request; nothing else would stop it.
      */
      const [error] = await requireWithinSpace(aliceSpace, bobFolder.id);
      if(!error) return fail("alice's space accepted a folder inside bob's");
      if(error.code !== 404) return fail(`expected a 404, got ${error.code}`);

      const [, file] = await storeUpload({
        name: 'secret.txt', data: bytes(10), directoryId: bobFolder.id, ownerId: bob,
      });
      const [fileError] = await requireFileWithinSpace(aliceSpace, file);
      if(!fileError) return fail("alice's space accepted a file inside bob's");

      pass('cross-space access is refused at the containment check');
    } finally {
      await deleteUser(alice);
      await deleteUser(bob);
    }
  },

  'the library root belongs to nobody': async ({ pass, fail }) => {
    await purge();
    const userId = await makeUser('root');

    try {
      const [, space] = await provisionSpace({ userId });

      const [, owner] = await resolveSpace(null);
      if(owner !== null) return fail('the library root resolved to a space');

      const [error] = await requireWithinSpace(space, null);
      if(!error) return fail('a space accepted the library root as one of its folders');

      pass('nothing outside a space resolves into one');
    } finally {
      await deleteUser(userId);
    }
  },

  'usage is measured from the disk, not from the rows': async ({ pass, fail }) => {
    await purge();
    const userId = await makeUser('usage');

    try {
      const [, space] = await provisionSpace({ userId });
      const [, folder] = await createDirectory({ name: 'nested', parentId: space.directoryId, ownerId: userId });

      await storeUpload({ name: 'a.txt', data: bytes(1000), directoryId: space.directoryId, ownerId: userId });
      await storeUpload({ name: 'b.txt', data: bytes(2000), directoryId: folder.id, ownerId: userId });

      /*
        A file with no row behind it occupies exactly as much disk as a tracked one, so a quota that
        counted rows would miss it. This is why the walk is a filesystem walk.
      */
      const [, absolute] = await directoryPath(folder.id);
      await writeFile(path.join(absolute, 'untracked.bin'), bytes(500));

      const [error, measured] = await measureSpace(space);
      if(error) return fail(error.msg);
      if(measured !== 3500) return fail(`measured ${measured}, expected 3500`);

      const [, recalculated] = await recalculateUsage(space);
      const [, reloaded] = await getSpace(userId);
      if(reloaded.bytesUsed !== 3500) return fail(`cached ${reloaded.bytesUsed} after recalculation`);
      if(!reloaded.usageCalculatedAt) return fail('the recalculation timestamp was not written');
      if(recalculated.bytesUsed !== 3500) return fail('recalculateUsage reported a different figure');

      pass('every byte under the folder counts, tracked or not');
    } finally {
      await deleteUser(userId);
    }
  },

  'the upload hook refuses an upload that would exceed the limit': async ({ pass, fail }) => {
    await purge();
    const userId = await makeUser('quota');

    try {
      const [, plan] = await createPlan({ name: 'Small', quotaBytes: 5000, isDefault: true });
      const [, space] = await provisionSpace({ userId, planId: plan.id });

      await storeUpload({ name: 'big.bin', data: bytes(4000), directoryId: space.directoryId, ownerId: userId });
      await recalculateUsage(space);

      let refused = null;
      try {
        await beforeUpload({ size: 2000, directoryId: space.directoryId });
      } catch(error) {
        refused = error;
      }

      if(!refused) return fail('an upload past the limit was allowed');
      if(refused.code !== 413) return fail(`expected a 413, got ${refused.code}`);
      if(!/storage limit/i.test(refused.msg)) return fail(`unhelpful message: ${refused.msg}`);

      pass('the limit is enforced where every upload route passes through');
    } finally {
      await deleteUser(userId);
    }
  },

  'an upload that fits is allowed and reserves its bytes up front': async ({ pass, fail }) => {
    await purge();
    const userId = await makeUser('reserve');

    try {
      const [, plan] = await createPlan({ name: 'Roomy', quotaBytes: 100000, isDefault: true });
      const [, space] = await provisionSpace({ userId, planId: plan.id });

      await beforeUpload({ size: 1234, directoryId: space.directoryId });

      /*
        The reservation is what stops two concurrent uploads both measuring against the same stale
        figure. It is deliberately applied before a single byte is written.
      */
      const [, reserved] = await getSpace(userId);
      if(reserved.bytesUsed !== 1234) return fail(`expected 1234 reserved, found ${reserved.bytesUsed}`);

      pass('bytes are reserved before the upload proceeds');
    } finally {
      await deleteUser(userId);
    }
  },

  'a suspended space refuses uploads but keeps its files': async ({ pass, fail }) => {
    await purge();
    const userId = await makeUser('suspended');

    try {
      const [, space] = await provisionSpace({ userId });
      const [, file] = await storeUpload({ name: 'keep.txt', data: bytes(100), directoryId: space.directoryId, ownerId: userId });

      await updateSpace({ userId, suspended: true });

      let refused = null;
      try {
        await beforeUpload({ size: 1, directoryId: space.directoryId });
      } catch(error) {
        refused = error;
      }

      if(!refused) return fail('a suspended space accepted an upload');
      if(refused.code !== 403) return fail(`expected a 403, got ${refused.code}`);

      const [, listed] = await listFiles({ directoryId: space.directoryId });
      if(!listed.files.some(candidate => candidate.id === file.id)){
        return fail('suspending a space removed its files');
      }

      pass('a suspension is read-only, not a deletion');
    } finally {
      await deleteUser(userId);
    }
  },

  'nothing outside a space is subject to a quota': async ({ pass, fail }) => {
    await purge();
    const userId = await makeUser('foreign');

    try {
      const [, plan] = await createPlan({ name: 'Tiny', quotaBytes: 1, isDefault: true });
      await provisionSpace({ userId, planId: plan.id });

      const [, shared] = await createDirectory({ name: 'site-assets', parentId: null, ownerId: 'someone-else' });

      // Would blow any limit, if one applied — the point is that none does.
      await beforeUpload({ size: 999999999, directoryId: shared.id });
      await beforeUpload({ size: 999999999, directoryId: null });

      pass('the rest of the file library is untouched by this extension');
    } finally {
      await deleteUser(userId);
    }
  },

  'a per-user override beats the plan it is on': async ({ pass, fail }) => {
    await purge();
    const userId = await makeUser('override');

    try {
      const [, plan] = await createPlan({ name: 'Base', quotaBytes: 1000, isDefault: true });
      const [, space] = await provisionSpace({ userId, planId: plan.id });

      await updateSpace({ userId, quotaOverrideBytes: 50000 });
      const [, updated] = await getSpace(userId);
      const described = await describeSpace(updated);

      if(described.limitBytes !== 50000) return fail(`limit is ${described.limitBytes}, expected the override`);

      // 4000 bytes is over the plan and under the override — this is the case the override exists for.
      await beforeUpload({ size: 4000, directoryId: space.directoryId });

      pass('an override is what an ecommerce extension would set');
    } finally {
      await deleteUser(userId);
    }
  },

  'deleting a plan moves its spaces to the default rather than deleting anything': async ({ pass, fail }) => {
    await purge();
    const userId = await makeUser('plan-delete');

    try {
      const [, fallback] = await createPlan({ name: 'Default', quotaBytes: null, isDefault: true });
      const [, paid] = await createPlan({ name: 'Paid', quotaBytes: 9999 });

      const [, space] = await provisionSpace({ userId, planId: paid.id });
      await storeUpload({ name: 'file.txt', data: bytes(50), directoryId: space.directoryId, ownerId: userId });

      const [error, result] = await deletePlan({ id: paid.id });
      if(error) return fail(error.msg);
      if(result.spacesMoved !== 1) return fail(`expected 1 space moved, got ${result.spacesMoved}`);

      const [, moved] = await getSpace(userId);
      if(moved.planId !== null) return fail('the space still names the deleted plan');

      const described = await describeSpace(moved);
      if(described.plan?.id !== fallback.id) return fail('the space did not fall back to the default plan');

      const [, listed] = await listFiles({ directoryId: space.directoryId });
      if(listed.files.length !== 1) return fail('deleting a plan touched the files');

      pass('a plan is an allowance, never a container');
    } finally {
      await deleteUser(userId);
    }
  },

  'the default plan cannot be deleted while another plan exists': async ({ pass, fail }) => {
    await purge();

    await createPlan({ name: 'Primary', quotaBytes: null, isDefault: true });
    await createPlan({ name: 'Secondary', quotaBytes: 100 });

    const [, current] = await defaultPlan();
    const [error] = await deletePlan({ id: current.id });

    if(!error) return fail('the default plan was deleted out from under every space relying on it');
    if(error.code !== 409) return fail(`expected a 409, got ${error.code}`);

    pass('removing the fallback takes two deliberate steps');
  },

  'removing a space keeps the files by default and picks them back up': async ({ pass, fail }) => {
    await purge();
    const userId = await makeUser('deprovision');

    try {
      const [, space] = await provisionSpace({ userId });
      await storeUpload({ name: 'document.txt', data: bytes(300), directoryId: space.directoryId, ownerId: userId });

      const [error, result] = await deprovisionSpace({ userId });
      if(error) return fail(error.msg);
      if(result.filesDeleted !== 0) return fail('files were deleted without being asked for');

      const [gone] = await getSpace(userId);
      if(!gone || gone.code !== 404) return fail('the space row survived deprovisioning');

      /*
        The folder is still on disk with a 409-producing name, so re-provisioning has to reclaim it
        rather than fail — otherwise cancelling and resubscribing would lock somebody out of their
        own documents.
      */
      const [reError, reprovisioned] = await provisionSpace({ userId });
      if(reError) return fail(`could not re-provision: ${reError.msg}`);
      if(reprovisioned.directoryId !== space.directoryId) return fail('re-provisioning made a new folder');

      const [, listed] = await listFiles({ directoryId: reprovisioned.directoryId });
      if(listed.files.length !== 1) return fail('the files did not come back');

      pass('cancelling is reversible; the files were never the entitlement');
    } finally {
      await deleteUser(userId);
    }
  },

  'removing a space with deleteFiles empties it completely': async ({ pass, fail }) => {
    await purge();
    const userId = await makeUser('purge');

    try {
      const [, space] = await provisionSpace({ userId });
      const [, folder] = await createDirectory({ name: 'deep', parentId: space.directoryId, ownerId: userId });

      await storeUpload({ name: 'one.txt', data: bytes(10), directoryId: space.directoryId, ownerId: userId });
      await storeUpload({ name: 'two.txt', data: bytes(10), directoryId: folder.id, ownerId: userId });

      const [, absolute] = await directoryPath(space.directoryId);

      const [error, result] = await deprovisionSpace({ userId, deleteFiles: true });
      if(error) return fail(error.msg);
      if(result.filesDeleted !== 2) return fail(`expected 2 files deleted, got ${result.filesDeleted}`);

      /*
        kempo-files refuses to delete a non-empty folder, so a nested subtree only comes out if the
        deletion walks it deepest-first. That ordering is the whole reason this test exists.
      */
      const survived = await stat(absolute).then(() => true).catch(() => false);
      if(survived) return fail('the space folder is still on disk');

      pass('an explicit purge removes the whole subtree');
    } finally {
      await deleteUser(userId);
    }
  },

  'a space whose user was deleted is reported rather than hidden': async ({ pass, fail }) => {
    await purge();
    const userId = await makeUser('orphan');
    const [, space] = await provisionSpace({ userId });

    // kempo fires no hook when an account is deleted, so nothing here could have cleaned up.
    await deleteUser(userId);

    const [error, data] = await listSpaces();
    if(error) return fail(error.msg);

    const orphan = data.spaces.find(candidate => candidate.id === space.id);
    if(!orphan) return fail('the space vanished from the listing along with its user');
    if(orphan.user !== null) return fail('a deleted user was reported as present');

    pass('an orphaned space is visible, which is the only way it gets cleaned up');
  },

  'the uploaded hook leaves the cache exact rather than doubled': async ({ pass, fail }) => {
    await purge();
    const userId = await makeUser('settle');

    try {
      const [, space] = await provisionSpace({ userId });

      await beforeUpload({ size: 700, directoryId: space.directoryId });
      const [, file] = await storeUpload({ name: 'settled.bin', data: bytes(700), directoryId: space.directoryId, ownerId: userId });
      await fileUploaded({ file });

      /*
        The reservation and the recalculation both account for the same 700 bytes. The recalculation
        replaces the figure rather than adding to it — if it added, every upload would count twice
        and a member would hit their limit at half of it.
      */
      await recalculateUsage(space);
      const [, settled] = await getSpace(userId);
      if(settled.bytesUsed !== 700) return fail(`expected 700, found ${settled.bytesUsed}`);

      pass('reserve-then-measure settles on the real number');
    } finally {
      await deleteUser(userId);
    }
  },

  'another signed-in user cannot download a private file out of a space': async ({ pass, fail }) => {
    await purge();
    const owner = await makeUser('download-owner');
    const stranger = await makeUser('download-stranger');

    try {
      const [, space] = await provisionSpace({ userId: owner });
      const [, file] = await storeUpload({
        name: 'private.txt', data: bytes(20), directoryId: space.directoryId, ownerId: owner,
      });

      /*
        This is the whole reason the download hook exists. kempo-files' own route admits anybody
        holding `files:download` — which its shipped contributor group grants — so by the time this
        handler runs, the library has already said yes. The stranger below needs no permissions at
        all for the scenario to be real: whatever kempo-files decided, a personal folder is not
        readable by other people.
      */
      const strangerRequest = await sessionFor(stranger);
      const refused = await refusal(() => beforeDownload({ file, request: strangerRequest }));
      if(!refused) return fail('a different signed-in user was allowed to download a private file');
      if(refused.code !== 404) return fail(`expected a 404, got ${refused.code}`);

      const anonymous = await refusal(() => beforeDownload({ file, request: { cookies: {} } }));
      if(!anonymous) return fail('an anonymous request was allowed');
      if(anonymous.code !== 401) return fail(`expected a 401 with no session, got ${anonymous.code}`);

      const ownerRequest = await sessionFor(owner);
      const allowed = await refusal(() => beforeDownload({ file, request: ownerRequest }));
      if(allowed) return fail(`the owner was refused their own file: ${allowed.msg}`);

      pass('a private file in a space is readable by its owner and nobody else');
    } finally {
      await deleteUser(owner);
      await deleteUser(stranger);
    }
  },

  'a shared file is downloadable by anyone, with no session at all': async ({ pass, fail }) => {
    await purge();
    const owner = await makeUser('share-owner');

    try {
      const [, space] = await provisionSpace({ userId: owner });
      const [, file] = await storeUpload({
        name: 'shared.txt', data: bytes(20), directoryId: space.directoryId, ownerId: owner, public: true,
      });

      const anonymous = await refusal(() => beforeDownload({ file, request: { cookies: {} } }));
      if(anonymous) return fail(`a shared file was refused to an anonymous request: ${anonymous.msg}`);

      pass('sharing is what the public flag means, here as everywhere else');
    } finally {
      await deleteUser(owner);
    }
  },

  'files outside any space are left entirely alone by the download hook': async ({ pass, fail }) => {
    await purge();

    const [, shared] = await createDirectory({ name: 'site-assets', parentId: null, ownerId: 'someone-else' });
    const [, file] = await storeUpload({
      name: 'logo.png', data: bytes(20), directoryId: shared.id, ownerId: 'someone-else',
    });

    /*
      Private, no session, and it still has to pass — because it is not in anybody's space, and
      narrowing access to the rest of the library is not this extension's business.
    */
    const result = await refusal(() => beforeDownload({ file, request: { cookies: {} } }));
    if(result) return fail(`an ordinary library file was refused: ${result.msg}`);

    pass('the rest of the library keeps kempo-files own rules');
  },

  'a reservation can never drive usage below zero': async ({ pass, fail }) => {
    await purge();
    const userId = await makeUser('negative');

    try {
      const [, space] = await provisionSpace({ userId });
      await reserveBytes(space, -5000);

      const [, reloaded] = await getSpace(userId);
      if(reloaded.bytesUsed < 0) return fail(`usage went negative: ${reloaded.bytesUsed}`);

      pass('usage is clamped at zero');
    } finally {
      await deleteUser(userId);
    }
  },
};

export default databaseReachable ? suite : skipped('no database reachable at DATABASE_URL');
