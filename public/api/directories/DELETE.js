import { deleteDirectory } from 'kempo-files/sdk';
import { authorizeSpace } from '../../../server/utils/permissions/gate.js';
import { requireWithinSpace } from '../../../server/utils/spaces/scope.js';

/*
  kempo-files refuses to delete a folder with anything in it, and that refusal is inherited rather
  than worked around. One request that destroys an arbitrary subtree with no undo is worth making
  impossible; emptying a folder first is a small price for that.
*/
export default async (request, response) => {
  const { id } = request.body || {};
  if(!id) return response.status(400).json({ error: 'A folder id is required' });

  const [authError, context] = await authorizeSpace(request, { userId: request.query?.userId, action: 'manage' });
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  if(id === context.space.directoryId){
    return response.status(403).json({ error: 'The top-level folder of a file space cannot be deleted' });
  }

  const [scopeError] = await requireWithinSpace(context.space, id);
  if(scopeError) return response.status(scopeError.code).json({ error: scopeError.msg });

  const [error] = await deleteDirectory({ id });
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json({ id });
};
