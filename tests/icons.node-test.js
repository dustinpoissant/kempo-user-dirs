import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

/*
  Every icon this extension names has to exist in a set the page will actually search.

  A missing icon is the quietest bug in the stack: `<k-icon name="folder-create">` 404s through
  every configured path and renders nothing at all — no error, no console warning, just a button
  with a gap where its glyph should be. This suite exists because exactly that shipped in the first
  draft: `create_new_folder`, `refresh` and `storage` all read like obvious Material Symbols names,
  and none of them is in the sets kempo actually serves.

  The two contexts search different sets, which is the other half of the trap:

    admin pages   /admin/icons, /kempo/icons, /kempo-ui/icons   (kempo's admin init.js)
    public pages  /icons,       /kempo/icons, /kempo-ui/icons   (kempo's app-public init.js)

  So an icon that works on the admin screen can still be missing on the member's own page. Anything
  under public/ — including the components the admin pages import from there — is held to the
  public list.

  `/icons` is the site's own folder, which this extension cannot see and does not ship into, so it
  is deliberately not counted as a source.
*/

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modules = path.join(root, 'node_modules');

const readSet = async dir => {
  try {
    return (await readdir(dir)).filter(name => name.endsWith('.svg')).map(name => name.slice(0, -4));
  } catch {
    return null;
  }
};

/*
  A published kempo ships dist/; a sibling checkout may only have src/. Either is a legitimate way
  to run these tests, so both are looked for and whichever exists wins.
*/
const firstSet = async dirs => {
  for(const dir of dirs){
    const found = await readSet(dir);
    if(found?.length) return found;
  }
  return null;
};

const uiIcons = await firstSet([path.join(modules, 'kempo-ui', 'icons')]);
const coreIcons = await firstSet([
  path.join(modules, 'kempo', 'dist', 'kempo', 'icons'),
  path.join(modules, 'kempo', 'src', 'kempo', 'icons'),
]);
const adminIcons = await firstSet([
  path.join(modules, 'kempo', 'dist', 'admin', 'icons'),
  path.join(modules, 'kempo', 'src', 'admin', 'icons'),
]);

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
    else if(entry.name.endsWith('.js') || entry.name.endsWith('.html')) files.push(full);
  }
  return files;
};

/*
  Matches `<k-icon name="x">` and `icon="x"` on an aside item, but not `name=${expression}` — a
  computed name cannot be checked statically, and the maps that produce them are checked separately
  below.
*/
const namesIn = text => [
  ...[...text.matchAll(/<k-icon[^>]*\sname="([a-z0-9_-]+)"/gi)].map(match => match[1]),
  ...[...text.matchAll(/\sicon="([a-z0-9_-]+)"/gi)].map(match => match[1]),
];

const collect = async dir => {
  const found = new Map();
  for(const file of await walk(dir)){
    for(const name of namesIn(await readFile(file, 'utf8'))){
      if(!found.has(name)) found.set(name, path.relative(root, file));
    }
  }
  return found;
};

const suite = {
  'every icon a public page names exists in a set that page searches': async ({ pass, fail }) => {
    const available = new Set([...coreIcons, ...uiIcons]);
    const used = await collect(path.join(root, 'public'));

    const missing = [...used].filter(([name]) => !available.has(name));
    if(missing.length){
      return fail(missing.map(([name, file]) => `${name} (${file})`).join('; ')
        + ' — public pages only search /icons, /kempo/icons and /kempo-ui/icons');
    }
    pass(`${used.size} icons on the member-facing pages, all resolvable`);
  },

  'every icon an admin page names exists in a set that page searches': async ({ pass, fail }) => {
    const available = new Set([...coreIcons, ...uiIcons, ...adminIcons]);
    const used = await collect(path.join(root, 'admin'));

    const missing = [...used].filter(([name]) => !available.has(name));
    if(missing.length){
      return fail(missing.map(([name, file]) => `${name} (${file})`).join('; '));
    }
    pass(`${used.size} icons on the admin screens, all resolvable`);
  },

  'the file-kind icon map resolves for every kind kempo-files can produce': async ({ pass, fail }) => {
    /*
      These names never appear as a literal in an attribute — they are looked up by the file's kind
      at render time, so the check above cannot see them. A member uploading a font would otherwise
      be the first to find out.
    */
    const source = await readFile(path.join(root, 'public', 'components', 'FileSpace.js'), 'utf8');
    const block = source.match(/const KIND_ICON = \{([^}]+)\}/);
    if(!block) return fail('could not find the KIND_ICON map to check');

    const available = new Set([...coreIcons, ...uiIcons]);
    const missing = [...block[1].matchAll(/:\s*'([^']+)'/g)]
      .map(match => match[1])
      .filter(name => !available.has(name));

    if(missing.length) return fail(`kind icons that do not exist: ${missing.join(', ')}`);
    pass('every file kind has a glyph');
  },
};

export default (uiIcons && coreIcons && adminIcons)
  ? suite
  : { 'icons (SKIPPED)': async ({ pass }) => pass('skipped: kempo or kempo-ui is not installed, so their icon sets cannot be read') };
