import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createQuakeTransport, SOCKET_PROTOCOL } from '../dist/network.js';
import { createSocketServer } from '../websocket.mjs';

const origin = 'http://localhost';
async function fixture(t) {
  const room = { id: 'coop', sessions: new Set(), network: createQuakeTransport() };
  const rooms = new Map([[room.id, room]]);
  const sockets = createSocketServer({ rooms, origins: new Set([origin]), maxPlayers: 2, accept: (selected, socket) => {
    selected.sessions.add(socket); socket.once('close', () => selected.sessions.delete(socket)); selected.network.attachSocket(socket, true);
  } });
  const server = createServer(); sockets.attach(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { room.network.closeAll(); sockets.stop(); await new Promise(resolve => server.close(resolve)); });
  return { room, url: `ws://127.0.0.1:${server.address().port}` };
}
async function nextMessage(network, id) {
  for (let i = 0; i < 100; i++) { const message = network.receive(id); if (message) return message; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Game message did not arrive');
}

test('real WebSockets exchange maximum reliable messages and updates through the same game network interface', async t => {
  const { room, url } = await fixture(t);
  const socket = new WebSocket(`${url}/multiplayer/coop`, SOCKET_PROTOCOL, { origin });
  await once(socket, 'open');
  const client = createQuakeTransport(); t.after(() => client.closeAll());
  const clientId = client.attachSocket(socket), serverId = room.network.accept();
  const payload = Uint8Array.from({ length: 64000 }, (_, i) => i % 251);
  assert.equal(client.send(clientId, 1, payload), 1);
  assert.deepEqual(await nextMessage(room.network, serverId), { kind: 1, data: payload });
  assert.equal(room.network.send(serverId, 2, new Uint8Array([9, 8, 7])), 1);
  assert.deepEqual(await nextMessage(client, clientId), { kind: 2, data: new Uint8Array([9, 8, 7]) });
  assert.equal(room.sessions.size, 1);
});

async function rejected(url, { site = origin, protocol = SOCKET_PROTOCOL } = {}) {
  const socket = new WebSocket(url, protocol, { origin: site });
  socket.on('error', () => {});
  return new Promise((resolve, reject) => {
    socket.once('open', () => { socket.terminate(); reject(new Error('Unexpected accepted socket')); });
    socket.once('unexpected-response', (_, response) => { response.resume(); socket.terminate(); resolve(response.statusCode); });
    socket.once('error', reject);
  });
}
test('socket upgrades enforce the allowed origin, room path, protocol, and shared WebTransport player limit', async t => {
  const { room, url } = await fixture(t);
  assert.equal(await rejected(`${url}/multiplayer/coop`, { site: 'https://other.example' }), 403);
  assert.equal(await rejected(`${url}/multiplayer/unknown`), 404);
  assert.equal(await rejected(`${url}/multiplayer/coop?room=deathmatch`), 404);
  assert.equal(await rejected(`${url}/multiplayer/coop`, { protocol: 'other-game' }), 426);
  const reservedWebTransport = { close() {} }; room.sessions.add(reservedWebTransport);
  const socket = new WebSocket(`${url}/multiplayer/coop`, SOCKET_PROTOCOL, { origin });
  await once(socket, 'open');
  assert.equal(room.sessions.size, 2);
  assert.equal(await rejected(`${url}/multiplayer/coop`), 503);
  const serverPeer = [...room.sessions].find(peer => peer !== reservedWebTransport);
  const closed = Promise.all([once(socket, 'close'), once(serverPeer, 'close')]); socket.close(); await closed;
  assert.equal(room.sessions.size, 1);
});
