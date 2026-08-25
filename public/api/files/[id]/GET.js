import serveStaticFile from 'kempo-server/serve-static-file';
import { triggerHook } from 'kempo/server/sdk.js';
import { getFile, filePath, headersFor } from 'kempo-files/sdk';
import { authorizeSpace } from '../../../../server/utils/permissions/gate.js';
import { requireFileWithinSpace } from '../../../../server/utils/spaces/scope.js';

/*
  Downloading out of a space.

  A member cannot use kempo-files' own download route for their private files: that one asks for
  `files:download`, a licence to fetch anything in the shared library, which is precisely what
  somebody with a personal folder should not be given. So the gate is different — you may fetch it
  if it is in a space you are allowed to open — and everything after the gate is kempo-files': the
  same `file:before_download` veto other extensions hang rules on, and the same trusted/untrusted
  serving decision, so an uploaded script is still handed back as inert text here.

  The bytes go out through kempo-server's file server, so a video in somebody's space seeks like a
  static one: Range requests, 206 responses, streaming rather than buffering.
*/
export default async (request, response) => {
  const [lookupError, file] = await getFile(request.params?.id);
  if(lookupError) return response.status(lookupError.code).json({ error: lookupError.msg });

  const [authError, context] = await authorizeSpace(request, { userId: request.query?.userId });
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [scopeError] = await requireFileWithinSpace(context.space, file);
  if(scopeError) return response.status(scopeError.code).json({ error: scopeError.msg });

  /*
    Fired even though the gate above has already passed, for the same reason kempo-files fires it:
    this is where an extension that knows something this one does not gets to say no. A store
    holding back a file until it is paid for should be able to do that whichever route asked.
  */
  try {
    await triggerHook('file:before_download', { file, request }, { bail: true });
  } catch(hookError) {
    return response.status(hookError?.code || 403).json({ error: hookError?.msg || 'This download is not available' });
  }

  const [pathError, absolute] = await filePath(file);
  if(pathError) return response.status(pathError.code).json({ error: pathError.msg });

  const { 'Content-Type': contentType, ...headers } = headersFor(file);
  await serveStaticFile(absolute, request, response, {}, undefined, { contentType, headers });
};
