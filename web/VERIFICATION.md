# Browser verification

Verified locally on October 5, 2026 with agent-browser's Chromium 152 browser.

| Flow | Evidence |
|---|---|
| Engine build | Emscripten 4.0.23 compiled the project's C source and GL4ES; build exited 0. |
| Original data | Loaded the installed, checksum-verified Quake 1.06 shareware PAK. |
| Rendering | WebGL renderer initialized with multitexturing, GLSL gamma, GLSL models, and normal level lighting. Inspected screenshots. |
| Shareware levels | Loaded `start` and `e1m1` through `e1m8`, each with a connected player and no reported engine or JavaScript errors. These are loading checks, not complete playthroughs. |
| Movement and mouse | Real W-key input changed player position; real mouse input changed view angles with pointer lock active. A sustained movement command also moved the player through the original collision simulation. |
| Audio | SDL initialized stereo audio at 44100 Hz. Observed 982 real audio callbacks and a nonzero output RMS of approximately 0.059. |
| Fullscreen | Toolbar entered fullscreen and captured the mouse. |
| Saving | Saved an original-format `.sav` file and wrote the engine configuration. |
| Persistence | Refreshed the page, recovered the files from IndexedDB, and loaded the saved game back into `e1m1`. |
| Backup content and import | Exporter generated a 115531-byte JSON payload containing configuration and the 83608-byte save. Imported that real payload through the file input; UI reported `IMPORTED 2 FILE(S)`. |

The automation browser canceled downloads, including an independent tiny data-URL test. Export payload generation and reimport were verified; writing a downloaded backup to disk was not verified through that browser automation environment.

## WebTransport verification

`npm test` passes twelve tests: six protocol tests covering arbitrary reliable-stream chunk boundaries, invalid and truncated frames, datagram sequencing with wraparound, stream backpressure, bounded datagram writes, and isolated socket cleanup; three configuration tests cover local defaults, public production addresses, disabled production diagnostics, and rejection of insecure or ambiguous endpoints; three room tests cover independent co-op/deathmatch rules, configurable limits and maps, and invalid settings.

`npm run test:multiplayer` passed with two independent Chromium 152 browser sessions and the actual compiled engine on both clients and server:

| Flow | Result |
|---|---|
| Server startup | Original C engine started an eight-player co-op server on `e1m1`, with `coop=1`, `deathmatch=0`, `nomonsters=0`, and Normal difficulty. The level contained 23 live original monsters. |
| Browser join | Both clients used the real **Join co-op** button, completed sign-on stage 4, and received live game data. The launcher displayed original monsters and Normal difficulty. Local certificate fingerprints were verified with normal browser security enabled. |
| Reliable traffic | Name and chat changes reached the second player. |
| Unreliable traffic | Movement reached the server and second player; firing consumed ammunition through the original server simulation. |
| Monster AI and attacks | An original `monster_army` acquired player two, moved and animated, and fired at that player, reducing health from 100 to 84. |
| Monster combat and replication | Player one fired the original weapon, reducing the soldier's health from 30 to 6, then to -18. Both browsers received its matching corpse model, animation frame, position, and shared kill count of 1. |
| Level changes | Both connections survived `changelevel e1m2`, received the next level's monsters, and returned to `e1m1`. |
| Deathmatch | Both players switched through the mode selector into the independent deathmatch engine while co-op retained its own rules. |
| Disconnect/reconnect | Three cycles freed and reused player slots while the second player remained connected. |
| Server loss | Both clients detected shutdown, then rejoined after a server restart. |
| Browser errors | Neither final client reported JavaScript errors. |

The test saves screenshots, server logs, and a JSON evidence report under ignored `web/test-artifacts/`. It uses reserved test ports 3102/4445 and closes its own browsers and server afterward. `AGENT_BROWSER_BIN` can specify the automation CLI location. The server and client artifacts were rebuilt with Emscripten 4.0.23; the browser build links loopback and WebTransport drivers only.

## Deathmatch verification

On October 6, 2026, `npm run test:deathmatch` passed with three isolated Chromium sessions: two deathmatch players and one co-op player. They used the actual native engine compiled to WebAssembly and the UI mode selector. The local test uses ports 3104/4446 and closes its own server and browsers afterward.

| Flow | Result |
|---|---|
| Independent rooms | Two live engines shared one WebTransport port at `/quake` and `/deathmatch`; deathmatch had zero monsters while co-op retained its original enemies. Chat stayed in its own room. |
| Empty room | After seven seconds of idle server time, the first player started a fresh native deathmatch round with its clock reset. |
| Combat | Players reached an unobstructed firing position using ordinary movement, jumping and aiming on E1M1. The server rejected god, give-health and teleport cheats. Original weapon fire reduced the victim's health, killed them and spent ammunition. |
| Scoring and respawn | Both clients received the killer's frag increment. The original scoreboard was captured, and fire respawned the victim with 100 health. |
| Round limits | The configured defaults were 20 frags and 10 minutes. Private server commands lowered the thresholds to one frag and 0.001 minutes to exercise both native intermission paths. After five seconds, fire started a fresh round, reset scores and preserved both connections. |
| Room switching | Switching one player between co-op and deathmatch preserved the other players, rules and monsters in both rooms. |
| Mouse and errors | Toolbar transitions completed without automatic mouse recapture; all three clients finished without JavaScript errors. |

Evidence, server logs and scoreboard screenshots are written to ignored `web/test-artifacts/deathmatch-local.json` and related files. Set `QUAKE_TEST_PUBLIC_URL` to run the same PvP and room-isolation flow against the public server. Public tests do not send administrative commands or shorten round limits.

The same public flow passed on October 6, 2026 against the GCE production image `quake-web:7e5e985a73257f5c77684633bc4be9ec2c6ec055`. Two deathmatch browsers joined while a third played co-op. Real weapon fire reduced the victim's health from 100 to 72, then killed them; both clients received the frag, and the victim respawned with 100 health. Explicit mouse capture, the scoreboard, room switching and clean disconnects passed without JavaScript errors. The separate public co-op test also passed chat, movement, a real monster attack and a shared monster kill on this image.

GitHub Actions passed all twelve unit/configuration tests and startup checks for both production rooms. The GCE game container used approximately 134 MiB with 312 MiB available on the VM during the check, and the pre-existing WebTransportArena process remained running. The public tests use independent browser sessions on one computer; they do not establish eight-player load capacity or verify multiple client devices. Default 20-frag/10-minute rules were read back from the production engine; shortened round limits and restart behavior were exercised locally.

## Player character verification

On October 6, 2026, `npm run test:characters` passed with two isolated Chromium sessions against the rebuilt engine on local ports 3108/4452. One player chose Nick on the launch screen; the other stayed the Ranger.

| Flow | Result |
|---|---|
| Launch screen | Both character cards appeared; choosing Nick survived a page reload. |
| Sign-on | The co-op server recorded slot 1 as `nick` and slot 2 as `ranger`. |
| Other players' view | The Ranger's client rendered slot 1 with `characters/nick/player.mdl`; Nick's client rendered the Ranger with `progs/player.mdl`. Screenshots show Nick's face, glasses, beard and hair in E1M1 lighting. |
| Live switching | Switching to the Ranger and back from the toolbar menu reached the other client both times. |
| Corpse | After a suicide and immediate co-op respawn, the corpse replicated to the other client with Nick's model. |
| Errors | Neither client reported JavaScript errors, missing character files or PNG decoding errors. |

Nick's idle animation was checked separately: a second player zoomed in (`fov 30`) on Nick standing still and took 24 screenshots, and six patches inside the face were tracked from shot to shot. With standard 8-bit vertices the patches disagreed by 2.4 px on average and up to 4.5 px, because the glasses, nose and mouth slid over the head while the forehead and chin stayed put. With the fine-vertex block they move as one (0.3 px average, 0.6 px at most), and the forehead no longer flickers between lit and unlit or shows a line where the light falls off.

`npm test` adds seven character checks. They cover manifest validation and the engine's model limits (143 frames, vertex, triangle and skin bounds). They check that idle frames keep the face rigid with unchanged light normals and that the fine-vertex normals are unit length. They also check that the head avoids recoloured and fullbright palette entries and that the 28 status-bar faces are complete. Installation and the committed assets matching a fresh, deterministic build are covered too. With the character engine build, `npm run test:multiplayer` passed all ten existing checks. The gibbed-head substitution is covered by code review, not by an automated gib.

`npm run test:deathmatch` is timing-sensitive at the E1M1 courtyard stairs. Its scripted walk can stall on a stair lip at y=2384, and it gets 12 timed attempts to jump past. It passed with the character engine in a traced run. In a traced run with the previous engine, the walker stalled at the same lip for two attempts before a later jump got through. Across all runs, the previous engine passed 4 of 4 and the character engine 1 of 4, so a failure at that step means the walk needs another attempt, not a broken engine. Client frame rate was identical with both engines (240 fps, worst frame 4-5 ms).

## Touch, music and status verification

On October 6, 2026, `npm run test:touch` passed in agent-browser's Chromium, emulating a touch-only landscape phone (915×412, no mouse) through the DevTools protocol. Touches were real browser touch events, not script-created pointer events. The test uses ports 3106/4448 and closes its own server and browser afterward.

| Flow | Result |
|---|---|
| Touch detection | A touch-only device turned touch controls on. Launch Quake was tapped, and the Click to play mouse-capture prompt never appeared. The start screen fits a 412-pixel-high landscape screen. |
| Movement and look | The left stick moved the player about 330 units through the engine's normal movement path. A right-side drag turned the view 45° and pitched it down. Stick and look held by two fingers at once moved and turned together. |
| Buttons and menus | Fire spent ammunition. Menu opened the original main menu, the controls switched to the arrow pad, and Back closed it. |
| Player music | Ten generated WAV tracks were added through the soundtrack picker; a misnamed file was skipped with a message. The engine's start-map request (track04) streamed from the player's file, paused and resumed with the game, and followed `bgmvolume`. |
| Server music | With generated OGG tracks in `runtime/id1/music`, `/api/music` listed them, `/assets/music/` answered byte ranges with 206 and impossible ranges with 416, and a path-traversal name returned 404. A separate desktop Chromium session streamed the start map's `track04.ogg` from the server, downloading only that track, while touch controls stayed off and Click to play remained. |
| Status | After joining co-op by touch, `/api/status` listed the player by name with ping and time online, and only those fields. The `/status` page showed the player row. No browser errors. |

On the public server (image `63dc829`), with ten CC0 placeholder MP3 tracks in `deploy/game-data/music`, a desktop Chromium session heard the original game's track for every part of the shareware episode, each starting by itself and streaming from the server: the start map (track 4), E1M1–E1M8 (6, 8, 9, 5, 11, 4, 7, 10), the end-of-level statistics (3), the Episode 1 ending text (2), the co-op and deathmatch rooms (6) and the return to single player (4). The statistics and ending screens were reached by moving the player onto each level's exit with `setpos`. This check found that E1M7's exit froze the browser game: a particle burst exceeded the 2 MB limit of the GL emulation's temporary buffers. After drawing particles in 2048-particle batches, the largest such draw was 0.6 MB and the ending ran without errors.

Not verified: a physical phone or tablet, iOS Safari (including its Ogg support and lack of element fullscreen), or Android orientation lock. `npm run test:multiplayer` and `npm run test:deathmatch` passed again with the rebuilt engine.

## Public Google Compute Engine verification

Verified on October 6, 2026 at [quake.34.10.23.32.sslip.io](https://quake.34.10.23.32.sslip.io), using two isolated Chromium browser sessions on the development computer across the public Internet to the GCE VM. This is a public connection test, not a test of two separate client computers or eight simultaneous players.

| Flow | Evidence |
|---|---|
| Production build | GitHub Actions compiled the original engine, passed all nine tests, and started the production container with the checksum-verified shareware PAK mounted read-only. |
| Public HTTPS | Caddy obtained a trusted Let's Encrypt certificate. The browser loaded normally with certificate verification enabled. `/healthz` returned 200 and the configuration advertised the public WebTransport endpoint, co-op, Normal difficulty, monsters, and eight-player capacity. |
| Production diagnostics | `/api/multiplayer/world` returned 404 to public clients. |
| Public multiplayer | Both clients launched through the page and joined through **Join co-op**. Reliable chat crossed the public WebTransport connection, and movement replicated to the other player. |
| Monster combat | The original soldier, entity 95, attacked player two, reducing health from 100 to 84. Player one fired and killed it; both clients showed a shared kill count of 1 and the same corpse frame 21 at `[63.25, 607.75, 24]`. |
| Errors and rendering | Both clients reported no JavaScript errors; gameplay screenshots were inspected. Both disconnected cleanly. |
| Existing host service | The original WebTransportArena process remained running on TCP 8080 and UDP 443. Quake occupies TCP 80/443 and UDP 4433, and Caddy's page listener uses HTTP/1.1 and HTTP/2. |

Run `npm run test:production` with `QUAKE_TEST_PUBLIC_URL` set to the public HTTPS origin to repeat the browser check against a fresh e1m1 server. Results and screenshots are saved under ignored `web/test-artifacts/`. Certificates and containers restart automatically; the VM's existing IP is now reserved. Server campaign progress remains in memory and resets when the game container restarts.

Not verified: purchased full-game PAK files (not available locally), a full campaign playthrough, other browsers/devices, eight simultaneous players, controlled WAN packet loss/latency, gamepad input, or pixel-for-pixel native parity. Native UDP clients are incompatible with the browser server. The browser runtime uses the installed 0.97.0 development source; the separate prebuilt Windows executable is 0.96.3.
