import { searchUsers, userHasPermission } from 'kempo/server/sdk.js';
import { requireSession, requirePermission } from '../../../server/utils/permissions/gate.js';
import { getSpace } from '../../../server/utils/spaces/spaces.js';

/*
  Who could be given a space but does not have one yet — the search behind the admin's "Create a
  space" box.

  It filters on the permission rather than on membership of this extension's own group, because the
  group is only the shipped way of granting it. A site that puts `userdirs:access` on its own
  "Subscribers" group, or on a group an ecommerce extension manages, still gets the right answer.

  One permission lookup per candidate, which is why the page size is small and capped: the
  alternative is a join across group membership that would have to know how kempo composes
  permissions, and duplicating that here is how the two quietly stop agreeing.
*/
export default async (request, response) => {
  const [sessionError, session] = await requireSession(request);
  if(sessionError) return response.status(sessionError.code).json({ error: sessionError.msg });

  const [permError] = await requirePermission(session.token, 'userdirs:provision');
  if(permError) return response.status(permError.code).json({ error: permError.msg });

  const [searchError, found] = await searchUsers({
    q: request.query?.q || '',
    limit: Math.min(25, Number(request.query?.limit) || 10),
  });
  if(searchError) return response.status(searchError.code).json({ error: searchError.msg });

  const users = [];
  for(const candidate of found.users){
    const [, eligible] = await userHasPermission(candidate.id, 'userdirs:access');
    if(!eligible) continue;

    const [spaceError] = await getSpace(candidate.id);
    if(!spaceError) continue;   // already has one

    users.push({ id: candidate.id, name: candidate.name, email: candidate.email });
  }

  response.json({ users });
};
