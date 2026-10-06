// Chris's short-haired head, measured from the supplied photo.
import { readFileSync } from 'node:fs';
import { decodePng } from '../lib/png.mjs';
import { createPhotoHead } from '../lib/photo-head.mjs';

const spec = JSON.parse(readFileSync(new URL('photo.json', import.meta.url), 'utf8'));
const front = () => decodePng(readFileSync(new URL('art/front.png', import.meta.url)));
const profile = {
  z: [3.7, 3.4, 3, 2.6, 2.2, 1.6, 1, 0.6, 0, -0.6, -1.2, -1.8, -2.4, -3, -3.6, -4.2, -4.5],
  front: [-0.3, 1, 1.8, 2.4, 2.8, 3, 3.05, 3.1, 3, 3, 3.05, 2.95, 2.8, 2.65, 2.25, 1.25, 1.1],
  side: [-0.4, -0.4, -0.4, -0.4, -0.45, -0.5, -0.55, -0.6, -0.6, -0.65, -0.7, -0.8, -0.9, -1, -1, -0.8, -0.8],
  back: [-0.5, -1.2, -2, -2.7, -3.1, -3.4, -3.55, -3.6, -3.6, -3.5, -3.3, -3, -2.7, -2.2, -1.8, -1.6, -1.5],
};
const rings = [3.5, 3.2, 2.8, 2.35, 1.9, 1.45, 1.05, 0.7, 0.35, 0, -0.35, -0.7, -1, -1.3, -1.6, -1.95, -2.3, -2.65, -3.05, -3.5, -3.8, -4.15];
// The jaw moves with the head; the bottom of the neck blends into the chest.
const skinWeight = (_y, z) => 1 - 0.75 * Math.max(0, Math.min(1, (-z - 3.5) / 0.9));
export const { photo, toLocal, frontGrid, EDGE_INSET, loadFront, silhouette, RINGS, buildHead } =
  createPhotoHead(spec, front, { profile, rings, crown: 3.7, skinWeight, frontSamples: 25, backSamples: 11 });
