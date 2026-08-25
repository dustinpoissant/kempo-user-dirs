import { getFile, updateFile } from 'kempo-files/sdk';
import { authorizeSpace, requireWritable, hasPermission } from '../../../server/utils/permissions/gate.js';
import { requireWithinSpace, requireFileWithinSpace } from '../../../server/utils/spaces/scope.js';

/*
  Rename, move within the space, edit alt text, share or unshare.

  Notably absent: `alias`. kempo-files lets a public file claim a bare path on the site — `scripts/
  analytics.js` — which is a site-wide namespace, and handing every member of a paid tier the
  ability to claim URLs on the front page of somebody else's website is not a feature. Sharing here
  produces the canonical `/kempo-files/api/files/<id>` link and nothing more.
*/
export default async (request, response) => {
  const { id, name, directoryId, altText, public: isPublic } = request.body || {};
  if(!id) return response.status(400).json({ error: 'A file id is required' });

  const [authError, context] = await authorizeSpace(request, { userId: request.query?.userId, action: 'manage' });
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [writableError] = requireWritable(context.space);
  if(writableError) return response.status(writableError.code).json({ error: writableError.msg });

  const [lookupError, file] = await getFile(id);
  if(lookupError) return response.status(lookupError.code).json({ error: lookupError.msg });

  const [scopeError] = await requireFileWithinSpace(context.space, file);
  if(scopeError) return response.status(scopeError.code).json({ error: scopeError.msg });

  /*
    A move is the one field that can take a file *out* of the space, so the destination is checked
    the same way the file itself was. Without this, "move to folder X" is an arbitrary write into
    the shared library.
  */
  if(directoryId !== undefined){
    const [destinationError] = await requireWithinSpace(context.space, directoryId);
    if(destinationError) return response.status(destinationError.code).json({ error: destinationError.msg });
  }

  if(isPublic !== undefined && Boolean(isPublic) !== file.public){
    const allowed = context.isSelf
      ? await hasPermission(context.session.token, 'userdirs:share')
      : await hasPermission(context.session.token, 'userdirs:others:manage');
    if(!allowed) return response.status(403).json({ error: 'You cannot change whether a file is shared' });
  }

  const [updateError, updated] = await updateFile({ id, name, directoryId, altText, public: isPublic });
  if(updateError) return response.status(updateError.code).json({ error: updateError.msg });

  response.json({ file: updated });
};
