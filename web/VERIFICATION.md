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

`npm test` passes nine tests: six protocol tests covering arbitrary reliable-stream chunk boundaries, invalid and truncated frames, datagram sequencing with wraparound, stream backpressure, bounded datagram writes, and isolated socket cleanup; three configuration tests cover local defaults, public production addresses, disabled production diagnostics, and rejection of insecure or ambiguous endpoints.

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
| Deathmatch | Switched to `deathmatch=1`, `coop=0` and completed the next sign-on. |
| Disconnect/reconnect | Three cycles freed and reused player slots while the second player remained connected. |
| Server loss | Both clients detected shutdown, then rejoined after a server restart. |
| Browser errors | Neither final client reported JavaScript errors. |

The test saves screenshots, server logs, and a JSON evidence report under ignored `web/test-artifacts/`. It uses reserved test ports 3102/4445 and closes its own browsers and server afterward. `AGENT_BROWSER_BIN` can specify the automation CLI location. The server and client artifacts were rebuilt with Emscripten 4.0.23; the browser build links loopback and WebTransport drivers only.

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
