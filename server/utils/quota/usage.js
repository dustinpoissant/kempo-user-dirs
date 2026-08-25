import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { eq, sql } from 'drizzle-orm';
import { directoryPath } from 'kempo-files/sdk';
import db from 'kempo/server/db/index.js';
import { kempoUserDir } from '../../db/schema.js';

/*
  What a space is actually using, and how that number stays honest.

  The truth is on disk, and reading it is a filesystem walk. That is cheap enough to do after a
  change and far too expensive to do on every request that wants to draw a usage bar, so the number
  lives in `kempoUserDir.bytesUsed` as a cache with two rules:

    1. An upload **reserves** its bytes against the cache synchronously, before it is allowed
       through. Two large uploads arriving at once therefore cannot both measure against the same
       stale figure and both be let in — which is the only way a quota gets busted by a race.
    2. A walk runs straight after and **replaces** the cache with the real number. That is what
       makes a reservation for an upload that then failed, or a replacement that freed as much as
       it added, correct itself within a moment rather than drifting forever.

  So the cache is briefly pessimistic and then exact. Getting that the other way round — optimistic
  and eventually right — is what lets somebody over their limit.
*/

/*
  Walks the space's folder on disk rather than summing kempo-files rows.

  A quota is about storage, and storage is what is on the disk: a file somebody dropped into the
  folder by hand, or one whose row was lost, occupies exactly as much space as a tracked one. This
  also means the number never needs a reconciliation pass of its own — the disk is the reconciler.
*/
export const measureSpace = async space => {
  const [pathError, absolute] = await directoryPath(space.directoryId);
  if(pathError) return [pathError, null];

  try {
    return [null, await sizeOfTree(absolute)];
  } catch {
    return [{ code: 500, msg: 'Could not measure the file space' }, null];
  }
};

const sizeOfTree = async absolute => {
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch(error) {
    // A folder recorded but not yet on disk is zero bytes, not a failure.
    if(error.code === 'ENOENT') return 0;
    throw error;
  }

  let total = 0;
  for(const entry of entries){
    const path = join(absolute, entry.name);
    if(entry.isDirectory()){
      total += await sizeOfTree(path);
      continue;
    }
    // Symlinks are not followed: their target is somebody else's bytes, counted somewhere else.
    if(!entry.isFile()) continue;
    try {
      total += (await stat(path)).size;
    } catch { /* vanished mid-walk — it is not using any space now */ }
  }

  return total;
};

export const recalculateUsage = async space => {
  const [measureError, bytesUsed] = await measureSpace(space);
  if(measureError) return [measureError, null];

  try {
    await db.update(kempoUserDir)
      .set({ bytesUsed, usageCalculatedAt: new Date(), updatedAt: new Date() })
      .where(eq(kempoUserDir.id, space.id));
  } catch {
    return [{ code: 500, msg: 'Could not record the space usage' }, null];
  }

  return [null, { bytesUsed }];
};

/*
  The reservation from rule 1. Written as a relative update rather than read-modify-write so two
  concurrent uploads add up instead of one overwriting the other's reservation.
*/
export const reserveBytes = async (space, bytes) => {
  if(!bytes) return [null, { bytesUsed: space.bytesUsed }];

  try {
    const [row] = await db.update(kempoUserDir)
      .set({ bytesUsed: sql`GREATEST(0, ${kempoUserDir.bytesUsed} + ${Math.round(bytes)})`, updatedAt: new Date() })
      .where(eq(kempoUserDir.id, space.id))
      .returning({ bytesUsed: kempoUserDir.bytesUsed });

    return [null, { bytesUsed: row?.bytesUsed ?? space.bytesUsed }];
  } catch {
    return [{ code: 500, msg: 'Could not reserve the space' }, null];
  }
};

/*
  Rule 2, coalesced.

  Dragging thirty files in fires thirty upload hooks, and thirty full walks of the same folder
  would be thirty times the work for one answer. A short debounce collapses them into one walk
  after the last arrival, and the in-flight guard stops a second walk starting while the first is
  still going.

  Deliberately in-process and fire-and-forget. Nothing waits on it, a restart loses at most a
  pending recalculation, and the next one (or the staleness check when a space is opened) puts the
  number right. There is no state here worth persisting.
*/
const pending = new Map();
const running = new Map();
const DEBOUNCE_MS = 750;

export const scheduleRecalculation = space => {
  const existing = pending.get(space.id);
  if(existing) clearTimeout(existing);

  pending.set(space.id, setTimeout(() => {
    pending.delete(space.id);
    runRecalculation(space);
  }, DEBOUNCE_MS));
};

const runRecalculation = space => {
  if(running.has(space.id)) return running.get(space.id);

  const work = recalculateUsage(space)
    .catch(() => {})
    .finally(() => running.delete(space.id));

  running.set(space.id, work);
  return work;
};

export const isUsageStale = (space, staleMinutes) => {
  if(!staleMinutes) return false;
  if(!space.usageCalculatedAt) return true;
  return Date.now() - new Date(space.usageCalculatedAt).getTime() > staleMinutes * 60 * 1000;
};

/*
  Exposed for tests and for the uninstall path, which needs every scheduled walk to have either run
  or been abandoned before the tables it writes to are dropped.
*/
export const flushRecalculations = async () => {
  for(const [id, timer] of pending){
    clearTimeout(timer);
    pending.delete(id);
  }
  await Promise.all([...running.values()]);
};
