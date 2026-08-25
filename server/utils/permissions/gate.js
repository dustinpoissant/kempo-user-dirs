import { getSession, currentUserHasPermission } from 'kempo/server/sdk.js';
import { readConfig } from '../config/settings.js';
import { getSpace, provisionSpace } from '../spaces/spaces.js';

/*
  Who is asking, whose space they are asking about, and whether those two facts add up.

  Every route in this extension starts here, because the interesting question is never just "does
  this person hold a permission" — it is "does this person hold a permission *over this space*".
  Written out longhand in each route, that is the check that eventually gets one clause wrong in
  one file and quietly hands somebody another user's documents.
*/

export const requireSession = async request => {
  const token = request.cookies?.session_token;
  if(!token) return [{ code: 401, msg: 'Authentication required' }, null];

  const [error, session] = await getSession({ token });
  if(error || !session?.user) return [{ code: 401, msg: 'Authentication required' }, null];

  return [null, { token, user: session.user }];
};

export const requirePermission = async (token, name) => {
  const [error, allowed] = await currentUserHasPermission(token, name);
  if(error) return [{ code: error.code, msg: error.msg }, null];
  if(!allowed) return [{ code: 403, msg: 'Insufficient permissions' }, null];
  return [null, true];
};

export const hasPermission = async (token, name) => {
  const [error, allowed] = await currentUserHasPermission(token, name);
  return Boolean(!error && allowed);
};

/*
  Resolves the space a request is about and confirms the caller may act on it.

  `action` is 'browse' or 'manage'. Reaching your own space needs `userdirs:access`; reaching
  somebody else's needs the matching `userdirs:others:*` permission, and holding that does not
  require having a space of your own — an administrator who has never uploaded anything still
  manages everyone's.

  Provisioning happens here, on the way in, and only for the caller's own space. That is what makes
  the feature work the moment somebody is added to the group, with no separate "set up my folder"
  step for them to find. It is skipped when `auto_provision` is off, so a site can require an admin
  to create spaces deliberately — a paywall wants exactly that.
*/
export const authorizeSpace = async (request, { userId, action = 'browse' } = {}) => {
  const [sessionError, session] = await requireSession(request);
  if(sessionError) return [sessionError, null];

  const targetUserId = userId || session.user.id;
  const isSelf = targetUserId === session.user.id;

  if(isSelf){
    const [accessError] = await requirePermission(session.token, 'userdirs:access');
    if(accessError) return [accessError, null];
  } else {
    const [othersError] = await requirePermission(session.token, `userdirs:others:${action === 'manage' ? 'manage' : 'browse'}`);
    if(othersError) return [othersError, null];
  }

  const [spaceError, space] = await getSpace(targetUserId);
  if(!spaceError) return [null, { session, space, isSelf, targetUserId }];
  if(spaceError.code !== 404) return [spaceError, null];

  if(!isSelf){
    return [{ code: 404, msg: 'That user does not have a file space' }, null];
  }

  const { autoProvision } = await readConfig();
  if(!autoProvision){
    return [{ code: 404, msg: 'Your file space has not been set up yet. An administrator has to create it' }, null];
  }

  const [provisionError, provisioned] = await provisionSpace({ userId: targetUserId });
  if(provisionError) return [provisionError, null];

  return [null, { session, space: provisioned, isSelf, targetUserId }];
};

/*
  A space that is suspended is read-only. Downloading and deleting still work — the point of a
  suspension is to stop somebody adding more storage they are no longer paying for, not to hold
  their existing files hostage.
*/
export const requireWritable = space => {
  if(space.suspended) return [{ code: 403, msg: 'This file space is suspended. Existing files can still be downloaded and deleted' }, null];
  return [null, true];
};
