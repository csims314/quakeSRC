# Quake Workshop level editor

Double-click `launch-editor.cmd`, or run `npm run start:editor`. The launcher installs the pinned native map tools, builds the editor frontend, and opens `/editor/`. The command-line script keeps its server in the terminal; the Windows launcher starts a hidden server with logs in `web/editor.stderr.log` and `web/editor.stdout.log`.

The Windows launcher reuses a compatible editor-enabled server. If an older game server occupies the default port, it chooses a free local editor port starting at 3001 and a separate multiplayer port, keeping your game session running. Explicitly configured ports and LAN mode instead report a conflict; choose another `QUAKE_WEB_PORT` and `QUAKE_MULTIPLAYER_PORT` or restart that server. The WebAssembly engine must already include the editor bridge; rebuild it with `build-web.cmd` after changing C engine code. JavaScript, HTML and CSS changes only need `npm run build:editor`.

The editor, compiler, and custom-map playtests work with the installed shareware `runtime/id1/pak0.pak`. **Registration checks are currently removed from this development tree for testing**, including loose-file and mod-directory restrictions. No additional flag or full-game `pak1.pak` is needed for solo or co-op playtests. The engine must be rebuilt after this source change; restart any running editor server and reload the browser. Game data and downloaded tools are excluded from Git.

The installed data includes the start map, all eight Episode 1 levels, and the monsters/weapons offered by the editor. It does not include Episodes 2–4 or assets for later enemies such as Enforcers, Death Knights, Vores, Rotfish, Spawns, and the final boss. Removing checks does not supply those files or change the original asset licenses. The example level uses available assets.

## Building a level

- The dark workspace follows Unity's main arrangement: **Hierarchy** on the left, **Scene / Game** in the center, **Inspector** on the right, and **Project / Console** below. Resize panel edges, drag Project/Console tabs to the left/right/bottom, or use the dock selector. **Reset layout** restores defaults. Layout preferences are separate from level data.
- **Scene** uses the same QuakeSpasm renderer and QuakeC spawn code as gameplay. Monsters, weapons and pickups use actual installed MDL/BSP models, skins and frames. Textures, baked lighting, animated surfaces, particles and rendering effects run through the game engine. Lights, starts and invisible trigger volumes have editor gizmos.
- The initial room is sealed and contains a player start, seven co-op starts, and a light. **Example level** adds a ramp, custom checker texture, soldier, pickups, button-operated door and exit.
- Add rooms, blocks and ramps with the left toolbar. Place gameplay objects from the toolbar or drag them from **Project → Game objects**. Click actual models or Hierarchy entries; edit coordinates in the Inspector or use Move/Rotate/Resize handles. Position and resize operations snap to the selected grid; rotation snaps to 15 degrees. Global/Local and Center/Active pivot selectors control transforms. Resize changes brush geometry; Quake's game models retain their native size, and point objects rotate around Z.
- Shift/Ctrl-click adds to the selection; Shift-drag draws a selection rectangle. Transform, duplicate and delete whole selections. Duplicated door/button assemblies retain their links with fresh IDs. Search, rename, group and drag objects between Hierarchy groups. **Lock** prevents Scene picking/transforms; select a locked object in the Hierarchy to unlock it.
- **Gizmos** toggles editor overlays. **Hide gizmos** hides selected editor markers and native entity models; compiled structural walls remain visible. **Four views** adds top/front/side wire views. **Wire cutaway** removes ceiling/exterior-wall outlines in those views. The main Scene remains the actual game render.
- Alt-click cycles overlapping objects. Wire views prioritize point objects, and the Hierarchy selects walls and ceilings that are hard to reach in the Scene.
- **Wall opening** splits an unrotated wall into two jambs and a lintel, with a 128-unit-wide and 128-unit-high opening. Join it to another sealed room or corridor to avoid a leak.
- Choose an installed texture to paint an entire selected brush. Turn on **Face select**, pick a face, and paint that face instead. Adjust offsets, scale and rotation in the inspector.
- Import PNG/JPEG images up to 8 MiB / 8192 pixels per dimension. Images are reduced to at most 512 pixels, padded to a multiple of 16, made opaque, and converted to the installed Quake palette without reserved glow colors. Confirm the converted preview before use. The project retains original image bytes and converted texture pixels.
- Doors, buttons and triggers own their brush volumes. Select a button or activation trigger and use **Activate** to choose a target. Door `angle` determines its movement direction (`-1` up, `-2` down); `speed`, `wait`, and `lip` use Quake's standard meanings. A button with positive **Shoot health** must be shot. Exits select an installed destination map.
- **Project** holds textures, placeable game objects, reusable templates, saved projects and the latest build. Save selected objects as a template; import/export templates with their custom textures. Included templates cover rooms, corridors and door/button assemblies. **Preview game asset** in the Inspector captures an image through the game renderer and adds it to the matching asset tile.
- **Build level** runs qbsp, fast vis, and light. **Auto refresh** compiles after edits settle, preserving the free camera and selection. Point-object transforms preview immediately; brush changes first show wire outlines and require recompilation for new surfaces, collision and baked lighting. The revision indicator shows pending changes. Compiler errors open **Console**; filter its messages and use **Frame leak** to locate a leak path. Keep the player starts inside the sealed space.
- **Preview effects** runs the Scene's actual game simulation. **Pause / Resume** freezes or advances it. The Inspector's **Activate in preview** calls a door/button/trigger's QuakeC activation function. **Stop / Reset** reloads the compiled scene. Preview state never enters the saved document; stop preview before editing.
- **Play solo** opens a fresh game instance in the **Game** tab. Click **Launch playtest**, then **Click to play** to enable audio/mouse input. Esc releases the mouse. Scene/Game switching preserves the running playtest; **Return to editor** ends it.
- The difficulty selector applies to Scene spawns, solo play and newly hosted co-op sessions.

| Control | Action |
| --- | --- |
| Drag / scroll in Scene | Orbit / zoom |
| Right-drag + WASD, Q/E | Look and fly; Shift moves faster |
| F / F2 | Frame selection / rename |
| Q, W, E, R | Select tool, Move, Rotate, Resize |
| Delete / Ctrl+D | Delete / duplicate selection |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+S | Export project backup |

Selection and camera movement are not recorded in undo history. X/Y/Z orientation buttons align the perspective Scene; Four views provides orthographic wire editing.

Projects autosave to this browser/origin in IndexedDB. **Export project** writes a versioned `.qlevel.json` with custom images. **Open project** validates it before replacing the document. Back up before clearing browser storage or changing host/port. History retains 64 edits and is not persisted.

**Export map + WAD** downloads the editable Valve 220 source and used textures. **Export compiled** downloads `maps/<build-name>.bsp` and an optional `.lit` file. Install them in a compatible Quake game directory and run `map <build-name>`. Exported stock textures retain their original licenses; these exports contain no original PAK files.

## Co-op and LAN setup

**Host co-op** starts a separate eight-player test server on UDP 4434 by default. `QUAKE_EDITOR_MULTIPLAYER_PORT` changes it. Restarting explicitly disconnects existing test players. Editing never alters the running build; start a new test to use new changes. **Stop co-op** terminates the test process. Your regular co-op/deathmatch server and single-player saves stay separate.

Loopback co-op works through the displayed join link in other browsers on the same computer. For other computers, enable LAN mode with a trusted HTTPS certificate. HTTP on a LAN address does not provide the secure browser context WebTransport requires.

1. Obtain [mkcert](https://github.com/FiloSottile/mkcert). On the host, manually run `mkcert -install` to trust its local development CA.
2. Identify the host's LAN IPv4 address (the example below uses `192.168.1.50`). Create a certificate:

   ```powershell
   New-Item -ItemType Directory -Force web/.local/editor/tls
   mkcert -ecdsa -cert-file web/.local/editor/tls/cert.pem -key-file web/.local/editor/tls/key.pem localhost 127.0.0.1 192.168.1.50
   ```

3. Each joining computer must manually trust the host CA's **public** `rootCA.pem` certificate in its browser/system trust store. Find it with `mkcert -CAROOT`. Only share the public certificate; keep `rootCA-key.pem` and server private keys on the host.
4. Configure and launch from PowerShell, replacing the address with your host's address:

   ```powershell
   $env:QUAKE_EDITOR_LAN = '1'
   $env:QUAKE_PUBLIC_ORIGIN = 'https://192.168.1.50:3000'
   $env:QUAKE_TLS_CERT = (Resolve-Path web/.local/editor/tls/cert.pem).Path
   $env:QUAKE_TLS_KEY = (Resolve-Path web/.local/editor/tls/key.pem).Path
   .\launch-editor.cmd
   ```

5. Allow inbound TCP 3000 and UDP 4434 on the host's private-network firewall. Keep this setup on the LAN. The host authors at `https://localhost:3000/editor/`; guests open the join link shown after **Host co-op**.
6. Guests select their own matching Quake PAKs: shareware `pak0.pak` if the host uses shareware, or both purchased PAKs if the host uses full-game data. Files stay in their browser. Exact game-data fingerprints and build hashes are checked before sign-on. Guest requests cannot compile, manage sessions, read the stock texture catalogue, or download the host's PAKs.

Certificate setup and trust installation are manual. The launcher never disables certificate verification or installs a CA automatically. If the LAN address changes, issue a new leaf certificate and update `QUAKE_PUBLIC_ORIGIN`. Use a browser with native WebTransport support.

Editor APIs are disabled when `NODE_ENV=production`; this is a local authoring tool, not a public editing service.

## Development and verification

`scene.mjs` owns an isolated engine instance without persistent saves or multiplayer connections. `engine-scene.mjs` synchronizes the camera, picking bounds and transforms. `web/engine/editor_bridge.c` freezes the server, sets the renderer camera, exposes actual spawned assets and invokes game activation functions. Stable `_editor_id` keys map authored entities to runtime entities. Three.js supplies invisible picking geometry, orthographic wires and transform overlays; it does not draw game materials or replacement models. Gameplay uses the existing `play.mjs` path and the same engine factory. PAK fingerprints recreate the Scene when installed data changes, and old compiled map files/buffers are released after refresh.

`npm run build:editor` builds the browser files into ignored `web/dist/editor`. `npm run setup:editor` installs ericw-tools 0.18.1 into ignored `tools/ericw-tools` and records the archive URL/hash. Set `QUAKE_EDITOR_COMPILER_DIR` to use an existing tool directory. Build jobs allow at most 16 MiB, 2048 brushes, 512 entities, 128 brush entities and 128 imported textures, run one at a time, and expire after five minutes. Twelve recent builds are retained per server run.

Run `npm test`, `npm run test:editor`, `npm run test:editor:browser`, and `npm run test:multiplayer`. Editor unit/integration fixtures use synthetic assets; native compile tests need `setup:editor`. Browser checks use agent-browser/Chromium and exercise custom-map solo and two-client co-op with the installed shareware data. Verify the join flow on two physical LAN computers before treating LAN support as verified.

Editor source follows this repository's GPL license. Three.js and fflate are MIT; esbuild is MIT tooling. Browser bundles include dependency license notices. ericw-tools retains its GPL notices in the downloaded tools directory. Quake game content has its separate license.
