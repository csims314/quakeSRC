# QuakeSpasm in the browser

Double-click `launch-web.cmd` in the project root. It starts a server on `http://127.0.0.1:3000` and opens your default browser. Click **Launch Quake**, then **Click to play** to capture your mouse. The original Quake menus, console, gameplay, and data files run inside the engine.

## Controls and saves

- WASD: movement; mouse: look; left click: fire; Space: jump.
- Escape: release the browser's mouse capture and open the game menu. Click the game to capture again.
- Fullscreen: use the toolbar button. Escape can also exit browser fullscreen.
- Save and load through Quake's original Single Player menu or console commands such as `save slot1` / `load slot1`.
- Saves and configuration are stored in IndexedDB for this browser and origin. Browser storage can be cleared; use **Export saves** to keep a portable backup. **Import saves** accepts the exported JSON or an individual `.sav` file.

## Game data

The local server reads `runtime/id1/pak0.pak`, optional `pak1.pak`, and `runtime/quakespasm.pak`. The installed data is the shareware first episode. For the full original game, copy your purchased PAK files into `runtime/id1` or select both PAKs before launching. Selected files are read into browser memory, not uploaded.

Music is not bundled. Stock QuakeSpasm's shareware restrictions also apply in the browser.

## WebTransport multiplayer

Click **Launch Quake**, press **Esc** to release the mouse, then click **Join co-op**. The launcher starts an eight-player co-op server on `e1m1`, with the original monsters enabled at Normal difficulty. Players fight the same server-controlled enemies and share level progress and the monster kill count. Quake's original monster AI, attacks, damage, drops, and respawning players run in the authoritative engine. Open the same address in another tab or browser and join to play together. **Leave multiplayer** returns to the single-player start map. Use the original console for commands such as `name Ranger`, `say hello`, and `color 4 4`.

Set `QUAKE_MULTIPLAYER_SKILL` before starting the server to choose `0` (Easy), `1` (Normal, default), `2` (Hard), or `3` (Nightmare). The startup config explicitly sets `coop 1`, `deathmatch 0`, and `nomonsters 0` before loading the map. In a running server terminal, change difficulty and reload a level with `skill 2` followed by `changelevel e1m1`.

The server runs the same QuakeSpasm C engine under Node 20 or newer. Browser clients connect directly over HTTP/3 WebTransport: unreliable datagrams carry movement and world updates, and a reliable bidirectional stream carries sign-on and reliable game messages. There is no Quake UDP relay or legacy UDP driver in this WebAssembly build. Original protocol 666, QuakeC, physics, combat, and server simulation remain in the engine.

Default addresses are `http://127.0.0.1:3000` for the page and `https://127.0.0.1:4433/quake` for WebTransport. Both bind to loopback, so this setup hosts players on this computer. Internet/LAN hosting is not configured. The optional server field accepts another compatible WebTransport server with a trusted HTTPS certificate.

The launcher installs missing npm dependencies and checks the official native HTTP/3 prebuild. Local EC certificates are pinned by SHA-256, valid for twelve days, and renewed while the server runs. They are stored in ignored `web/.local/`. Browser certificate checks stay enabled; the launcher does not install a root CA or change browser security settings. Use a current browser with native WebTransport support; no WebSocket fallback is used.

For a deathmatch server, close the current project's server and run:

```powershell
$env:QUAKE_MULTIPLAYER_MODE = 'deathmatch'
$env:QUAKE_MULTIPLAYER_MAP = 'e1m1'
npm start
```

When `npm start` runs in a terminal, type server console commands such as `changelevel e1m2`. The game server uses the PAKs in `runtime/id1`; browser-selected files are local to that client. Keep server and client game data compatible. Server progress is held in memory during this session; multiplayer persistence is not provided.

Ports can be changed with `QUAKE_WEB_PORT` and `QUAKE_MULTIPLAYER_PORT`. When stopping a background server manually, use the PID in `web/server.pid` only after checking that its command line points to this project's `web/server.mjs`.

## Engine and build

This is the project's QuakeSpasm C engine compiled to WebAssembly, using GL4ES to translate its OpenGL renderer to WebGL. It is not a JavaScript recreation. Rendering, audio scheduling, browser pointer lock, storage, and network capabilities differ from native applications; absolute pixel/timing parity is not guaranteed. The native prebuilt runtime is 0.96.3 and the installed development sources identify as 0.97.0.

The launcher uses QuakeSpasm's `-nopackedpixels` option because GL4ES does not accept the packed desktop OpenGL lightmap upload format. Standard byte lightmaps preserve level lighting through WebGL.

The build adds `web/engine/browser_bridge.c`: a command queue, configuration-write command, and read-only game and world state snapshots. Browser-only changes in `main_sdl.c` and `gl_vidsdl.c` schedule frames through Emscripten's animation loop, initialize GL4ES after WebGL context creation, and resolve desktop GL extensions through the translation layer. Engine simulation, physics, QuakeC execution, level loading, and sound mixing remain in QuakeSpasm.

Browser video mode changes retain GL objects, as SDL2 preserves the context. The browser-only configuration command is registered alongside the engine's other console commands in `host_cmd.c`.

Run `build-web.cmd` to rebuild after editing `source/Quake/`. It uses the existing `ModelGenTrellis` WSL distribution and the locally installed Emscripten 4.0.23 SDK. Compilation and the Emscripten cache live under that distribution's `~/.cache/quakesrc-web`; generated browser files are copied into `web/dist/engine`.

Dependencies are in `tools/emsdk` and `tools/gl4es`. This checkout uses:

- QuakeSpasm: `c9c8ee9895961669c4674e8f8ca8c64cc43e38b5`
- Emscripten SDK checkout: `96c657fc60920d2a6a82318aa50e0abf82749604`, SDK version `4.0.23`
- GL4ES: `ec16bedd8819c475326f4f1a3063772c6d986e06`
- WebTransport server and native QUIC transport: `@fails-components/webtransport` and `@fails-components/webtransport-transport-http3-quiche`, both `1.6.8`, pinned in `package-lock.json`.

For manual dependency setup, run `npm ci --ignore-scripts`, then `node tools/setup-network.mjs`. Run `npm test` for protocol checks and `npm run test:multiplayer` for the two-browser integration test. The latter requires agent-browser and its Chromium browser. See [VERIFICATION.md](VERIFICATION.md) for the checked flows and their limits.

QuakeSpasm is GPL-licensed and GL4ES is MIT-licensed. License copies accompany the generated engine. Quake game assets retain their separate original license.

For manual server operation, run `npm start`. Change the loopback port with the `QUAKE_WEB_PORT` environment variable. Keep the same hostname and port to retain access to browser saves. The server exposes only the web files and the named local PAK assets; it does not bind to the LAN.
