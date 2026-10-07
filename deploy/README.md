# Public multiplayer deployment

This deploys both the browser game and the persistent, authoritative QuakeSpasm WebTransport server. It requires a Linux host with Docker Compose, a domain pointing directly at that host, and inbound TCP 80/443 plus UDP 4433. DNS/CDN services must allow direct UDP traffic to the game host. The browser page receives trusted HTTPS from Caddy; WebTransport uses its server-generated, rotating twelve-day EC certificate pinned by the HTTPS config response. Existing game connections survive certificate renewal.

Browsers that cannot complete a WebTransport join automatically use WebSocket
through the same trusted HTTPS origin, at `/multiplayer/coop` or
`/multiplayer/deathmatch`. Caddy forwards these upgrades automatically; another
reverse proxy must forward WebSocket upgrades to container port 3000. This needs
no additional public port or certificate and also works on networks blocking
UDP 4433. Both transports share each room's eight-player limit and game state.

From the project root on that host:

```sh
mkdir -p deploy/game-data
# Install curl, unzip and lhasa if needed, then prepare the original shareware:
bash tools/setup-shareware.sh
cp deploy/.env.example deploy/.env
# Set QUAKE_DOMAIN to your real domain in deploy/.env.
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail=100 quake
```

Open `https://YOUR_DOMAIN`, launch Quake, and join co-op from two computers. The configuration must advertise `https://YOUR_DOMAIN:4433/quake`, monsters enabled, and the selected skill. Select Deathmatch and join to use the separate `https://YOUR_DOMAIN:4433/deathmatch` room with no monsters. Verify PvP damage, scores and respawning, then switch back to co-op. `/healthz` returns 200 only when both game simulations are running. Production disables the local diagnostic state/log endpoints. A failed game-server startup fails the deployment rather than silently hosting a page without multiplayer.

Deathmatch defaults to E1M1, eight players, 20 frags and 10-minute rounds. `QUAKE_DEATHMATCH_MAP`, `QUAKE_DEATHMATCH_FRAGLIMIT` and `QUAKE_DEATHMATCH_TIMELIMIT` in `deploy/.env` configure its arena and limits; zero means unlimited. Co-op and deathmatch have separate engine instances and player slots, with one WebTransport listener and certificate. No extra public ports are needed.

The image compiles the vendored engine with Emscripten 4.0.23 and the pinned GL4ES commit. It downloads the official Linux native HTTP/3 prebuild. Game data, certificate private keys, `.env` files, and downloaded tools are excluded from the repository and Docker build context. The game data is mounted read-only; runtime certificates use a separate volume. Server level progress remains in memory and resets on restart.

To offer music to every player, put files named `track02.ogg` … `track11.ogg` (or MP3, Opus, FLAC, WAV, M4A) in `deploy/game-data/music/`; they are streamed on demand, and only music you may share should go there. Players can also add their own files in the browser. `https://YOUR_DOMAIN/status` is a public page listing who is playing in each room, with names, frags, ping and time online, from the `/api/status` endpoint.

For an existing HTTPS reverse proxy, use the `quake` service without the `https` service and route the chosen public origin to container port 3000. Keep UDP 4433 exposed directly. Set `QUAKE_PUBLIC_ORIGIN`, `QUAKE_MULTIPLAYER_URL`, and both listen hosts appropriately. `QUAKE_ALLOWED_ORIGINS` accepts additional exact HTTPS origins separated by commas. Wildcard origins are rejected. Optional `QUAKE_TLS_CERT` and `QUAKE_TLS_KEY` paths select a trusted certificate for WebTransport; it must cover the public hostname, and renewal is checked every minute. A trusted certificate is used without browser hash pinning.

The Google Compute Engine deployment uses project `webtransport-arena`, instance `webtransport-arena`, zone `us-central1-a`, and reserved IP `34.10.23.32`. Its public origin is `https://quake.34.10.23.32.sslip.io` and WebTransport endpoint is `https://quake.34.10.23.32.sslip.io:4433/quake`. The files live at `/opt/quakeSRC`; Quake uses TCP 80/443 and UDP 4433 alongside the existing WebTransportArena service on TCP 8080 and UDP 443.

GitHub Actions builds and smoke-tests `quake-web:<commit SHA>` and uploads the compressed Docker image as the `quake-image` artifact. On this small VM, load that prebuilt image rather than compiling there. Put its tag in `deploy/.env` as `QUAKE_IMAGE`, then use `docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --no-build`. Both services restart automatically with Docker. An image update restarts the Quake simulation and resets its level progress.

To verify the public game using two isolated Chromium browsers from another machine, install agent-browser and its browser, then run `QUAKE_TEST_PUBLIC_URL=https://quake.34.10.23.32.sslip.io npm run test:production` (PowerShell: set `$env:QUAKE_TEST_PUBLIC_URL` before running npm). This checks trusted HTTPS, both co-op joins, chat, replicated movement, a real monster attack, and a shared monster kill without exposing diagnostic routes. Run it against a fresh e1m1 server; it plays and kills one monster, then disconnects. Evidence and screenshots go to ignored `web/test-artifacts/`.

With the same public URL variable, run `npm run test:deathmatch` for two deathmatch players and a third co-op player. It checks room isolation, ordinary movement and aiming, actual PvP damage and death, frag replication, fire-to-respawn, mode switching, and client errors. The local version also exercises frag/time limits and round restart through the private server terminal.
