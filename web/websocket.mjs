import { WebSocketServer } from 'ws';
import { MAX_MESSAGE, SOCKET_PROTOCOL } from './dist/network.js';

// Share the existing HTTPS listener and its trusted certificate. The proxy
// forwards upgrades, so this path works over TCP 443 without another port.
export function createSocketServer({ rooms, origins, maxPlayers, accept }) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE + 1, perMessageDeflate: false,
    handleProtocols: protocols => protocols.has(SOCKET_PROTOCOL) ? SOCKET_PROTOCOL : false });
  const paths = new Map([...rooms.values()].map(room => [`/multiplayer/${room.id}`, room]));
  const reject = (socket, status) => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
  const upgrade = (request, socket, head) => {
    socket.on('error', () => {});
    let url;
    try { url = new URL(request.url, 'http://localhost'); } catch { reject(socket, '400 Bad Request'); return; }
    const room = paths.get(url.pathname);
    if (!room || url.search) { reject(socket, '404 Not Found'); return; }
    if (!origins.has(request.headers.origin)) { reject(socket, '403 Forbidden'); return; }
    if (!(request.headers['sec-websocket-protocol'] || '').split(',').map(value => value.trim()).includes(SOCKET_PROTOCOL)) {
      reject(socket, '426 Upgrade Required'); return;
    }
    if (room.sessions.size >= maxPlayers) { reject(socket, '503 Service Unavailable'); return; }
    sockets.handleUpgrade(request, socket, head, peer => {
      peer.alive = true;
      peer.on('pong', () => { peer.alive = true; });
      accept(room, peer);
    });
  };
  const heartbeat = setInterval(() => {
    for (const peer of sockets.clients) {
      if (!peer.alive) { peer.terminate(); continue; }
      peer.alive = false; peer.ping();
    }
  }, 30000);
  heartbeat.unref();
  let listener;
  return {
    attach(server) { listener = server; server.on('upgrade', upgrade); },
    stop() {
      clearInterval(heartbeat); listener?.off('upgrade', upgrade);
      for (const peer of sockets.clients) peer.terminate();
      sockets.close();
    },
  };
}
