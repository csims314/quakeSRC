import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMultiplayer } from './multiplayer.mjs';
import { createInterface } from 'node:readline';
import { serverConfig } from './config.mjs';
import { createEditorService, editorOptions, isLoopback } from './editor/service.mjs';
import { listMusic, byteRange, MUSIC_FILE, musicType } from './music.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(project, 'web', 'dist');
const options = serverConfig();
const editorSettings = editorOptions(options);
if (editorSettings.lan) {
  options.origins.add(`https://localhost:${options.webPort}`);
  options.origins.add(`https://127.0.0.1:${options.webPort}`);
}
const editor = createEditorService(project, options, editorSettings);
const port = options.webPort;
let multiplayer, multiplayerError;
try { multiplayer = await startMultiplayer(project, options); }
catch (error) {
  if (options.production) throw error;
  multiplayerError = error.message; console.error(`Multiplayer unavailable: ${error.stack}`);
}
if (multiplayer && (process.stdin.isTTY || process.env.QUAKE_SERVER_CONSOLE === '1')) {
  createInterface({ input: process.stdin }).on('line', command => {
    const scoped = command.match(/^(coop|deathmatch):\s*(.*)$/);
    multiplayer.command(scoped ? scoped[2] : command, scoped?.[1]);
  });
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.pak': 'application/octet-stream', '.ico': 'image/x-icon', '.png': 'image/png' };
const assets = {
  '/assets/pak0.pak': path.join(project, 'runtime', 'id1', 'pak0.pak'),
  '/assets/pak1.pak': path.join(project, 'runtime', 'id1', 'pak1.pak'),
  '/assets/quakespasm.pak': path.join(project, 'runtime', 'quakespasm.pak'),
  '/assets/quake106.zip': path.join(project, 'runtime', 'id1', 'quake106.zip'),
  '/assets/shareware-license.txt': path.join(project, 'runtime', 'shareware-docs', 'SLICNSE.TXT'),
};
const musicDirectory = path.join(project, 'runtime', 'id1', 'music');
const json = (res, value) => {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(200).end(JSON.stringify(value));
};

const handleRequest = async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (await editor.handler(req, res, url)) return;
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    if (url.pathname === '/healthz') {
      const healthy = Boolean(multiplayer?.healthy());
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(healthy ? 200 : 503).end(JSON.stringify({ ready: healthy }));
      return;
    }
    if (['/api/multiplayer', '/api/multiplayer/status', '/api/multiplayer/world'].includes(url.pathname)) {
      if (url.pathname !== '/api/multiplayer' && !options.diagnostics) { res.writeHead(404).end(); return; }
      const mode = url.searchParams.get('mode') || undefined;
      if (mode && !['coop', 'deathmatch'].includes(mode)) { res.writeHead(400).end('Unknown multiplayer mode'); return; }
      const response = multiplayer
        ? (url.pathname.endsWith('/status') ? multiplayer.status(mode) : url.pathname.endsWith('/world') ? multiplayer.world(mode) : multiplayer.config(mode))
        : { available: false, error: multiplayerError };
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200).end(JSON.stringify(response));
      return;
    }
    // Public: room settings and each player's name, frags, ping and time online.
    if (url.pathname === '/api/status') {
      json(res, multiplayer ? multiplayer.publicStatus() : { available: false, players: 0, rooms: [] });
      return;
    }
    if (url.pathname === '/api/music') { json(res, { tracks: await listMusic(musicDirectory) }); return; }
    let pathname = decodeURIComponent(url.pathname);
    if (editorSettings.lan && !isLoopback(req.socket.remoteAddress) && /^\/assets\/(pak[01]\.pak|quakespasm\.pak)$/.test(pathname)) {
      res.writeHead(403).end('Select your own Quake files on the join page.'); return;
    }
    if (pathname === '/editor') { res.writeHead(308, { Location: '/editor/' }).end(); return; }
    if (pathname === '/editor/') pathname = '/editor/index.html';
    if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (pathname.startsWith('/assets/music/')) {
      const name = pathname.slice('/assets/music/'.length);
      if (!MUSIC_FILE.test(name)) { res.writeHead(404).end(); return; }
      const file = path.join(musicDirectory, name);
      const info = await stat(file);
      if (!info.isFile()) { res.writeHead(404).end(); return; }
      const range = byteRange(req.headers.range, info.size);
      res.setHeader('Content-Type', musicType(name));
      res.setHeader('Accept-Ranges', 'bytes');
      if (range?.unsatisfiable) {
        res.setHeader('Content-Range', `bytes */${info.size}`);
        res.writeHead(416).end();
        return;
      }
      const { start, end } = range || { start: 0, end: info.size - 1 };
      res.setHeader('Content-Length', end - start + 1);
      if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
      res.writeHead(range ? 206 : 200);
      if (req.method === 'HEAD' || !info.size) res.end();
      else createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
      return;
    }
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/status') pathname = '/status.html';
    const file = assets[pathname] || path.resolve(root, `.${pathname}`);
    if (!assets[pathname] && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Content-Length', info.size);
    res.writeHead(200);
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch (error) {
    if (error.code === 'ENOENT' && new URL(req.url, 'http://localhost').pathname === '/assets/pak1.pak') {
      res.writeHead(204).end();
      return;
    }
    res.writeHead(error.code === 'ENOENT' ? 404 : 500).end('File unavailable');
  }
};
const server = editorSettings.lan
  ? createHttpsServer({ cert: await readFile(options.tlsCert), key: await readFile(options.tlsKey) }, handleRequest)
  : createServer(handleRequest);
server.listen(port, editorSettings.lan ? '0.0.0.0' : options.webHost, () => console.log(`Quake WebGL: ${options.publicOrigin}`));
server.on('error', error => { console.error(error.message); multiplayer?.stop(); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  await editor.stop(); multiplayer?.stop(); server.close(); process.exit(0);
});
