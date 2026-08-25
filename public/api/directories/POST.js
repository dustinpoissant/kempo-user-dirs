import { createDirectory } from 'kempo-files/sdk';
import { authorizeSpace, requireWritable } from '../../../server/utils/permissions/gate.js';
import { requireWithinSpace } from '../../../server/utils/spaces/scope.js';

export default async (request, response) => {
  const { name, parentId } = request.body || {};

  const [authError, context] = await authorizeSpace(request, { userId: request.query?.userId, action: 'manage' });
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [writableError] = requireWritable(context.space);
  if(writableError) return response.status(writableError.code).json({ error: writableError.msg });

  /*
    A missing parent means the top of the space, never the top of the library. Defaulting to null
    the way kempo-files does would put the folder in the shared root — the one place a member is
    definitively not allowed to write.
  */
  const destination = parentId || context.space.directoryId;
  const [scopeError] = await requireWithinSpace(context.space, destination);
  if(scopeError) return response.status(scopeError.code).json({ error: scopeError.msg });

  const [error, directory] = await createDirectory({ name, parentId: destination, ownerId: context.space.userId });
  if(error) return response.status(error.code).json({ error: error.msg });

  response.status(201).json({ directory });
};
