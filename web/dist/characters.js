// Player characters, shared by the browser launcher and the multiplayer server.
// Each character's files are installed into the engine's game directory as
// characters/<id>/..., and characters/list.txt names the ones the engine may use.
export const DEFAULT_CHARACTER = 'ranger';
const ID = /^[a-z0-9_]{1,15}$/;
const FILE = /^[a-z0-9_]{1,32}\.(mdl|lmp|png)$/;

export function validateManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.characters)) throw new Error('Invalid character manifest');
  const seen = new Set();
  for (const character of manifest.characters) {
    if (!ID.test(character?.id) || seen.has(character.id) || typeof character.name !== 'string') throw new Error('Invalid character in manifest');
    if (character.files !== undefined && (!Array.isArray(character.files) || !character.files.every(file => FILE.test(file)))) {
      throw new Error(`Invalid files for character ${character.id}`);
    }
    seen.add(character.id);
  }
  if (!seen.has(DEFAULT_CHARACTER)) throw new Error('The manifest must include the original player');
  return manifest;
}

// read(id, file) returns the file's bytes; files are fetched in parallel.
export async function installCharacters(FS, manifest, read) {
  const installed = manifest.characters.filter(character => character.files?.length);
  await Promise.all(installed.map(async character => {
    const directory = `/quake/id1/characters/${character.id}`;
    const files = await Promise.all(character.files.map(file => read(character.id, file)));
    FS.mkdirTree(directory);
    character.files.forEach((file, i) => FS.writeFile(`${directory}/${file}`, files[i]));
  }));
  FS.mkdirTree('/quake/id1/characters');
  FS.writeFile('/quake/id1/characters/list.txt', installed.map(character => character.id).join('\n') + '\n');
  return installed.map(character => character.id);
}
