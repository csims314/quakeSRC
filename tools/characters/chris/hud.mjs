import { readFileSync } from 'node:fs';
import { decodePng } from '../lib/png.mjs';
import { createHud } from '../lib/hud.mjs';
import { photo } from './head.mjs';
export const { hudFaces, shrink } = createHud(photo,
  () => decodePng(readFileSync(new URL('art/hud.png', import.meta.url))));
