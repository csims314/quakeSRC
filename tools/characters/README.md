# Player characters

Players choose a character on the launch screen or with the toolbar's **Character** menu. The engine command is `character <name>`; `ranger` is the original player. The choice is sent when joining a server and whenever it changes, so other players see it straight away.

## How it works

- `web/dist/characters/manifest.json` lists the characters. The browser and every multiplayer room install each character's files into the engine as `characters/<name>/...` and write `characters/list.txt`.
- At each level start the server precaches `characters/<name>/player.mdl` and `h_player.mdl` for every listed character whose files exist.
- QuakeC still uses `progs/player.mdl`. When the server sends an entity whose model is the player or the gibbed head, and whose colormap belongs to a client with a character, it sends that character's model instead. That covers the live player, the corpse left after respawning, and the thrown head.
- The status bar uses `characters/<name>/face*.png` (96x96, drawn at the classic 24x24 size), falling back to `face*.lmp` and then to the original faces. The face follows the model the server actually shows for the player.
- Character skins are mipmapped, so detailed faces stay clean at a distance. Clients that lack a character's files show those players as the original player instead of failing to connect.
- A model can end with a fine-vertex block (tagged `QSFV`, written by `lib/mdl.mjs` and read by `Mod_LoadAliasFineVertexes`) that stores every vertex's exact position and normal in every frame. A standard MDL rounds positions to 256 steps per axis and normals to 162 directions. On a photo-textured head that made the face slide over the head and its lighting flicker as the idle animation nodded it. Other engines ignore the block.
- Character files are loose files under `characters/` in the game directory. They hold only original or freely licensed art and load with shareware or registered data.

## Rebuilding the characters

Nick and Chris share LibreQuake's BSD-licensed player body and its 143 animations. Each head and its status-bar faces come from that character's supplied photo. Full source photos are not committed; small derived head textures are in each character's `art/` directory.

1. Only when the photo changes: convert it to PNG, update the measurements in `nick/photo.json`, and run `node tools/characters/nick/from-photo.mjs path/to/nick.png`. This writes the small source images in `nick/art/`.
2. Run `npm run build:characters` to rebuild `web/dist/characters/`. The build is deterministic; `npm test` fails if the committed files are stale.
3. Review the model without the game: `node tools/characters/preview.mjs web/dist/characters/nick/player.mdl head.png head`.

For Chris, use `chris/photo.json` and `node tools/characters/chris/from-photo.mjs path/to/chris.png`, then run the same build command. Review with `node tools/characters/preview.mjs web/dist/characters/chris/player.mdl head.png head`. His face, ears and short curls are projected from the supplied photo; the unseen back uses samples of that photo's hair and neck. The lower neck blends with the chest during animation.

The common assembler, photo mesh, photo sampling and HUD variants live in `lib/`. Character modules supply their measurements, depth profiles and texture treatment.

Both heads use front, back and separate side atlas panels projected along head depth. Nick has an additional skin panel for his rounded neck. The sides use `art/profile.png`, generated with built-in imagegen from the character's existing photo reference; the exact prompts are in `nick/art/profile.prompt.txt` and `chris/art/profile.prompt.txt`. `profile.json` aligns each profile's crown, eye, mouth, chin and ear to the mesh. `lib/side-textures.mjs` blends the original front/back colors at the joins. Head depth is reduced to 78% while preserving the photo's width/height and central front UVs, so ears, cheeks and glasses arms no longer smear over the side. HUD source art is unchanged.

Chris's photographed head ends above the armor's collar. His mesh continues with a flared neck into the torso; the upper neck follows the head and its base follows the chest. The source texture extends the photo's existing neck colors, while the side profile supplies bare neck detail. This keeps the head attached through running, attacks and death animations.

Both heads are enlarged uniformly to 150% above the neck joint for a dramatic appearance. Below that joint their necks taper to the collar size, with the bases following the torso and overlapping the armor. Nick's lower hair follows that transition onto his shoulders; the former flat photo neck is replaced by a rounded neck with its own UVs and skin sampled from the photo. Detached gib heads use the same 150% enlargement.

Run `npm run test:characters` for two-browser model, character switching, corpse and HUD checks. Set `QUAKE_TEST_PUBLIC_URL` to use the same checks against the deployed game; its co-op room should be a fresh E1M1 with no other players.

The head is a lofted mesh whose width at each height comes from the photo's silhouette, with designed depth profiles and facial relief (`nick/head.mjs`). The front of the head is projected from the photo.

The back reuses the photo's own side hair (`nick/textures.mjs`): each row's band of hair beside the face is reflected inward, any skin or beard colour is swapped for that row's hair colour, and the result is blurred along the strands. Both sides of the seam sample just inside the photo's lighter edge, so the side of the head blends without a line. Everything outside the photo's silhouette is filled with hair too, so the distant mip levels used at grazing angles stay dark brown. Each frame, it follows the motion of the LibreQuake helmet it replaces; the lower hair blends toward the chest so it rests on the shoulders. For engines that read only the standard data, each head vertex keeps one light normal through an animation unless the head turns far enough to need another, so idle frames don't flicker. Head texels avoid the shirt and pants colour rows and the fullbright colours, so team colours recolour only the armour.

## Adding a character

Add a builder that returns the character's files, add an entry with its files to the manifest in `build.mjs`, and rebuild. The character needs `player.mdl` with the 143 player frames in id's order and `h_player.mdl`. The faces are optional. No engine rebuild is needed.
