import { createDirectory, listDirectories } from 'kempo-files/sdk';
import { readConfig } from '../config/settings.js';

/*
  Every space is a folder inside one shared parent — `files/users/` by default.

  Grouping them matters more than it looks. It keeps the file library's root readable however many
  members a site has, it gives an admin one folder to back up or exclude, and it is what makes
  "which space is this file in?" answerable by walking up a folder chain instead of consulting a
  list of every user.
*/

export const SYSTEM_OWNER = 'kempo-user-dirs';

/*
  Created lazily, so a site that installs this and never adds anyone to the group never grows an
  empty folder in its library.

  The 409 retry is not defensive noise: two members opening their space for the first time at once
  both find nothing and both try to create it. kempo-files refuses the second with a conflict, and
  the right answer there is the folder the other request just made, not an error.
*/
export const rootDirectory = async () => {
  const { rootFolder } = await readConfig();

  const [findError, found] = await findRoot(rootFolder);
  if(findError) return [findError, null];
  if(found) return [null, found];

  const [createError, created] = await createDirectory({ name: rootFolder, parentId: null, ownerId: SYSTEM_OWNER });
  if(!createError) return [null, created];

  if(createError.code === 409){
    const [retryError, retried] = await findRoot(rootFolder);
    if(retryError) return [retryError, null];
    if(retried) return [null, retried];
  }

  return [createError, null];
};

const findRoot = async name => {
  const [error, data] = await listDirectories({ parentId: null });
  if(error) return [error, null];
  return [null, data.directories.find(directory => directory.name === name) || null];
};
