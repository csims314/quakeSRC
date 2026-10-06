// Usage: node tools/characters/chris/from-photo.mjs path/to/chris.png
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { decodePng, encodePng } from '../lib/png.mjs';
import { createPhotoArt } from '../lib/photo-art.mjs';

const spec = JSON.parse(readFileSync(new URL('photo.json', import.meta.url), 'utf8'));
if (!process.argv[2]) throw new Error('Pass the path of the supplied Chris photo as a PNG file');
// Keep the head and a short neck. The portrait's shirt and shoulders must not
// become part of the head silhouette where the neck joins the animated body.
const maskPixel = (x, y) => {
  if (y <= 715) return true;
  const t = Math.min(1, (y - 715) / 75);
  return y < 845 && x > 225 + 75 * t && x < 530 - 75 * t;
};
const images = createPhotoArt(decodePng(readFileSync(process.argv[2])), spec, { maskPixel, erodeRadius: 2 });
const art = new URL('art/', import.meta.url);
mkdirSync(art, { recursive: true });
for (const [name, image] of Object.entries(images)) {
  writeFileSync(new URL(`${name}.png`, art), encodePng(image.width, image.height, image.rgba));
}
console.log('Wrote tools/characters/chris/art/front.png and hud.png');
