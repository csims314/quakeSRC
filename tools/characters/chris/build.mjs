// Chris uses the shared animated body with his own photo head and HUD.
import { createCharacterBuilder } from '../lib/character.mjs';
import { buildHead, loadFront, frontGrid, RINGS } from './head.mjs';
import { frontTexture, backTexture } from './textures.mjs';
import { hudFaces, shrink } from './hud.mjs';
import { sideTextures } from './side.mjs';
import { neckTexture } from './neck.mjs';
export const { buildPlayer, buildGibHead, buildFiles: buildChris } = createCharacterBuilder({
  buildHead, loadFront, frontGrid, RINGS, frontTexture, backTexture, sideTextures, neckTexture, hudFaces, shrink, gibBottom: -3.95,
  headScale: 1.5, neckTop: -3.8, neckBase: -7.3,
});
