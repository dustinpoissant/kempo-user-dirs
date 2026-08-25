import { authorizeSpace } from '../../../server/utils/permissions/gate.js';
import listEntries from '../../../server/utils/entries/listEntries.js';

export default async (request, response) => {
  const [error, context] = await authorizeSpace(request, { userId: request.query?.userId });
  if(error) return response.status(error.code).json({ error: error.msg });

  const [listError, entries] = await listEntries({
    space: context.space,
    directoryId: request.query?.directoryId || null,
    search: request.query?.search || undefined,
    kind: request.query?.kind || undefined,
    limit: Math.min(500, Number(request.query?.limit) || 200),
    offset: Number(request.query?.offset) || 0,
  });
  if(listError) return response.status(listError.code).json({ error: listError.msg });

  response.json(entries);
};
