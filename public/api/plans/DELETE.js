import { requireSession, requirePermission } from '../../../server/utils/permissions/gate.js';
import { deletePlan } from '../../../server/utils/plans/plans.js';

export default async (request, response) => {
  const { id } = request.body || {};
  if(!id) return response.status(400).json({ error: 'A plan id is required' });

  const [sessionError, session] = await requireSession(request);
  if(sessionError) return response.status(sessionError.code).json({ error: sessionError.msg });

  const [permError] = await requirePermission(session.token, 'userdirs:quotas');
  if(permError) return response.status(permError.code).json({ error: permError.msg });

  const [error, result] = await deletePlan({ id });
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json(result);
};
