import install from './install.js';

/*
  Updating is the same job as installing: make sure there is a default storage plan and otherwise
  leave everything alone.

  New settings, permissions and groups are added by kempo's own declarative diff before this runs,
  and existing values are never overwritten — so a site that renamed its plans, moved its root
  folder or set its own limits keeps all of it.
*/
export default async () => {
  await install();
};
