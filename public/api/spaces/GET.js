import { requireSession, requirePermission } from '../../../server/utils/permissions/gate.js';
import { listSpaces } from '../../../server/utils/spaces/spaces.js';
import { remainingBytes } from '../../../server/utils/quota/limits.js';

export default async (request, response) => {
  const [sessionError, session] = await requireSession(request);
  if(sessionError) return response.status(sessionError.code).json({ error: sessionError.msg });

  const [permError] = await requirePermission(session.token, 'userdirs:others:browse');
  if(permError) return response.status(permError.code).json({ error: permError.msg });

  const [error, data] = await listSpaces();
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json({
    spaces: data.spaces.map(space => ({
      ...space,
      remainingBytes: remainingBytes(space.limitBytes, space.bytesUsed),
      /*
        A space whose user row has gone is not corruption, it is the expected result of deleting an
        account: kempo fires no hook for that, so nothing here could have cleaned up. Reporting it
        is what gives an admin somewhere to act on it.
      */
      orphaned: !space.user,
    })),
  });
};
