import { requireSession, requirePermission } from '../../../server/utils/permissions/gate.js';
import { deprovisionSpace } from '../../../server/utils/spaces/spaces.js';

/*
  `deleteFiles` defaults to false, and the caller has to ask for it in so many words.

  Cancelling a subscription is not a request to destroy somebody's documents, and there is no undo
  anywhere in this stack. Left alone, the folder stays in the library and re-provisioning the same
  user picks it straight back up with everything still in it.
*/
export default async (request, response) => {
  const { userId, deleteFiles } = request.body || {};
  if(!userId) return response.status(400).json({ error: 'A user id is required' });

  const [sessionError, session] = await requireSession(request);
  if(sessionError) return response.status(sessionError.code).json({ error: sessionError.msg });

  const [permError] = await requirePermission(session.token, 'userdirs:provision');
  if(permError) return response.status(permError.code).json({ error: permError.msg });

  const [error, result] = await deprovisionSpace({ userId, deleteFiles: deleteFiles === true });
  if(error) return response.status(error.code).json({ error: error.msg });

  response.json(result);
};
