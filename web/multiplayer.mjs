import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { X509Certificate, randomBytes } from 'node:crypto';
import path from 'node:path';
import { isIP } from 'node:net';
import selfsigned from 'selfsigned';
import { Http3Server, quicheLoaded } from '@fails-components/webtransport';
import { createQuakeTransport } from './dist/network.js';

const MAX_PLAYERS = 8;

async function certificate(project, options) {
  if (options.tlsCert) {
    const [cert, privateKey] = await Promise.all([readFile(options.tlsCert, 'utf8'), readFile(options.tlsKey, 'utf8')]);
    const parsed = new X509Certificate(cert);
    if (Date.parse(parsed.validTo) <= Date.now()) throw new Error('WebTransport TLS certificate has expired');
    const matches = isIP(options.certificateHostname) ? parsed.checkIP(options.certificateHostname) : parsed.checkHost(options.certificateHostname);
    if (!matches) throw new Error('TLS certificate does not cover the public WebTransport hostname');
    return { cert, privateKey };
  }
  const directory = path.join(project, 'web', '.local');
  await mkdir(directory, { recursive: true });
  try {
    const cert = await readFile(path.join(directory, 'cert.pem'), 'utf8');
    const privateKey = await readFile(path.join(directory, 'key.pem'), 'utf8');
    const parsed = new X509Certificate(cert);
    // Pinned WebTransport certificates must be EC and valid for <= 14 days.
    const matches = isIP(options.certificateHostname) ? parsed.checkIP(options.certificateHostname) : parsed.checkHost(options.certificateHostname);
    if (matches && Date.parse(parsed.validTo) > Date.now() + 24 * 3600000 &&
      Date.parse(parsed.validTo) - Date.parse(parsed.validFrom) <= 14 * 24 * 3600000 && parsed.publicKey.asymmetricKeyType === 'ec') {
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

export async function startMultiplayer(project, options) {
  await quicheLoaded;
  let cert = await certificate(project, options);
  const require = createRequire(import.meta.url);
  const createEngine = require('./dist/engine/quakespasm.cjs');
  const logs = [];
  const sessions = new Set();
  const network = createQuakeTransport(event => console.log(`WebTransport ${event.id}: ${event.state}${event.reason ? ` (${event.reason})` : ''}`));
  const engine = await createEngine({
    noInitialRun: true, quakeTransport: network,
    locateFile: name => path.join(project, 'web', 'dist', 'engine', name),
    print: line => { logs.push(line); if (logs.length > 100) logs.shift(); console.log(`[Quake server] ${line}`); },
    printErr: line => console.error(`[Quake server] ${line}`),
    onAbort: reason => console.error(`Quake server aborted: ${reason}`),
  });
  engine.FS.mkdirTree('/quake/id1');
  engine.FS.mkdirTree('/user/id1');
  for (const name of ['pak0.pak', 'pak1.pak']) {
    try { engine.FS.writeFile(`/quake/id1/${name}`, await readFile(path.join(project, 'runtime', 'id1', name))); }
    catch (error) { if (name === 'pak0.pak' || error.code !== 'ENOENT') throw error; }
  }
  engine.FS.writeFile('/quake/quakespasm.pak', await readFile(path.join(project, 'runtime', 'quakespasm.pak')));
  const mode = process.env.QUAKE_MULTIPLAYER_MODE || 'coop';
  if (!['coop', 'deathmatch'].includes(mode)) throw new Error('QUAKE_MULTIPLAYER_MODE must be coop or deathmatch');
  const map = process.env.QUAKE_MULTIPLAYER_MAP || 'e1m1';
  if (!/^[a-zA-Z0-9_]+$/.test(map)) throw new Error('Invalid multiplayer map name');
  const difficulty = process.env.QUAKE_MULTIPLAYER_SKILL || '1';
  if (!/^[0-3]$/.test(difficulty)) throw new Error('QUAKE_MULTIPLAYER_SKILL must be 0, 1, 2, or 3');
  // Shareware Quake leaves the cmdline cvar empty, so +commands are ignored.
  // A server-owned startup config works for both shareware and registered data.
  engine.FS.writeFile('/user/id1/autoexec.cfg', `hostname "Quake WebTransport"\ncoop ${mode === 'coop' ? 1 : 0}\ndeathmatch ${mode === 'deathmatch' ? 1 : 0}\nnomonsters ${mode === 'coop' ? 0 : 1}\nskill ${difficulty}\nmap ${map}\n`);
  engine.callMain(['-dedicated', String(MAX_PLAYERS), '-basedir', '/quake', '-userdir', '/user', '-heapsize', '196608']);

  const port = options.multiplayerPort;
  const server = new Http3Server({ host: options.multiplayerHost, port, cert: cert.cert, privKey: cert.privateKey, secret: randomBytes(32).toString('hex') });
  const reader = server.sessionStream('/quake').getReader();
  const origins = options.origins;
  // Reject arbitrary websites before they acquire a game connection.
  server.setRequestCallback(async ({ header }) => ({
    status: header[':path'] === '/quake' && origins.has(header.origin) ? 200 : 403,
    path: '/quake',
  }));
  server.startServer();
  await Promise.race([server.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('WebTransport server startup timed out')), 15000).unref())]);
  const accept = async session => {
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
  (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      accept(value).catch(error => console.error(error));
    }
  })().catch(error => console.error(`WebTransport listener failed: ${error.message}`));
  console.log(`Quake ${mode} WebTransport: ${options.multiplayerUrl}`);
  const renewal = setInterval(async () => {
    try {
      const next = await certificate(project, options);
      if (next.cert !== cert.cert) { server.updateCert(next.cert, next.privateKey); cert = next; }
    } catch (error) { console.error(`Local certificate renewal failed: ${error.message}`); }
  }, options.tlsCert ? 60000 : 6 * 3600000);
  renewal.unref();
  return {
    config: () => {
      const state = JSON.parse(engine.ccall('Web_State', 'string', [], []));
      return { available: true, transport: 'webtransport', url: options.multiplayerUrl, certificateHash: cert.hash,
        mode: state.coop && !state.deathmatch ? 'coop' : 'deathmatch', monsters: !state.deathmatch && !state.nomonsters,
        skill: state.skill, map: state.map, maxPlayers: MAX_PLAYERS };
    },
    status: () => ({ ...JSON.parse(engine.ccall('Web_State', 'string', [], [])), transport: network.snapshot(), logs }),
    world: () => JSON.parse(engine.ccall('Web_WorldState', 'string', [], [])),
    command: text => engine.ccall('Web_Command', null, ['string'], [text]),
    stop: () => { clearInterval(renewal); network.closeAll(); for (const session of sessions) session.close(); server.stopServer(); },
  };
}
