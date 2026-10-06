import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { X509Certificate, createPrivateKey, randomBytes } from 'node:crypto';
import path from 'node:path';
import { isIP } from 'node:net';
import selfsigned from 'selfsigned';
import { Http3Server, quicheLoaded } from '@fails-components/webtransport';
import { createQuakeTransport } from './dist/network.js';
import { multiplayerRules, roomStartup } from './rooms.mjs';

const MAX_PLAYERS = 8;

async function certificate(project, options) {
  if (options.tlsCert) {
    const [cert, privateKey] = await Promise.all([readFile(options.tlsCert, 'utf8'), readFile(options.tlsKey, 'utf8')]);
    const parsed = new X509Certificate(cert);
    if (Date.parse(parsed.validTo) <= Date.now()) throw new Error('WebTransport TLS certificate has expired');
    if (!parsed.checkPrivateKey(createPrivateKey(privateKey))) throw new Error('WebTransport TLS private key does not match its certificate');
    const matches = isIP(options.certificateHostname) ? parsed.checkIP(options.certificateHostname) : parsed.checkHost(options.certificateHostname);
    if (!matches) throw new Error('TLS certificate does not cover the public WebTransport hostname');
    return { cert, privateKey };
  }
  const directory = options.certificateDirectory || path.join(project, 'web', '.local');
  await mkdir(directory, { recursive: true });
  try {
    const cert = await readFile(path.join(directory, 'cert.pem'), 'utf8');
    const privateKey = await readFile(path.join(directory, 'key.pem'), 'utf8');
    const parsed = new X509Certificate(cert);
    // Pinned WebTransport certificates must be EC and valid for <= 14 days.
    const matches = isIP(options.certificateHostname) ? parsed.checkIP(options.certificateHostname) : parsed.checkHost(options.certificateHostname);
    if (matches && Date.parse(parsed.validTo) > Date.now() + 24 * 3600000 &&
      Date.parse(parsed.validTo) - Date.parse(parsed.validFrom) <= 14 * 24 * 3600000 &&
      parsed.publicKey.asymmetricKeyType === 'ec' && parsed.checkPrivateKey(createPrivateKey(privateKey))) {
      return { cert, privateKey, hash: parsed.fingerprint256.replaceAll(':', '').toLowerCase() };
    }
  } catch (error) { if (error.code !== 'ENOENT') console.warn(`Refreshing local certificate: ${error.message}`); }
  const generated = await selfsigned.generate([{ name: 'commonName', value: options.certificateHostname }], {
    keyType: 'ec', curve: 'P-256', algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 3600000),
    notAfterDate: new Date(Date.now() + 12 * 24 * 3600000),
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' },
        isIP(options.certificateHostname) ? { type: 7, ip: options.certificateHostname } : { type: 2, value: options.certificateHostname }] },
    ],
  });
  await writeFile(path.join(directory, 'cert.pem'), generated.cert);
  await writeFile(path.join(directory, 'key.pem'), generated.private, { mode: 0o600 });
  return { cert: generated.cert, privateKey: generated.private, hash: new X509Certificate(generated.cert).fingerprint256.replaceAll(':', '').toLowerCase() };
}

async function startRoom(project, definition, options) {
  const require = createRequire(import.meta.url);
  const createEngine = require('./dist/engine/quakespasm.cjs');
  const logs = [];
  const sessions = new Set();
  const network = createQuakeTransport(event => console.log(`WebTransport ${definition.id}/${event.id}: ${event.state}${event.reason ? ` (${event.reason})` : ''}`));
  const engine = await createEngine({
    noInitialRun: true, quakeTransport: network,
    locateFile: name => path.join(project, 'web', 'dist', 'engine', name),
    print: line => { logs.push(line); if (logs.length > 100) logs.shift(); console.log(`[Quake ${definition.id}] ${line}`); },
    printErr: line => console.error(`[Quake ${definition.id}] ${line}`),
    onAbort: reason => console.error(`Quake ${definition.id} aborted: ${reason}`),
  });
  engine.FS.mkdirTree('/quake/id1');
  engine.FS.mkdirTree('/user/id1');
  for (const name of ['pak0.pak', 'pak1.pak']) {
    try { engine.FS.writeFile(`/quake/id1/${name}`, await readFile(path.join(project, 'runtime', 'id1', name))); }
    catch (error) { if (name === 'pak0.pak' || error.code !== 'ENOENT') throw error; }
  }
  engine.FS.writeFile('/quake/quakespasm.pak', await readFile(path.join(project, 'runtime', 'quakespasm.pak')));
  for (const file of options.editorFiles || []) {
    if (!/^maps\/[a-zA-Z0-9_]+\.(bsp|lit)$/.test(file.name)) throw new Error('Invalid editor map artifact');
    engine.FS.mkdirTree('/user/id1/maps');
    engine.FS.writeFile(`/user/id1/${file.name}`, new Uint8Array(file.bytes));
  }
  // Shareware Quake leaves the cmdline cvar empty, so +commands are ignored.
  // A server-owned startup config works for both shareware and registered data.
  engine.FS.writeFile('/user/id1/autoexec.cfg', roomStartup(definition));
  engine.callMain(['-dedicated', String(MAX_PLAYERS), '-basedir', '/quake', '-userdir', '/user', '-heapsize', '196608']);
  return { ...definition, engine, network, logs, sessions,
    state: () => JSON.parse(engine.ccall('Web_State', 'string', [], [])),
    world: () => JSON.parse(engine.ccall('Web_WorldState', 'string', [], [])),
    command: text => engine.ccall('Web_Command', null, ['string'], [text]),
  };
}

export async function startMultiplayer(project, options) {
  await quicheLoaded;
  const rules = options.roomDefinitions || multiplayerRules();
  let cert = await certificate(project, options);
  // Each factory call owns its own C globals, WASM memory, filesystem and
  // transport. Selecting a mode never changes the other room's game rules.
  const rooms = new Map();
  for (const definition of rules.rooms) rooms.set(definition.id, await startRoom(project, definition, options));
  const paths = new Map([...rooms.values()].map(room => [room.path, room]));

  const port = options.multiplayerPort;
  const server = new Http3Server({ host: options.multiplayerHost, port, cert: cert.cert, privKey: cert.privateKey, secret: randomBytes(32).toString('hex') });
  const origins = options.origins;
  // Reject arbitrary websites before they acquire a game connection.
  server.setRequestCallback(async ({ header }) => ({
    status: paths.has(header[':path']) && origins.has(header.origin) ? 200 : 403,
    path: paths.has(header[':path']) ? header[':path'] : '/quake',
  }));
  const readers = [...rooms.values()].map(room => ({ room, reader: server.sessionStream(room.path).getReader() }));
  server.startServer();
  await Promise.race([server.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('WebTransport server startup timed out')), 15000).unref())]);
  const accept = async (room, session) => {
    const { sessions, network } = room;
    if (sessions.size >= MAX_PLAYERS) { session.close({ closeCode: 2, reason: 'Server full' }); return; }
    sessions.add(session);
    let id;
    const timeout = setTimeout(() => session.close({ closeCode: 3, reason: 'No game stream received' }), 5000);
    session.closed.then(() => sessions.delete(session), () => sessions.delete(session));
    try {
      await session.ready;
      const streams = session.incomingBidirectionalStreams.getReader();
      try {
        const { value: stream, done } = await streams.read();
        if (done) return;
        clearTimeout(timeout);
        id = network.attach(session, stream, true);
        // This protocol uses exactly one reliable stream for each player.
        while (network.alive(id)) {
          const extra = await streams.read();
          if (extra.done) break;
          network.close(id); break;
        }
      } finally { streams.releaseLock(); }
    } catch (error) {
      console.warn(`WebTransport session failed: ${error.message}`);
      if (id) network.close(id);
      else session.close();
    } finally { clearTimeout(timeout); }
  };
  for (const { room, reader } of readers) {
    (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        accept(room, value).catch(error => console.error(error));
      }
    })().catch(error => console.error(`WebTransport ${room.id} listener failed: ${error.message}`));
    console.log(`Quake ${room.id} WebTransport: ${new URL(room.path, options.multiplayerUrl)}`);
  }
  const renewal = setInterval(async () => {
    try {
      const next = await certificate(project, options);
      if (next.cert !== cert.cert) { server.updateCert(next.cert, next.privateKey); cert = next; }
    } catch (error) { console.error(`Local certificate renewal failed: ${error.message}`); }
  }, options.tlsCert ? 60000 : 6 * 3600000);
  renewal.unref();
  const roomConfig = room => {
      const state = room.state();
      return { id: room.id, label: room.label, available: Boolean(state.serverActive), transport: 'webtransport',
        url: new URL(room.path, options.multiplayerUrl).href, certificateHash: cert.hash,
        mode: state.coop && !state.deathmatch ? 'coop' : 'deathmatch', monsters: !state.deathmatch && !state.nomonsters,
        skill: state.skill, map: state.map, maxPlayers: MAX_PLAYERS, players: state.players.length,
        fragLimit: state.fragLimit, timeLimit: state.timeLimit };
  };
  const selectedRoom = (mode = rules.defaultMode) => {
    const room = rooms.get(mode);
    if (!room) throw new Error('Unknown multiplayer mode');
    return room;
  };
  return {
    config: mode => ({ ...roomConfig(selectedRoom(mode)), defaultMode: rules.defaultMode, rooms: [...rooms.values()].map(roomConfig) }),
    healthy: () => [...rooms.values()].every(room => room.state().serverActive),
    status: mode => { const room = selectedRoom(mode); return { ...room.state(), transport: room.network.snapshot(), logs: room.logs }; },
    world: mode => selectedRoom(mode).world(),
    command: (text, mode) => selectedRoom(mode).command(text),
    stop: () => {
      clearInterval(renewal);
      for (const room of rooms.values()) { room.network.closeAll(); for (const session of room.sessions) session.close(); }
      server.stopServer();
    },
  };
}
