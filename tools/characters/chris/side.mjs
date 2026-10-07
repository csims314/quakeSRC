import { readFileSync } from 'node:fs';
import { decodePng } from '../lib/png.mjs';
import { createSideTextures } from '../lib/side-textures.mjs';
import * as head from './head.mjs';
export const sideTextures = createSideTextures(head,
  () => decodePng(readFileSync(new URL('art/profile.png', import.meta.url))),
  JSON.parse(readFileSync(new URL('profile.json', import.meta.url), 'utf8')));
