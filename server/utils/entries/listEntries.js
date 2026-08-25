import { listDirectories, listFiles, directoryAncestry } from 'kempo-files/sdk';
import { requireWithinSpace } from '../spaces/scope.js';

/*
  One folder of a space: the folders in it, the files in it, and the trail back to the top.

  The breadcrumb is cut at the space's own root rather than the library's. A member has no business
  knowing their folder sits inside `users/`, and showing them a step they are not allowed to climb
  to is worse than not showing it — so the chain above their home is dropped, and the home itself
  is presented as "Home" rather than the hex id it is actually named.
*/
export default async ({ space, directoryId, search, kind, limit = 200, offset = 0 } = {}) => {
  const target = directoryId || space.directoryId;

  const [scopeError] = await requireWithinSpace(space, target);
  if(scopeError) return [scopeError, null];

  const [directoriesError, directoriesData] = await listDirectories({ parentId: target });
  if(directoriesError) return [directoriesError, null];

  const [filesError, filesData] = await listFiles({ directoryId: target, search, kind, limit, offset });
  if(filesError) return [filesError, null];

  const [breadcrumbError, breadcrumb] = await trailWithin(space, target);
  if(breadcrumbError) return [breadcrumbError, null];

  return [null, {
    directoryId: target,
    isRoot: target === space.directoryId,
    breadcrumb,
    directories: directoriesData.directories.map(directory => ({
      id: directory.id,
      name: directory.name,
      createdAt: directory.createdAt,
    })),
    files: filesData.files,
    total: filesData.total,
    limit,
    offset,
  }];
};

const trailWithin = async (space, directoryId) => {
  const [error, ancestry] = await directoryAncestry(directoryId);
  if(error) return [error, null];

  const start = ancestry.findIndex(directory => directory.id === space.directoryId);
  if(start === -1) return [{ code: 404, msg: 'That folder is not in this file space' }, null];

  return [null, ancestry.slice(start).map((directory, index) => ({
    id: directory.id,
    name: index === 0 ? 'Home' : directory.name,
  }))];
};
