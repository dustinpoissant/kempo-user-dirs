import { directorySubtree } from 'kempo-files/sdk';
import { authorizeSpace } from '../../../server/utils/permissions/gate.js';

/*
  Every folder in a space, flat, each with the path it sits at.

  A move destination picker needs all of them at once, and asking for one level per click would
  make choosing a folder five deep five round trips. The paths are built here rather than in the
  browser because the browser would have to re-derive the same parent chain to do it, and the space
  root has to be relabelled "Home" anyway — doing that once, on the side that already knows which
  folder is the root, is one implementation instead of two.
*/
export default async (request, response) => {
  const [error, context] = await authorizeSpace(request, { userId: request.query?.userId });
  if(error) return response.status(error.code).json({ error: error.msg });

  const [treeError, tree] = await directorySubtree(context.space.directoryId);
  if(treeError) return response.status(treeError.code).json({ error: treeError.msg });

  const names = new Map(tree.map(directory => [directory.id, directory.name]));
  const parents = new Map(tree.map(directory => [directory.id, directory.parentId]));

  const pathOf = id => {
    const segments = [];
    let current = id;
    while(current && current !== context.space.directoryId){
      segments.unshift(names.get(current));
      current = parents.get(current);
    }
    return segments.length ? `Home / ${segments.join(' / ')}` : 'Home';
  };

  response.json({
    folders: tree.map(directory => ({
      id: directory.id,
      name: directory.id === context.space.directoryId ? 'Home' : directory.name,
      parentId: directory.id === context.space.directoryId ? null : directory.parentId,
      path: pathOf(directory.id),
      isRoot: directory.id === context.space.directoryId,
    })).sort((a, b) => a.path.localeCompare(b.path)),
  });
};
