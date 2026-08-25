import { updateDirectory } from 'kempo-files/sdk';
import { authorizeSpace, requireWritable } from '../../../server/utils/permissions/gate.js';
import { requireWithinSpace } from '../../../server/utils/spaces/scope.js';

export default async (request, response) => {
  const { id, name, parentId } = request.body || {};
  if(!id) return response.status(400).json({ error: 'A folder id is required' });

  const [authError, context] = await authorizeSpace(request, { userId: request.query?.userId, action: 'manage' });
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [writableError] = requireWritable(context.space);
  if(writableError) return response.status(writableError.code).json({ error: writableError.msg });

  /*
    The space's own root is not a folder inside the space — it *is* the space. Renaming it would
    rename the folder this extension identifies the user by, and moving it would take the whole
    space somewhere else entirely.
  */
  if(id === context.space.directoryId){
    return response.status(403).json({ error: 'The top-level folder of a file space cannot be renamed or moved' });
  }

  const [scopeError] = await requireWithinSpace(context.space, id);
  if(scopeError) return response.status(scopeError.code).json({ error: scopeError.msg });

  if(parentId !== undefined){
    const [destinationError] = await requireWithinSpace(context.space, parentId || context.space.directoryId);
    if(destinationError) return response.status(destinationError.code).json({ error: destinationError.msg });
  }

  const [error, directory] = await updateDirectory({
    id,
    name,
    parentId: parentId === undefined ? undefined : (parentId || context.space.directoryId),
  });
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json({ directory });
};
