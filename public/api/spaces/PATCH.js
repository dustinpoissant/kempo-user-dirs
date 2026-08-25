import { requireSession, requirePermission } from '../../../server/utils/permissions/gate.js';
import { updateSpace, describeSpace } from '../../../server/utils/spaces/spaces.js';

/*
  Changing what a space is allowed: its plan, a limit just for this person, and whether it is
  suspended.

  This is the endpoint an ecommerce extension eventually calls. Upgrading somebody is `planId`;
  a one-off allowance is `quotaOverrideBytes`; a lapsed subscription is `suspended`. None of them
  touch a single file.
*/
export default async (request, response) => {
  const { userId, planId, quotaOverrideBytes, suspended } = request.body || {};
  if(!userId) return response.status(400).json({ error: 'A user id is required' });

  const [sessionError, session] = await requireSession(request);
  if(sessionError) return response.status(sessionError.code).json({ error: sessionError.msg });

  const [permError] = await requirePermission(session.token, 'userdirs:quotas');
  if(permError) return response.status(permError.code).json({ error: permError.msg });

  const [error, space] = await updateSpace({ userId, planId, quotaOverrideBytes, suspended });
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json({ space: await describeSpace(space) });
};
