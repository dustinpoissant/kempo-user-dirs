import { getFile, deleteFile } from 'kempo-files/sdk';
import { authorizeSpace } from '../../../server/utils/permissions/gate.js';
import { requireFileWithinSpace } from '../../../server/utils/spaces/scope.js';

/*
  Deliberately not gated on `requireWritable`. A suspended space is read-only for *adding* things —
  stopping somebody from clearing out files they no longer want would leave them stuck over a limit
  with no way down, which is the opposite of what a suspension is for.
*/
export default async (request, response) => {
  const { id } = request.body || {};
  if(!id) return response.status(400).json({ error: 'A file id is required' });

  const [authError, context] = await authorizeSpace(request, { userId: request.query?.userId, action: 'manage' });
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [lookupError, file] = await getFile(id);
  if(lookupError) return response.status(lookupError.code).json({ error: lookupError.msg });

  const [scopeError] = await requireFileWithinSpace(context.space, file);
  if(scopeError) return response.status(scopeError.code).json({ error: scopeError.msg });

  const [deleteError] = await deleteFile({ id });
  if(deleteError) return response.status(deleteError.code).json({ error: deleteError.msg });

  response.json({ id });
};
