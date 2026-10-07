// Nick's photo head continues into a single tapered neck, beneath the beard.
import { readFileSync } from 'node:fs';
import { decodePng } from '../lib/png.mjs';
import { createPhotoHead } from '../lib/photo-head.mjs';
const spec = JSON.parse(readFileSync(new URL('photo.json', import.meta.url), 'utf8'));
const front = () => decodePng(readFileSync(new URL('art/front.png', import.meta.url)));
export const NECK = {
  start: -4.0, throat: -5.25, base: -7.3,
  center: [-0.65, 0], baseCenter: [-0.65, 0],
  radius: [0.9, 1.05], baseRadius: [0.5, 0.68],
};
const rings = [3.5, 3.2, 2.8, 2.35, 1.9, 1.45, 1.05, 0.7, 0.35, 0, -0.35, -0.7, -1, -1.3, -1.6,
  -1.95, -2.3, -2.65, -3.05, -3.5, -4, -4.25, -4.5, -4.75, -5, -5.25, -5.6, -6, -6.4, -6.85, -7.3];
const skinWeight = (_y, z) => {
  const t = Math.max(0, Math.min(1, (NECK.start - z) / (NECK.start + 6.2)));
  return 1 - t * t * (3 - 2 * t);
};
export const { photo, toLocal, frontGrid, sideGrid, surfaceX, EDGE_INSET, loadFront, silhouette, RINGS, buildHead } =
  createPhotoHead(spec, front, { rings, neck: NECK, depthScale: 0.78, sidePanels: true,
    frontSamples: 25, backSamples: 11, skinWeight });
