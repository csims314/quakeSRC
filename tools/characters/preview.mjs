// Renders review images of a built character model without the game.
// Usage: node tools/characters/preview.mjs <model.mdl> <out.png> [head|body] [frame names...]
import { readFileSync, writeFileSync } from 'node:fs';
import { readMdl, framePositions } from './lib/mdl.mjs';
import { encodePng } from './lib/png.mjs';
import { indexedToRgba } from './lib/palette.mjs';
import { createImage, camera, drawMesh, downsample, sheet } from './lib/render.mjs';

const [file, out, view = 'body', ...frameNames] = process.argv.slice(2);
if (!file || !out) throw new Error('Usage: preview.mjs <model.mdl> <out.png> [head|body] [frame names...]');
const palette = readFileSync(new URL('vendor/librequake/palette.lmp', import.meta.url));
const model = readMdl(readFileSync(file));
const texture = { width: model.skinWidth, height: model.skinHeight, rgba: indexedToRgba(model.skins[0], palette) };
const triangles = model.triangles.map(t => ({
  v: t.v,
  uv: t.v.map(i => [model.stverts[i].s + (!t.front && model.stverts[i].onseam ? model.skinWidth / 2 : 0) + 0.5, model.stverts[i].t + 0.5]),
}));
const frames = frameNames.length ? frameNames : [model.frames.length > 12 ? 'stand1' : model.frames[0].name];
const images = [];
for (const name of frames) {
  const frame = model.frames.find(f => f.name === name);
  if (!frame) throw new Error(`No frame named ${name}`);
  const positions = framePositions(model, frame);
  const angles = view === 'head' ? [0, 35, 90, 180] : [20, 160];
  for (const angle of angles) {
    const r = (angle * Math.PI) / 180, image = createImage(view === 'head' ? 440 : 400, view === 'head' ? 520 : 640);
    const head = positions.filter((_, i) => model.frames.length === 1 || model.stverts[i].s >= 296);
    const low = Math.min(...head.map(p => p[2])), high = Math.max(...head.map(p => p[2]));
    const target = view === 'head' ? [0.6, -1.3, (low + high) / 2] : [0, 0, 2];
    const distance = 90;
    const cam = camera({ eye: [target[0] + Math.cos(r) * distance, target[1] + Math.sin(r) * distance, target[2] + (view === 'head' ? 1 : 12)], target, ortho: view === 'head' ? Math.max(7, (high - low) * 0.6) : 36 });
    drawMesh(image, { positions, triangles, texture }, cam, { light: [0.7, 0.35, 0.65], ambient: 0.5 });
    images.push(downsample(image, 2));
  }
}
const result = sheet(images, view === 'head' ? 4 : Math.min(images.length, 6));
writeFileSync(out, encodePng(result.width, result.height, result.rgba));
console.log(`Wrote ${out}`);
