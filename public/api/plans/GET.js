import { requireSession, hasPermission } from '../../../server/utils/permissions/gate.js';
import { listPlans } from '../../../server/utils/plans/plans.js';

/*
  Readable by anyone who can browse a space, not just by whoever can edit the plans. A member's own
  screen names the plan they are on and what it allows; without this it could only ever show them a
  number with no explanation of where it came from.
*/
export default async (request, response) => {
  const [sessionError, session] = await requireSession(request);
  if(sessionError) return response.status(sessionError.code).json({ error: sessionError.msg });

  const allowed = await hasPermission(session.token, 'userdirs:access')
    || await hasPermission(session.token, 'userdirs:others:browse');
  if(!allowed) return response.status(403).json({ error: 'Insufficient permissions' });

  const [error, data] = await listPlans();
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json(data);
};
