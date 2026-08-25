import { resolveSpaceForFile } from '../server/utils/spaces/scope.js';
import { scheduleRecalculation } from '../server/utils/quota/usage.js';

/*
  Fires after kempo-files has stored an upload, or replaced an existing file's contents.

  Nothing is added up here. The before_upload hook already reserved the bytes, and this schedules
  the walk that replaces that estimate with the real figure — including for a replacement, where
  the reservation deliberately over-counted because the old bytes had not gone yet.

  Handlers are awaited in sequence, so this returns immediately and lets the walk happen on its
  own; making every upload wait for a filesystem sweep of the whole space would be a strange price
  to pay for a progress bar.
*/
export default async ({ file }) => {
  const [error, space] = await resolveSpaceForFile(file);
  if(error || !space) return;

  scheduleRecalculation(space);
};
