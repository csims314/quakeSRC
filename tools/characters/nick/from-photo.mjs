// Usage: node tools/characters/nick/from-photo.mjs path/to/nick.png
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { decodePng, encodePng } from '../lib/png.mjs';
import { createPhotoArt } from '../lib/photo-art.mjs';
const spec = JSON.parse(readFileSync(new URL('photo.json', import.meta.url), 'utf8'));
if (!process.argv[2]) throw new Error('Pass the path of the source photo as a PNG file');
const art = new URL('art/', import.meta.url);
mkdirSync(art, { recursive: true });
for (const [name, image] of Object.entries(createPhotoArt(decodePng(readFileSync(process.argv[2])), spec))) {
  writeFileSync(new URL(`${name}.png`, art), encodePng(image.width, image.height, image.rgba));
}
console.log('Wrote tools/characters/nick/art/front.png and hud.png');
