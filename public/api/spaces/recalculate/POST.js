import { requireSession, requirePermission } from '../../../../server/utils/permissions/gate.js';
import { getSpace, listSpaces } from '../../../../server/utils/spaces/spaces.js';
import { recalculateUsage } from '../../../../server/utils/quota/usage.js';

/*
  Re-measure one space, or all of them, on demand.

  The cached figure corrects itself after every upload and delete, so this is not part of normal
  operation — it is for the cases nothing fired a hook for: files moved onto the server by hand, a
  restore from backup, a recalculation lost to a restart at exactly the wrong moment.

  Awaited rather than scheduled, because somebody clicking "recalculate" wants to see the new
  number, not be told it will be along shortly.
*/
export default async (request, response) => {
  const { userId } = request.body || {};

  const [sessionError, session] = await requireSession(request);
  if(sessionError) return response.status(sessionError.code).json({ error: sessionError.msg });

  const [permError] = await requirePermission(session.token, 'userdirs:quotas');
  if(permError) return response.status(permError.code).json({ error: permError.msg });

  if(userId){
    const [lookupError, space] = await getSpace(userId);
    if(lookupError) return response.status(lookupError.code).json({ error: lookupError.msg });

    const [error, result] = await recalculateUsage(space);
    if(error) return response.status(error.code).json({ error: error.msg });

    return response.json({ recalculated: 1, bytesUsed: result.bytesUsed });
  }

  const [listError, data] = await listSpaces();
  if(listError) return response.status(listError.code).json({ error: listError.msg });

  let recalculated = 0;
  const failures = [];
  for(const space of data.spaces){
    const [error] = await recalculateUsage(space);
    if(error) failures.push({ userId: space.userId, msg: error.msg });
    else recalculated++;
  }

  response.json({ recalculated, failures });
};
