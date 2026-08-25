import { directoryAncestry } from 'kempo-files/sdk';
import { spacesForDirectories } from './spaces.js';

/*
  Which space, if any, a folder is inside.

  This is the containment check the whole extension rests on. Every route that acts on a file or a
  folder resolves it here first and refuses anything that does not land in the space the caller is
  allowed to touch — so a member cannot reach into somebody else's folder by passing its id, which
  is otherwise a completely ordinary-looking request.

  It answers by walking the folder's ancestry rather than comparing paths. A path is a string that
  changes when anything above it is renamed; the ancestry is what kempo-files itself goes by, so
  the two can never disagree.
*/
export const resolveSpace = async directoryId => {
  if(!directoryId) return [null, null];   // the library root belongs to nobody

  const [ancestryError, ancestry] = await directoryAncestry(directoryId);
  if(ancestryError) return [ancestryError, null];

  const [spacesError, spaces] = await spacesForDirectories(ancestry.map(directory => directory.id));
  if(spacesError) return [spacesError, null];
  if(!spaces.length) return [null, null];

  /*
    Deepest match wins. Spaces are all siblings under one root folder today, so there can only ever
    be one — but reading the chain from the bottom means a future nested arrangement resolves to
    the innermost owner rather than whichever row the database handed back first.
  */
  for(let index = ancestry.length - 1; index >= 0; index--){
    const match = spaces.find(space => space.directoryId === ancestry[index].id);
    if(match) return [null, match];
  }

  return [null, null];
};

export const resolveSpaceForFile = file => resolveSpace(file?.directoryId);

/*
  Returns an error tuple rather than a boolean so callers can hand the message straight back. The
  message says the thing was not found, not that it was refused: confirming that a folder id exists
  but belongs to someone else is itself a small leak, and there is nothing a member can do with the
  distinction anyway.
*/
export const requireWithinSpace = async (space, directoryId) => {
  if(directoryId === space.directoryId) return [null, true];

  const [error, owner] = await resolveSpace(directoryId);
  if(error) return [error, null];
  if(!owner || owner.id !== space.id) return [{ code: 404, msg: 'That folder is not in this file space' }, null];

  return [null, true];
};

export const requireFileWithinSpace = async (space, file) => {
  const [error, owner] = await resolveSpaceForFile(file);
  if(error) return [error, null];
  if(!owner || owner.id !== space.id) return [{ code: 404, msg: 'That file is not in this file space' }, null];

  return [null, true];
};
