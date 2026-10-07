// Nick's photo measurements and long-hair head profile.
import { readFileSync } from 'node:fs';
import { decodePng } from '../lib/png.mjs';
import { createPhotoHead } from '../lib/photo-head.mjs';
const spec = JSON.parse(readFileSync(new URL('photo.json', import.meta.url), 'utf8'));
const front = () => decodePng(readFileSync(new URL('art/front.png', import.meta.url)));
export const { photo, toLocal, frontGrid, sideGrid, surfaceX, EDGE_INSET, loadFront, silhouette, RINGS, buildHead } =
  createPhotoHead(spec, front, { depthScale: 0.78, sidePanels: true, sideBottom: -4.5, frontSamples: 25, backSamples: 11 });
