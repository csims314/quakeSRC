// Chris uses the shared animated body with his own photo head and HUD.
import { createCharacterBuilder } from '../lib/character.mjs';
import { buildHead, loadFront, frontGrid, RINGS } from './head.mjs';
import { frontTexture, backTexture } from './textures.mjs';
import { hudFaces, shrink } from './hud.mjs';
export const { buildPlayer, buildGibHead, buildFiles: buildChris } = createCharacterBuilder({
  buildHead, loadFront, frontGrid, RINGS, frontTexture, backTexture, hudFaces, shrink, gibBottom: -3.95,
});
