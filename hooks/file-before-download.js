import { getSession, currentUserHasPermission } from 'kempo/server/sdk.js';
import { resolveSpaceForFile } from '../server/utils/spaces/scope.js';

/*
  Private means private, whichever door you came in through.

  kempo-files' own download route lets anyone holding `files:download` fetch any non-public file —
  which is correct for a shared library and completely wrong for a personal folder. Its
  `kempo-files:contributor` group grants exactly that permission, so without this every member of
  a site's file library could read every other member's private documents by id.

  kempo-files fires `file:before_download` *after* its own gate has passed, so a handler here can
  only ever narrow access, never widen it. That is what makes it the right place for this rule:
  the answer is "kempo-files would have allowed this, and this extension says no anyway".

  Only files inside a space are affected. Everything else in the library is untouched.
*/
export default async ({ file, request }) => {
  const [scopeError, space] = await resolveSpaceForFile(file);
  if(scopeError || !space) return;

  /*
    A public file was shared on purpose — `userdirs:share` is what a member needs to set the flag,
    and this extension's own routes refuse it to anyone without that permission. Once set, the file
    is a link somebody meant to hand out, so it is served with no session at all like any other
    public file in the library.
  */
  if(file.public) return;

  const token = request?.cookies?.session_token;
  if(!token) throw { code: 401, msg: 'Authentication required' };

  const [sessionError, session] = await getSession({ token });
  if(sessionError || !session?.user) throw { code: 401, msg: 'Authentication required' };

  if(session.user.id === space.userId) return;

  const [permError, canBrowseOthers] = await currentUserHasPermission(token, 'userdirs:others:browse');
  if(permError || !canBrowseOthers){
    throw { code: 404, msg: 'File not found' };
  }
};
