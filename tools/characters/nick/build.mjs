// Nick uses the shared body/animation assembler with his photo head and HUD.
import { createCharacterBuilder } from '../lib/character.mjs';
import { buildHead, loadFront, frontGrid, RINGS } from './head.mjs';
import { frontTexture, backTexture } from './textures.mjs';
import { hudFaces, shrink } from './hud.mjs';
import { sideTextures } from './side.mjs';
export { palette } from '../lib/character.mjs';
export const { buildPlayer, buildGibHead, buildFiles: buildNick } = createCharacterBuilder({
  buildHead, loadFront, frontGrid, RINGS, frontTexture, backTexture, sideTextures, hudFaces, shrink,
});
