# Public co-op deployment

This deploys both the browser game and the persistent, authoritative QuakeSpasm WebTransport server. It requires a Linux host with Docker Compose, a domain pointing directly at that host, and inbound TCP 80/443 plus UDP 4433. DNS/CDN services must allow direct UDP traffic to the game host. The browser page receives trusted HTTPS from Caddy; WebTransport uses its server-generated, rotating twelve-day EC certificate pinned by the HTTPS config response. Existing game connections survive certificate renewal.

From the project root on that host:

```sh
mkdir -p deploy/game-data
# Copy your existing runtime/id1/pak0.pak into deploy/game-data.
cp deploy/.env.example deploy/.env
# Set QUAKE_DOMAIN to your real domain in deploy/.env.
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail=100 quake
```

Open `https://YOUR_DOMAIN`, launch Quake, and join co-op from two computers. The configuration must advertise `https://YOUR_DOMAIN:4433/quake`, monsters enabled, and the selected skill. Then verify actual monster attacks, shared kills and a level transition. `/healthz` returns 200 only when the game simulation is running. Production disables the local diagnostic state/log endpoints. A failed game-server startup fails the deployment rather than silently hosting a page without multiplayer.

The image compiles the vendored engine with Emscripten 4.0.23 and the pinned GL4ES commit. It downloads the official Linux native HTTP/3 prebuild. Game data, certificate private keys, `.env` files, and downloaded tools are excluded from the repository and Docker build context. The game data is mounted read-only; runtime certificates use a separate volume. Server level progress remains in memory and resets on restart.

For an existing HTTPS reverse proxy, use the `quake` service without the `https` service and route the chosen public origin to container port 3000. Keep UDP 4433 exposed directly. Set `QUAKE_PUBLIC_ORIGIN`, `QUAKE_MULTIPLAYER_URL`, and both listen hosts appropriately. `QUAKE_ALLOWED_ORIGINS` accepts additional exact HTTPS origins separated by commas. Wildcard origins are rejected. Optional `QUAKE_TLS_CERT` and `QUAKE_TLS_KEY` paths select a trusted certificate for WebTransport; it must cover the public hostname, and renewal is checked every minute. A trusted certificate is used without browser hash pinning.

Public deployment and its hostname are not configured in this checkout yet. The container configuration is prepared; its build and public two-computer flow still need verification on the selected host.
