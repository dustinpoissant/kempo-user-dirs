import crypto from 'crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import { createDirectory, deleteDirectory, deleteFile, listFiles, directorySubtree } from 'kempo-files/sdk';
import db from 'kempo/server/db/index.js';
import { getUserById } from 'kempo/server/sdk.js';
import { kempoUserDir } from '../../db/schema.js';
import { rootDirectory } from './rootDirectory.js';
import { defaultPlan, getPlan, listPlans } from '../plans/plans.js';
import { effectiveLimit } from '../quota/limits.js';

/*
  A space is a row pairing a user with a kempo-files folder. Everything else about it — what is in
  it, what those files are called, who may download them — is kempo-files' business.
*/

export const getSpace = async userId => {
  if(!userId) return [{ code: 400, msg: 'A user id is required' }, null];

  try {
    const [row] = await db.select().from(kempoUserDir).where(eq(kempoUserDir.userId, userId));
    if(!row) return [{ code: 404, msg: 'That user does not have a file space' }, null];
    return [null, row];
  } catch {
    return [{ code: 500, msg: 'Could not load the file space' }, null];
  }
};

/*
  The spaces a set of folder ids belong to, in one query. The scope check runs on every request
  that touches a file, so it asks this rather than reading rows one at a time.
*/
export const spacesForDirectories = async directoryIds => {
  if(!directoryIds?.length) return [null, []];

  try {
    const rows = await db.select().from(kempoUserDir).where(inArray(kempoUserDir.directoryId, directoryIds));
    return [null, rows];
  } catch {
    return [{ code: 500, msg: 'Could not resolve the file space' }, null];
  }
};

/*
  Creates a user's folder and records it.

  The folder is named with the user's id, not their name or email. Both of those change, and a
  rename on disk that this extension did not perform is how a space quietly loses its contents —
  the id is the only handle that is stable for as long as the account is. The admin screens show
  the person, not the folder name, so nothing is lost by it being opaque.

  Idempotent: asking for a space that already exists returns it rather than failing, which is what
  makes lazy provisioning safe to call from anywhere.
*/
export const provisionSpace = async ({ userId, planId = null }) => {
  if(!userId) return [{ code: 400, msg: 'A user id is required' }, null];

  const [existingError, existing] = await getSpace(userId);
  if(!existingError) return [null, existing];
  if(existingError.code !== 404) return [existingError, null];

  const [userError, user] = await getUserById(userId);
  if(userError || !user) return [{ code: 404, msg: 'User not found' }, null];

  if(planId){
    const [planError] = await getPlan(planId);
    if(planError) return [planError, null];
  }

  const [rootError, root] = await rootDirectory();
  if(rootError) return [rootError, null];

  const [directoryError, directory] = await createDirectory({ name: userId, parentId: root.id, ownerId: userId });
  if(directoryError && directoryError.code !== 409) return [directoryError, null];

  /*
    A 409 means the folder is already on disk — a space that was deprovisioned without deleting its
    files, most likely, which is the documented default. Reclaiming it is the whole point of
    keeping the files: the user gets their contents back rather than an error.
  */
  const directoryId = directory?.id || await reclaimDirectory(root.id, userId);
  if(!directoryId) return [{ code: 409, msg: 'That folder already exists but could not be reclaimed' }, null];

  const now = new Date();
  const row = {
    id: crypto.randomBytes(8).toString('hex'),
    userId,
    directoryId,
    planId,
    quotaOverrideBytes: null,
    bytesUsed: 0,
    usageCalculatedAt: null,
    suspended: false,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.insert(kempoUserDir).values(row);
  } catch {
    return [{ code: 500, msg: 'Could not record the file space' }, null];
  }

  return [null, row];
};

const reclaimDirectory = async (parentId, name) => {
  const [error, data] = await directorySubtree(parentId);
  if(error) return null;
  return data.find(directory => directory.parentId === parentId && directory.name === name)?.id || null;
};

export const updateSpace = async ({ userId, planId, quotaOverrideBytes, suspended }) => {
  const [lookupError, existing] = await getSpace(userId);
  if(lookupError) return [lookupError, null];

  const changes = {};

  if(planId !== undefined){
    if(planId === null || planId === ''){
      changes.planId = null;
    } else {
      const [planError] = await getPlan(planId);
      if(planError) return [planError, null];
      changes.planId = planId;
    }
  }

  if(quotaOverrideBytes !== undefined){
    if(quotaOverrideBytes === null || quotaOverrideBytes === ''){
      changes.quotaOverrideBytes = null;
    } else {
      const bytes = Number(quotaOverrideBytes);
      if(!Number.isFinite(bytes) || bytes < 0) return [{ code: 400, msg: 'A storage limit must be zero or more bytes' }, null];
      if(!Number.isSafeInteger(bytes)) return [{ code: 400, msg: 'That storage limit is too large to record' }, null];
      changes.quotaOverrideBytes = bytes;
    }
  }

  if(suspended !== undefined) changes.suspended = Boolean(suspended);

  if(!Object.keys(changes).length) return [null, existing];

  try {
    await db.update(kempoUserDir).set({ ...changes, updatedAt: new Date() }).where(eq(kempoUserDir.userId, userId));
    return [null, { ...existing, ...changes }];
  } catch {
    return [{ code: 500, msg: 'Could not save the file space' }, null];
  }
};

/*
  Removing a space defaults to keeping the files.

  Someone who cancels a subscription has not asked for their documents to be destroyed, and there
  is no undo anywhere in this stack. The folder stays where it is, still visible to anyone with
  kempo-files' own browse permission, and re-provisioning the same user picks it straight back up.
  Deleting is available, but it has to be asked for.
*/
export const deprovisionSpace = async ({ userId, deleteFiles = false }) => {
  const [lookupError, existing] = await getSpace(userId);
  if(lookupError) return [lookupError, null];

  let removed = 0;
  if(deleteFiles){
    const [emptyError, result] = await emptySpace(existing.directoryId);
    if(emptyError) return [emptyError, null];
    removed = result.filesDeleted;
  }

  try {
    await db.delete(kempoUserDir).where(eq(kempoUserDir.userId, userId));
  } catch {
    return [{ code: 500, msg: 'Could not remove the file space' }, null];
  }

  return [null, { userId, filesDeleted: removed, directoryRemoved: deleteFiles }];
};

/*
  Deletes every file in a space and then every folder, deepest first.

  kempo-files refuses to delete a folder with anything in it — deliberately, so that one request
  cannot destroy an arbitrary subtree — which means emptying one is this extension's job. Depth
  ordering is what makes the second pass succeed: a parent is only ever removed after everything
  below it has gone.
*/
export const emptySpace = async directoryId => {
  const [treeError, tree] = await directorySubtree(directoryId);
  if(treeError) return [treeError, null];

  let filesDeleted = 0;

  for(const directory of tree){
    const [listError, data] = await listFiles({ directoryId: directory.id, limit: 10000 });
    if(listError) return [listError, null];

    for(const file of data.files){
      const [deleteError] = await deleteFile({ id: file.id });
      if(deleteError) return [deleteError, null];
      filesDeleted++;
    }
  }

  /*
    directorySubtree walks level by level, so a parent always appears before its children.
    Reversing that is deepest-first without having to compute a depth for anything.
  */
  for(const directory of [...tree].reverse()){
    const [deleteError] = await deleteDirectory({ id: directory.id });
    if(deleteError) return [deleteError, null];
  }

  return [null, { filesDeleted }];
};

/*
  Every space with the person and the plan already attached, because a list of hex ids is not an
  admin screen. A user row that has gone missing is reported rather than hidden — kempo fires no
  hook when an account is deleted, so an orphaned space is a real thing an admin needs to see.
*/
export const listSpaces = async () => {
  try {
    const rows = await db.select().from(kempoUserDir).orderBy(asc(kempoUserDir.createdAt));
    const [, plansData] = await listPlans();
    const [, fallback] = await defaultPlan();
    const plans = plansData?.plans || [];

    const spaces = await Promise.all(rows.map(async row => {
      const [userError, user] = await getUserById(row.userId);
      const plan = row.planId ? plans.find(candidate => candidate.id === row.planId) || null : fallback;

      return {
        ...row,
        plan,
        limitBytes: effectiveLimit(row, plan),
        user: userError || !user ? null : { id: user.id, name: user.name, email: user.email },
      };
    }));

    return [null, { spaces }];
  } catch {
    return [{ code: 500, msg: 'Could not list the file spaces' }, null];
  }
};

/*
  A space plus everything a screen needs to draw it: the plan behind it, and the limit that plan
  works out to once any per-user override is taken into account.
*/
export const describeSpace = async space => {
  const [, plan] = space.planId ? await getPlan(space.planId) : await defaultPlan();

  return {
    ...space,
    plan: plan || null,
    limitBytes: effectiveLimit(space, plan),
  };
};
