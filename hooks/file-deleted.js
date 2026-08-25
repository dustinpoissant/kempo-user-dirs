import { resolveSpaceForFile } from '../server/utils/spaces/scope.js';
import { scheduleRecalculation } from '../server/utils/quota/usage.js';

/*
  Fires after kempo-files has removed a file. If it was in somebody's space, they just got some
  room back.

  Subtracting the file's size here would be the obvious thing and is not possible — the bytes are
  already gone, so there is nothing left to measure. Re-walking is what the whole design leans on
  anyway: the disk is the source of truth, and this is one more reason the cache is never trusted
  for longer than it takes to check.
*/
export default async ({ file }) => {
  const [error, space] = await resolveSpaceForFile(file);
  if(error || !space) return;

  scheduleRecalculation(space);
};
