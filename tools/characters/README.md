# Player characters

Players choose a character on the launch screen or with the toolbar's **Character** menu. The engine command is `character <name>`; `ranger` is the original player. The choice is sent when joining a server and whenever it changes, so other players see it straight away.

## How it works

- `web/dist/characters/manifest.json` lists the characters. The browser and every multiplayer room install each character's files into the engine as `characters/<name>/...` and write `characters/list.txt`.
- At each level start the server precaches `characters/<name>/player.mdl` and `h_player.mdl` for every listed character whose files exist.
- QuakeC still uses `progs/player.mdl`. When the server sends an entity whose model is the player or the gibbed head, and whose colormap belongs to a client with a character, it sends that character's model instead. That covers the live player, the corpse left after respawning, and the thrown head.
- The status bar uses `characters/<name>/face*.png` (96x96, drawn at the classic 24x24 size), falling back to `face*.lmp` and then to the original faces. The face follows the model the server actually shows for the player.
- Character skins are mipmapped, so detailed faces stay clean at a distance. Clients that lack a character's files show those players as the original player instead of failing to connect.
- Shareware data cannot load modified game files. The engine makes one exception, for files under `characters/`, which hold only original or freely licensed art.

## Rebuilding Nick

Nick's body and animation come from LibreQuake's BSD-licensed player model in `vendor/librequake/`. It has the same 143 animation frames as id's player. The head, its textures and the status-bar faces come from a photo of Nick, which is not committed.

1. Only when the photo changes: convert it to PNG, update the measurements in `nick/photo.json`, and run `node tools/characters/nick/from-photo.mjs path/to/nick.png`. This writes the small source images in `nick/art/`.
2. Run `npm run build:characters` to rebuild `web/dist/characters/`. The build is deterministic; `npm test` fails if the committed files are stale.
3. Review the model without the game: `node tools/characters/preview.mjs web/dist/characters/nick/player.mdl head.png head`.

The head is a lofted mesh whose width at each height comes from the photo's silhouette, with designed depth profiles and facial relief (`nick/head.mjs`). The front of the head is projected from the photo.

The back reuses the photo's own side hair (`nick/textures.mjs`): each row's band of hair beside the face is reflected inward, any skin or beard colour is swapped for that row's hair colour, and the result is blurred along the strands. Both sides of the seam sample just inside the photo's lighter edge, so the side of the head blends without a line. Everything outside the photo's silhouette is filled with hair too, so the distant mip levels used at grazing angles stay dark brown. Each frame, it follows the motion of the LibreQuake helmet it replaces; the lower hair blends toward the chest so it rests on the shoulders. Head texels avoid the shirt and pants colour rows and the fullbright colours, so team colours recolour only the armour.

## Adding a character

Add a builder that returns the character's files, add an entry with its files to the manifest in `build.mjs`, and rebuild. The character needs `player.mdl` with the 143 player frames in id's order and `h_player.mdl`. The faces are optional. No engine rebuild is needed.
