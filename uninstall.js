import { flushRecalculations } from './server/utils/quota/usage.js';
import { listSpaces } from './server/utils/spaces/spaces.js';

/*
  Nothing is deleted here, deliberately.

  kempo drops this extension's two tables after this runs, which loses the record of who had which
  folder and what they were allowed to store. It does not lose a single file: every one of them is
  an ordinary kempo-files entry in an ordinary folder under `files/users/`, and it stays exactly
  where it is, visible to anyone with the library's own browse permission.

  That is the right trade. Uninstalling an extension is not a request to destroy the documents
  people put in it, and there is no undo anywhere in this stack. Reinstalling and re-provisioning
  the same users picks their folders straight back up with everything still in them.

  What this *does* is stop the background usage walks first. They write to `kempoUserDir`, and one
  landing mid-drop is an error in the log for no reason at all.
*/
export default async () => {
  await flushRecalculations();

  const [error, data] = await listSpaces();
  if(error) return;

  console.log(`[kempo-user-dirs] Removed. ${data.spaces.length} user folder${data.spaces.length === 1 ? '' : 's'} were left in the file library untouched — nothing was deleted.`);
};
