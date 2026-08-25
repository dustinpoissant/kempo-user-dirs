import { userHasPermission } from 'kempo/server/sdk.js';
import { requireSession, requirePermission } from '../../../server/utils/permissions/gate.js';
import { provisionSpace, describeSpace } from '../../../server/utils/spaces/spaces.js';

/*
  Creating a space for somebody, ahead of them ever opening one.

  It refuses a user who does not hold `userdirs:access`, which is the point of the whole
  arrangement: the permission is the entitlement, and handing somebody storage they are not
  entitled to would leave a space nobody could open and no record of why it exists. Add them to
  the group first — that is the step a paywall would eventually automate.
*/
export default async (request, response) => {
  const { userId, planId } = request.body || {};
  if(!userId) return response.status(400).json({ error: 'A user id is required' });

  const [sessionError, session] = await requireSession(request);
  if(sessionError) return response.status(sessionError.code).json({ error: sessionError.msg });

  const [permError] = await requirePermission(session.token, 'userdirs:provision');
  if(permError) return response.status(permError.code).json({ error: permError.msg });

  const [checkError, eligible] = await userHasPermission(userId, 'userdirs:access');
  if(checkError) return response.status(checkError.code).json({ error: checkError.msg });
  if(!eligible){
    return response.status(409).json({ error: 'That user cannot have a file space yet — add them to a group granting userdirs:access first' });
  }

  const [error, space] = await provisionSpace({ userId, planId: planId || null });
  if(error) return response.status(error.code).json({ error: error.msg });

  response.status(201).json({ space: await describeSpace(space) });
};
