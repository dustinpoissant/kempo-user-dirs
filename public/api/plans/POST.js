import { requireSession, requirePermission } from '../../../server/utils/permissions/gate.js';
import { createPlan } from '../../../server/utils/plans/plans.js';

export default async (request, response) => {
  const { name, description, quotaBytes, isDefault } = request.body || {};

  const [sessionError, session] = await requireSession(request);
  if(sessionError) return response.status(sessionError.code).json({ error: sessionError.msg });

  const [permError] = await requirePermission(session.token, 'userdirs:quotas');
  if(permError) return response.status(permError.code).json({ error: permError.msg });

  const [error, plan] = await createPlan({ name, description, quotaBytes, isDefault });
  if(error) return response.status(error.code).json({ error: error.msg });

  response.status(201).json({ plan });
};
