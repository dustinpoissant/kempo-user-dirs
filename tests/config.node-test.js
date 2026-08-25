import { normaliseRootFolder, DEFAULTS } from '../server/utils/config/settings.js';

/*
  `root_folder` is an admin-editable string that becomes a real path segment on disk. Every case
  below is a way a typo or a hostile value could make it mean something other than one folder in
  the library — which is why it is validated rather than trusted, even though the person setting it
  is an administrator.
*/

export default {
  'an ordinary name is left alone': async ({ pass, fail }) => {
    if(normaliseRootFolder('members') !== 'members') return fail('a plain name should survive');
    if(normaliseRootFolder('  members  ') !== 'members') return fail('surrounding whitespace should be trimmed');
    pass('a normal folder name passes through');
  },

  'traversal falls back to the default rather than escaping the library': async ({ pass, fail }) => {
    for(const value of ['..', '.', '../../etc', 'a/b', 'a\\b']){
      const result = normaliseRootFolder(value);
      if(result !== DEFAULTS.rootFolder){
        return fail(`${JSON.stringify(value)} produced ${JSON.stringify(result)} instead of the default`);
      }
    }
    pass('separators and traversal segments are refused');
  },

  'a blank or missing value falls back rather than producing an unnamed folder': async ({ pass, fail }) => {
    for(const value of ['', '   ', null, undefined]){
      if(normaliseRootFolder(value) !== DEFAULTS.rootFolder){
        return fail(`${JSON.stringify(value)} did not fall back to the default`);
      }
    }
    pass('an empty setting uses the default');
  },

  'characters that are illegal on Windows are refused': async ({ pass, fail }) => {
    /*
      kempo-files' own name validator would refuse these too, but it would refuse them at folder
      *creation* — which is the first time anybody opens their space, with a message about a name
      they never typed. Catching it in the setting keeps the failure where the mistake was made.
    */
    for(const value of ['users:1', 'us?ers', 'user*s', 'a|b', 'a<b']){
      if(normaliseRootFolder(value) !== DEFAULTS.rootFolder){
        return fail(`${JSON.stringify(value)} was allowed through`);
      }
    }
    pass('illegal path characters fall back to the default');
  },
};
