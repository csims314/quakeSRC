// Builds the player characters into web/dist/characters.
// Usage: node tools/characters/build.mjs [--check]
//   --check compares the committed files with a fresh build instead of writing.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildNick } from './nick/build.mjs';

const output = new URL('../../web/dist/characters/', import.meta.url);
const credits = `Player characters

Nick
  Head and status-bar faces: made for this project from a photo of Nick, used with his permission.
  Body and animation: LibreQuake player model (lq1/progs/player.mdl), commit
  4d2da523331f00211c97c90dc5af8672a2967618, under the license below.

${readFileSync(new URL('vendor/librequake/COPYING', import.meta.url), 'utf8')}`;

export function buildCharacters() {
  const nick = buildNick();
  const manifest = {
    characters: [
      { id: 'ranger', name: 'Ranger', description: 'The original Quake marine.' },
      { id: 'nick', name: 'Nick', description: 'Long hair, glasses and a big grin.', portrait: 'characters/nick/face1.png', files: [...nick.keys()].sort() },
    ],
  };
  return new Map([
    ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')],
    ['CREDITS.txt', Buffer.from(credits)],
    ...[...nick].map(([name, bytes]) => [`nick/${name}`, bytes]),
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = buildCharacters();
  if (process.argv.includes('--check')) {
    const stale = [...files].filter(([name, bytes]) => {
      try { return !readFileSync(new URL(name, output)).equals(bytes); } catch { return true; }
    }).map(([name]) => name);
    if (stale.length) { console.error(`Out of date: ${stale.join(', ')}. Run node tools/characters/build.mjs`); process.exit(1); }
    console.log('Character files are up to date.');
  } else {
    mkdirSync(new URL('nick/', output), { recursive: true });
    for (const [name, bytes] of files) writeFileSync(new URL(name, output), bytes);
    console.log(`Wrote ${files.size} files to web/dist/characters`);
  }
}
