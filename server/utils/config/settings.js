import { getSetting } from 'kempo/server/sdk.js';

export const DEFAULTS = {
  rootFolder: 'users',
  autoProvision: true,
  usageStaleMinutes: 60,
};

/*
  The declared settings, read together and normalised once.

  `root_folder` becomes a real path segment, so it goes through the same shape of validation
  kempo-files applies to any other name — a setting containing a slash would otherwise turn into a
  nested folder nobody asked for, and one containing `..` into an escape from the library.
*/
export const readConfig = async () => {
  const [, rootFolder] = await getSetting('kempo-user-dirs', 'root_folder', DEFAULTS.rootFolder);
  const [, autoProvision] = await getSetting('kempo-user-dirs', 'auto_provision', DEFAULTS.autoProvision);
  const [, usageStaleMinutes] = await getSetting('kempo-user-dirs', 'usage_stale_minutes', DEFAULTS.usageStaleMinutes);

  return {
    rootFolder: normaliseRootFolder(rootFolder),
    autoProvision: autoProvision === true || autoProvision === 'true',
    usageStaleMinutes: Math.max(0, Number(usageStaleMinutes) || 0),
  };
};

export const normaliseRootFolder = value => {
  const trimmed = String(value ?? '').trim().replace(/^[\\/]+|[\\/]+$/g, '');
  if(!trimmed || /[\\/:*?"<>|]/.test(trimmed) || trimmed === '.' || trimmed === '..'){
    return DEFAULTS.rootFolder;
  }
  return trimmed;
};
