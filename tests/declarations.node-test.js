import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULTS } from '../server/utils/config/settings.js';

/*
  Static checks that what the code asks for is what the extension declares.

  This is the shape of bug kempo-blog shipped: its config declared prefixed permission names while
  its routes checked unprefixed ones, so its "New Post" gate silently denied everyone. A permission
  check against a name nobody registered does not error — it answers no, forever, and only for
  people who are not administrators, which is why it survives manual testing.

  It matters more here than in most extensions, because the permissions are the paywall. A
  `userdirs:access` that no group grants is a feature nobody can reach; a `userdirs:others:browse`
  that nothing checks is one everybody can.
*/

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, 'kempo-config.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

const walk = async dir => {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for(const entry of entries){
    if(entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if(entry.isDirectory()) files.push(...await walk(full));
    else if(entry.name.endsWith('.js')) files.push(full);
  }
  return files;
};

const sources = [
  ...await walk(path.join(root, 'public')),
  ...await walk(path.join(root, 'server')),
  ...await walk(path.join(root, 'hooks')),
  ...await walk(path.join(root, 'admin')),
];

const allText = (await Promise.all(sources.map(file => readFile(file, 'utf8')))).join('\n');
const pageText = (await Promise.all([
  path.join(root, 'admin', 'index.page.html'),
  path.join(root, 'admin', 'browse.page.html'),
  path.join(root, 'public', 'index.page.html'),
].map(file => readFile(file, 'utf8')))).join('\n');

export default {
  'every permission the code checks is one the extension declares': async ({ pass, fail }) => {
    const declared = new Set(config.permissions.map(permission => permission.name));
    const used = new Map();

    for(const file of sources){
      const text = await readFile(file, 'utf8');
      const patterns = [
        /(?:currentUserHasPermission|requirePermission|hasPermission|userHasPermission)\s*\([^,]+,\s*['"]([^'"]+)['"]/g,
        /`userdirs:others:\$\{[^}]+\}`/g,
      ];

      for(const match of text.matchAll(patterns[0])){
        used.set(match[1], path.relative(root, file));
      }
    }

    const undeclared = [...used].filter(([name]) => !declared.has(name));
    if(undeclared.length){
      return fail(undeclared.map(([name, file]) => `${name} (checked in ${file})`).join('; '));
    }
    pass(`${used.size} permission checks, all declared`);
  },

  'every declared permission is actually used somewhere': async ({ pass, fail }) => {
    /*
      The other direction. A declared permission nothing checks is one an admin can grant with no
      effect, which is worse than not having it — it reads like a control that does something.

      `userdirs:others:browse` and `:manage` are also built by template literal in the gate, so the
      admin pages' own `k-permission has="…"` attributes count as a use too.
    */
    const unused = config.permissions
      .map(permission => permission.name)
      .filter(name => !allText.includes(`'${name}'`) && !allText.includes(`"${name}"`) && !pageText.includes(name));

    if(unused.length) return fail(`declared but never checked: ${unused.join(', ')}`);
    pass('every declared permission is enforced somewhere');
  },

  'every permission a declared group grants is a declared permission': async ({ pass, fail }) => {
    /*
      A group naming a permission that does not exist silently grants nothing — and this extension's
      whole gating story is "add them to the member group". If that group's permission name were
      wrong, adding somebody would appear to work and give them nothing.
    */
    const declared = new Set(config.permissions.map(permission => permission.name));
    const bad = [];

    for(const group of config.groups){
      for(const name of group.permissions){
        if(!declared.has(name)) bad.push(`${group.name} grants undeclared ${name}`);
      }
    }

    if(bad.length) return fail(bad.join('; '));
    pass(`${config.groups.length} groups, every permission declared`);
  },

  'the member group grants the permission the feature is gated on': async ({ pass, fail }) => {
    const member = config.groups.find(group => group.name === 'kempo-user-dirs:member');
    if(!member) return fail('there is no kempo-user-dirs:member group to add people to');
    if(!member.permissions.includes('userdirs:access')){
      return fail('the member group does not grant userdirs:access, so joining it would give nobody a space');
    }
    pass('joining the member group is what grants a space');
  },

  'every declared hook points at a file that exists': async ({ pass, fail }) => {
    const missing = [];

    for(const [event, file] of Object.entries(config.hooks)){
      try {
        await stat(path.join(root, file));
      } catch {
        missing.push(`${event} -> ${file}`);
      }
    }

    if(missing.length) return fail(`hook handlers that do not exist: ${missing.join(', ')}`);
    pass(`${Object.keys(config.hooks).length} hooks, all resolvable`);
  },

  'every declared setting has a matching fallback in the code': async ({ pass, fail }) => {
    /*
      An extension should work the moment it is enabled. A declared default that does not match the
      fallback the code uses means the behaviour changes the first time somebody saves the settings
      screen without editing anything — which looks like a bug in whatever they *did* change.
    */
    const names = { root_folder: 'rootFolder', auto_provision: 'autoProvision', usage_stale_minutes: 'usageStaleMinutes' };
    const mismatched = [];

    for(const setting of config.settings){
      const key = names[setting.name];
      if(!key || !(key in DEFAULTS)){
        mismatched.push(`${setting.name} has no fallback in DEFAULTS`);
        continue;
      }

      const stored = setting.type === 'number' ? Number(setting.value)
        : setting.type === 'boolean' ? setting.value === 'true'
        : setting.value;

      if(stored !== DEFAULTS[key]){
        mismatched.push(`${setting.name}: config says ${JSON.stringify(stored)}, code falls back to ${JSON.stringify(DEFAULTS[key])}`);
      }
    }

    if(mismatched.length) return fail(mismatched.join('; '));
    pass('declared defaults match the code’s own fallbacks');
  },

  'the public scope in package.json is the one the code builds URLs from': async ({ pass, fail }) => {
    /*
      kempo's scope router reads `public-scope` out of package.json, while everything else this
      extension declares lives in kempo-config.json — so the two can drift. Every URL in the browser
      SDK and every component import is hardcoded to the scope; if package.json said something else,
      the extension would install cleanly and 404 on its own assets.
    */
    const scope = pkg.kempo?.['public-scope'];
    if(!scope) return fail('package.json declares no kempo.public-scope, so nothing under public/ would be served');
    if(scope !== config['public-scope']){
      return fail(`package.json says "${scope}", kempo-config.json says "${config['public-scope']}"`);
    }

    const sdk = await readFile(path.join(root, 'public', 'sdk.js'), 'utf8');
    if(!sdk.includes(`'/${scope}/api'`)){
      return fail(`the browser SDK does not build its URLs from /${scope}/api`);
    }
    pass(`public scope is "${scope}" everywhere`);
  },

  'kempo-files is declared as a dependency, not merely imported': async ({ pass, fail }) => {
    /*
      Without the declaration, kempo lets this extension be enabled with kempo-files disabled — and
      every route fails at import time rather than with anything explaining why.
    */
    if(!config.dependencies?.includes('kempo-files')){
      return fail('kempo-config.json does not declare kempo-files in dependencies');
    }
    if(!pkg.peerDependencies?.['kempo-files']){
      return fail('package.json does not peer-depend on kempo-files, so npm would not install it');
    }
    pass('kempo-files is required both by kempo and by npm');
  },
};
