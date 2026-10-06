# QuakeSpasm in the browser

Double-click `launch-web.cmd` in the project root. It starts a server on `http://127.0.0.1:3000` and opens your default browser. Click **Launch Quake**, then **Click to play** to capture your mouse. The original Quake menus, console, gameplay, and data files run inside the engine.

## Controls and saves

- WASD: movement; mouse: look; left click: fire; Space: jump.
- Escape: release the browser's mouse capture and open the game menu. Click the game to capture again.
- Fullscreen: use the toolbar button. Escape can also exit browser fullscreen.
- Phones and tablets: **Touch controls** turn on by themselves on touch-only devices, or when a finger touches the game; the toolbar button switches them on or off. Drag on the left half to move (push further to run), drag on the right half or on **Fire** to look, and use **Fire**, **Jump**, **Weapon** and **Scores**. **Menu** opens the game menus, which then show arrow, **OK** and **Back** buttons. Options → Mouse Speed also sets how fast touch turns the view. Turn the device sideways for the most room.
- Save and load through Quake's original Single Player menu or console commands such as `save slot1` / `load slot1`.
- Saves and configuration are stored in IndexedDB for this browser and origin. Browser storage can be cleared; use **Export saves** to keep a portable backup. **Import saves** accepts the exported JSON or an individual `.sav` file.

## Game data

The local server reads `runtime/id1/pak0.pak`, optional `pak1.pak`, and `runtime/quakespasm.pak`. The installed data is the shareware first episode. For the full original game, copy your purchased PAK files into `runtime/id1` or select both PAKs before launching. Selected files are read into browser memory, not uploaded.

Stock QuakeSpasm's shareware restrictions also apply in the browser.

## Music

Music is not bundled; the shareware data has none. Name tracks after the original CD tracks, `track02` through `track11`, in any format the browser plays: OGG, Opus, MP3, FLAC, WAV or M4A. Files named like `02 - Title.mp3` are also matched to their track number.

- **Your own files:** choose them under **Add your soundtrack** before launching, or **Controls & details → Add music** at any time. They are kept in this browser's IndexedDB, never uploaded, and used before any music on the server. **Remove your music** deletes them.
- **Server music:** files in `runtime/id1/music/` (the folder the native game uses) are offered to every player through `/api/music` and streamed from `/assets/music/`. Only put music there that you may share with your players.

The engine still picks each level's track, pauses it with the game, and applies Options → Music Volume (`bgmvolume`), `bgm_extmusic` and the `music`, `music_stop`, `music_pause`, `music_resume` and `music_loop` commands. The browser streams the file with its own audio player instead of decoding it in WebAssembly memory. A track the browser cannot offer falls back to the engine's own OGG and WAV decoders when the file is inside the game's filesystem.

## Who's playing

`/status` shows each multiplayer room's map, settings and players: name, frags, ping and time online. It refreshes every five seconds and is linked from the game page. Its data comes from `/api/status`, which stays available in production and contains no addresses, positions or diagnostics.

## WebTransport multiplayer

Click **Launch Quake**, press **Esc** to release the mouse, then click **Join co-op**. The launcher starts an eight-player co-op server on `e1m1`, with the original monsters enabled at Normal difficulty. Players fight the same server-controlled enemies and share level progress and the monster kill count. Quake's original monster AI, attacks, damage, drops, and respawning players run in the authoritative engine. Open the same address in another tab or browser and join to play together. **Leave multiplayer** returns to the single-player start map. Use the original console for commands such as `name Ranger`, `say hello`, and `color 4 4`.

Choose **Deathmatch** in the toolbar and click **Join deathmatch** for original free-for-all PvP. Its separate eight-player room starts on `e1m1` with no monsters, a 20-frag limit, and a 10-minute time limit. Original weapon and item respawns, damage, death, scoring and player respawns run in the authoritative engine. Hold **Tab** for the scoreboard. Press fire after dying to respawn, and after the intermission to start the next round. Scores reset and the same arena reloads while players keep their connections. Deathmatch cannot be paused. Changing the selector and joining moves only you; the other room keeps running.

Set `QUAKE_MULTIPLAYER_SKILL` before starting the server to choose `0` (Easy), `1` (Normal, default), `2` (Hard), or `3` (Nightmare). Co-op explicitly sets `coop 1`, `deathmatch 0`, and `nomonsters 0` before loading its map. In a running server terminal, change difficulty and reload a level with `coop: skill 2` followed by `coop: changelevel e1m1`.

The server runs the same QuakeSpasm C engine under Node 20 or newer. Browser clients connect directly over HTTP/3 WebTransport: unreliable datagrams carry movement and world updates, and a reliable bidirectional stream carries sign-on and reliable game messages. There is no Quake UDP relay or legacy UDP driver in this WebAssembly build. Original protocol 666, QuakeC, physics, combat, and server simulation remain in the engine.

Default local addresses are `http://127.0.0.1:3000` for the page and `https://127.0.0.1:4433/quake` for WebTransport. Both bind to loopback, so the local launcher hosts players on this computer. Public co-op is hosted at [quake.34.10.23.32.sslip.io](https://quake.34.10.23.32.sslip.io) with WebTransport on UDP 4433; see [the deployment instructions](../deploy/README.md). The optional server field accepts another compatible WebTransport server with a trusted HTTPS certificate.

The launcher installs missing npm dependencies and checks the official native HTTP/3 prebuild. Local EC certificates are pinned by SHA-256, valid for twelve days, and renewed while the server runs. They are stored in ignored `web/.local/`. Browser certificate checks stay enabled; the launcher does not install a root CA or change browser security settings. Use a current browser with native WebTransport support; no WebSocket fallback is used.

Both rooms run automatically. To change deathmatch's arena and limits before starting:

```powershell
$env:QUAKE_DEATHMATCH_MAP = 'e1m1'
$env:QUAKE_DEATHMATCH_FRAGLIMIT = '20'
$env:QUAKE_DEATHMATCH_TIMELIMIT = '10'
npm start
```

Limits of `0` are unlimited; the time limit is in whole minutes. `QUAKE_MULTIPLAYER_MODE` chooses the default selection, and `QUAKE_COOP_MAP` (or the legacy `QUAKE_MULTIPLAYER_MAP`) chooses co-op's initial map. The public launcher accepts `?mode=deathmatch` to preselect deathmatch. `/api/multiplayer?mode=deathmatch` returns its connection details and actual rules; the `rooms` array lists both independent rooms. They share UDP 4433 at `/quake` and `/deathmatch`.

When `npm start` runs in a terminal, use room prefixes for console commands, such as `deathmatch: changelevel e1m2` or `coop: changelevel e1m2`. Commands without a prefix target the configured default mode. The game servers use the PAKs in `runtime/id1`; browser-selected files are local to that client. Keep server and client game data compatible. Server progress is held in memory during this session; multiplayer persistence is not provided.

Ports can be changed with `QUAKE_WEB_PORT` and `QUAKE_MULTIPLAYER_PORT`. When stopping a background server manually, use the PID in `web/server.pid` only after checking that its command line points to this project's `web/server.mjs`.

## Engine and build

The browser renderer includes a live planar mirror directly behind the stock
`start` spawn: turn around to see Ranger from head to feet. Depth-aware volumetric
fog with BSP-shadowed static lighting is available but disabled for now. See
[RENDERING.md](RENDERING.md) for the plans,
quality controls, map authoring keys and current lighting limits. Verify them
with `npm run test:render:math` and `npm run test:render`.

This is the project's QuakeSpasm C engine compiled to WebAssembly, using GL4ES to translate its OpenGL renderer to WebGL. It is not a JavaScript recreation. Rendering, audio scheduling, browser pointer lock, storage, and network capabilities differ from native applications; absolute pixel/timing parity is not guaranteed. The native prebuilt runtime is 0.96.3 and the installed development sources identify as 0.97.0.

The launcher uses QuakeSpasm's `-nopackedpixels` option because GL4ES does not accept the packed desktop OpenGL lightmap upload format. Standard byte lightmaps preserve level lighting through WebGL.

The build adds `web/engine/browser_bridge.c`: a command queue, configuration-write command, read-only game and world state snapshots, and touch input (an analog stick and view turns applied in `IN_Move`, plus menu keys delivered during the engine's input pass in `in_sdl.c`). Browser-only changes in `bgmusic.c` hand music requests, pause, volume and loop changes to the page's audio player (`web/dist/music.js`). Browser-only changes in `main_sdl.c` and `gl_vidsdl.c` schedule frames through Emscripten's animation loop, initialize GL4ES after WebGL context creation, and resolve desktop GL extensions through the translation layer. Engine simulation, physics, QuakeC execution, level loading, and sound mixing remain in QuakeSpasm.

Browser video mode changes retain GL objects, as SDL2 preserves the context. The browser-only configuration command is registered alongside the engine's other console commands in `host_cmd.c`.

The local [level editor](editor/README.md) has an engine-rendered Scene and a separate Game playtest tab. Its `editor_bridge.c` adds a free renderer camera, frozen server state, stable authored entity IDs, actual asset/bounds snapshots and QuakeC activation preview. These hooks are inactive in ordinary gameplay. The editor uses Three.js for picking and editing overlays; world surfaces, models, lighting and effects use the same Quake renderer as gameplay.

Run `build-web.cmd` to rebuild after editing `source/Quake/`. It uses the existing `ModelGenTrellis` WSL distribution and the locally installed Emscripten 4.0.23 SDK. Compilation and the Emscripten cache live under that distribution's `~/.cache/quakesrc-web`; generated browser files are copied into `web/dist/engine`.

Dependencies are in `tools/emsdk` and `tools/gl4es`. This checkout uses:

- QuakeSpasm: `c9c8ee9895961669c4674e8f8ca8c64cc43e38b5`
- Emscripten SDK checkout: `96c657fc60920d2a6a82318aa50e0abf82749604`, SDK version `4.0.23`
- GL4ES: `ec16bedd8819c475326f4f1a3063772c6d986e06`
- WebTransport server and native QUIC transport: `@fails-components/webtransport` and `@fails-components/webtransport-transport-http3-quiche`, both `1.6.8`, pinned in `package-lock.json`.

For manual dependency setup, run `npm ci --ignore-scripts`, then `node tools/setup-network.mjs`. Run `npm test` for protocol, room configuration, music and status checks, `npm run test:multiplayer` for the co-op regression, `npm run test:deathmatch` for the three-browser PvP and room-isolation integration test, and `npm run test:touch` for phone-style touch input, player music files and the status page. Browser tests require agent-browser and its Chromium browser. See [VERIFICATION.md](VERIFICATION.md) for the checked flows and their limits.

QuakeSpasm is GPL-licensed and GL4ES is MIT-licensed. License copies accompany the generated engine. Quake game assets retain their separate original license.

For manual server operation, run `npm start`. Change the loopback port with the `QUAKE_WEB_PORT` environment variable. Keep the same hostname and port to retain access to browser saves. The server exposes only the web files and the named local PAK assets; it does not bind to the LAN.
