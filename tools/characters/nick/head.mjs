// The photo supplies the head only. A separate neck joins it to the armor.
import { readFileSync } from 'node:fs';
import { decodePng } from '../lib/png.mjs';
import { createPhotoHead } from '../lib/photo-head.mjs';
const spec = JSON.parse(readFileSync(new URL('photo.json', import.meta.url), 'utf8'));
const front = () => decodePng(readFileSync(new URL('art/front.png', import.meta.url)));
export const NECK = {
  top: [-0.6, -1.3, 22.3], bottom: [-0.6, -1.3, 15.4],
  topRadius: [1.1, 1.3], bottomRadius: [0.92, 1.1],
};
const rings = [3.5, 3.2, 2.8, 2.35, 1.9, 1.45, 1.05, 0.7, 0.35, 0, -0.35, -0.7, -1, -1.3, -1.6,
  -1.95, -2.3, -2.65, -3.05, -3.5, -4, -4.45, -4.75];
export const { photo, toLocal, frontGrid, sideGrid, surfaceX, EDGE_INSET, loadFront, silhouette, RINGS, buildHead } =
  createPhotoHead(spec, front, { rings, bottomOffset: 0.03, depthScale: 0.78, sidePanels: true,
    frontSamples: 25, backSamples: 11, skinWeight: () => 1,
    jaw: { chin: -4.75, side: -3.1, nape: -3.3, underside: -3.7 } });
