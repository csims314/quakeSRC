import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as portProbe } from 'node:net';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.QUAKE_TEST_WEB_PORT || 3102);
const quicPort = Number(process.env.QUAKE_TEST_MULTIPLAYER_PORT || 4445);
const url = `http://127.0.0.1:${port}`;
const nativeCli = path.join(path.dirname(process.execPath), 'node_modules', 'agent-browser', 'bin', 'agent-browser-win32-x64.exe');
const cli = process.env.AGENT_BROWSER_BIN || (process.platform === 'win32' && existsSync(nativeCli) ? nativeCli : 'agent-browser');
const artifactDir = path.join(project, 'web/test-artifacts');
const sessions = [`quake-wt-test-a-${process.pid}`, `quake-wt-test-b-${process.pid}`];
let server, serverOutput = '', failure;
const checks = [];
let monsterEvidence;
let statusMode = 'coop';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(fn, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    try { last = await fn(); if (last) return last; } catch (error) { last = error.message; }
    await delay(150);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}; last result: ${JSON.stringify(last)}`);
}
function browser(session, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ['--session', session, '--json', ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '', error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Browser command timed out: ${args.join(' ')}`)); }, 30000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    // On Windows a newly started daemon can inherit the CLI's output pipe.
    // The command process exits before that inherited pipe closes.
    child.on('exit', code => {
      clearTimeout(timer);
      child.stdout.destroy(); child.stderr.destroy();
      try {
        const result = JSON.parse(output.trim());
        if (code || !result.success) throw new Error(result.error || error || output);
        resolve(result.data);
      } catch (problem) { reject(new Error(`${args.join(' ')}: ${problem.message}; ${error}`)); }
    });
    child.stdin.end(input);
  });
}
async function evaluate(session, code) { return (await browser(session, ['eval', '--stdin'], code)).result; }
async function command(session, text) { return evaluate(session, `window.quake.command(${JSON.stringify(text)}); true`); }
async function game(session) { return evaluate(session, '({state:window.quake?.state(),network:window.quake?.network.snapshot(),errors:window.__quakeErrors,log:window.quake?.logs})'); }
async function status() { return (await fetch(`${url}/api/multiplayer/status?mode=${statusMode}`, { signal: AbortSignal.timeout(2000) })).json(); }
async function world() { return (await fetch(`${url}/api/multiplayer/world?mode=${statusMode}`, { signal: AbortSignal.timeout(2000) })).json(); }
async function click(session, name) { await browser(session, ['find', 'role', 'button', 'click', '--name', name]); }
async function join(session) {
  await waitFor(() => evaluate(session, "!document.getElementById('join').disabled"), 'multiplayer join control ready');
  const label = await evaluate(session, "document.getElementById('join').textContent");
  await click(session, label);
  return joined(session);
}
async function joined(session, map = 'e1m1') {
  return waitFor(async () => {
    const result = await game(session);
    return result.state?.signon === 4 && !result.state.serverActive && result.state.map === `maps/${map}.bsp` && result.network.some(c => c.open) ? result : false;
  }, `player joining ${map}`);
}
function startServer() {
  server = spawn(process.execPath, ['web/server.mjs'], {
    cwd: project, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, QUAKE_WEB_PORT: String(port), QUAKE_MULTIPLAYER_PORT: String(quicPort), QUAKE_MULTIPLAYER_MODE: 'coop', QUAKE_MULTIPLAYER_MAP: 'e1m1', QUAKE_MULTIPLAYER_SKILL: '1', QUAKE_SERVER_CONSOLE: '1' },
  });
  server.stdout.on('data', chunk => { serverOutput += chunk; });
  server.stderr.on('data', chunk => { serverOutput += chunk; });
  server.on('error', error => { serverOutput += error.message; });
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const child = server;
  await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
}
function passed(name) { checks.push(name); console.log(`PASS ${name}`); }

await mkdir(artifactDir, { recursive: true });
try {
  // Fail if the test ports are already in use rather than touching another server.
  await new Promise((resolve, reject) => {
    const probe = portProbe();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  startServer();
  await waitFor(async () => (await status()).serverActive, 'dedicated server startup');
  const initial = await status();
  assert.equal(initial.map, 'e1m1'); assert.equal(initial.coop, 1); assert.equal(initial.deathmatch, 0);
  assert.equal(initial.nomonsters, 0); assert.equal(initial.skill, 1);
  const config = await (await fetch(`${url}/api/multiplayer`)).json();
  assert.equal(config.monsters, true); assert.equal(config.mode, 'coop');
  const spawnedMonsters = await world();
  assert.ok(initial.totalMonsters > 0 && spawnedMonsters.alive >= initial.totalMonsters);
  passed('dedicated original Quake engine starts in co-op on e1m1');
  for (const [index, session] of sessions.entries()) {
    await browser(session, ['open', url]);
    const snapshot = await browser(session, ['snapshot', '-i']);
    assert.ok(JSON.stringify(snapshot).includes('Launch Quake'));
    assert.ok(JSON.stringify(snapshot).includes('Join co-op'));
    assert.ok((await evaluate(session, "document.getElementById('multiplayer-summary').textContent")).includes('Original monsters'));
    assert.deepEqual((await game(session)).errors, []);
    if (index === 1) await evaluate(session, 'window.WebTransport = undefined; true');
    await click(session, 'Launch Quake');
    await waitFor(async () => (await evaluate(session, 'window.quake?.ready && window.quake.state().signon === 4')), 'single-player startup');
    await browser(session, ['press', 'Escape']);
    await join(session);
    assert.equal((await game(session)).network.find(connection => connection.open).transport, index === 1 ? 'websocket' : 'webtransport');
  }
  await waitFor(async () => (await status()).players.length === 2, 'two spawned players');
  passed('WebTransport and WebSocket players join the same game through the real multiplayer button');

  await evaluate(sessions[0], "window.quake.command('name Alpha\\nsay WebTransport reliable chat verified'); true");
  await waitFor(async () => (await game(sessions[1])).log.some(line => line.includes('WebTransport reliable chat verified')), 'reliable chat received by second player');
  passed('reliable name and chat messages reach the second player');

  const before = (await game(sessions[0])).state.origin;
  await evaluate(sessions[0], "window.quake.command('+forward'); true");
  await delay(450);
  await evaluate(sessions[0], "window.quake.command('-forward'); true");
  const moved = await waitFor(async () => {
    const state = (await game(sessions[0])).state;
    return Math.hypot(...state.origin.map((n, i) => n - before[i])) > 20 ? state : false;
  }, 'movement accepted by server');
  await waitFor(async () => {
    const peer = (await game(sessions[1])).state.players.find(p => p.slot === 1);
    return peer && Math.hypot(...peer.origin.map((n, i) => n - moved.origin[i])) < 20;
  }, 'movement replicated to second player');
  const ammo = (await game(sessions[0])).state.ammo;
  await evaluate(sessions[0], "window.quake.command('+attack'); true");
  await delay(650);
  await evaluate(sessions[0], "window.quake.command('-attack'); true");
  await waitFor(async () => (await game(sessions[0])).state.ammo < ammo, 'server-authoritative firing consumes ammunition');
  passed('movement and firing are processed by the server and replicated through datagrams');

  // Stage combat in the first soldier's room using Quake's existing setpos/god
  // commands. No entity or AI test substitutes: original QuakeC runs throughout.
  const target = spawnedMonsters.actors.find(actor => actor.classname === 'monster_army' && actor.origin[0] === 0 && actor.origin[1] === 576);
  assert.ok(target, 'original e1m1 soldier exists');
  const healthBefore = (await game(sessions[1])).state.health;
  const killsBefore = (await status()).killedMonsters;
  await command(sessions[1], 'setpos 96 608 24 0 198.435 0\nnoclip 0');
  const activeMonster = await waitFor(async () => {
    const actor = (await world()).actors.find(actor => actor.id === target.id);
    return actor?.enemy === 2 && actor.thinking && actor.frame !== target.frame ? actor : false;
  }, 'original monster AI acquires player two and animates');
  const hurt = await waitFor(async () => {
    const state = (await game(sessions[1])).state;
    return state.health < healthBefore && state.health > 0 ? state : false;
  }, 'monster attack damages the second player');
  await command(sessions[1], 'god 1');
  await command(sessions[0], 'god 1\nsetpos 160 608 24 0 180 0\nnoclip 0');
  for (const session of sessions) await waitFor(async () => {
    const actor = await evaluate(session, `window.quake.world().actors.find(actor => actor.id === ${target.id})`);
    return actor?.model === target.model ? actor : false;
  }, 'same live monster replicated to both browsers');
  const aimAtMonster = async () => {
    const actor = (await world()).actors.find(actor => actor.id === target.id);
    if (actor.health <= 0) return;
    const position = (await game(sessions[0])).state.origin;
    const dx = actor.origin[0] - position[0], dy = actor.origin[1] - position[1];
    const pitch = -Math.atan2(actor.origin[2] + 16 - (position[2] + 22), Math.hypot(dx, dy)) * 180 / Math.PI;
    const yaw = Math.atan2(dy, dx) * 180 / Math.PI;
    await command(sessions[0], `setpos ${position.join(' ')} ${pitch} ${yaw} 0\nnoclip 0\n+attack`);
  };
  const shotAmmo = (await game(sessions[0])).state.ammo;
  await aimAtMonster();
  const damagedMonster = await waitFor(async () => {
    const actor = (await world()).actors.find(actor => actor.id === target.id);
    return actor && actor.health < target.health ? actor : false;
  }, 'player weapon damages the original monster');
  const deadMonster = await waitFor(async () => {
    const actor = (await world()).actors.find(actor => actor.id === target.id);
    if (actor.health <= 0) return actor;
    await aimAtMonster();
    return false;
  }, 'original monster dies from player attacks');
  await evaluate(sessions[0], "window.quake.command('-attack'); true");
  assert.ok((await game(sessions[0])).state.ammo < shotAmmo);
  const replicas = [];
  for (const session of sessions) {
    const replica = await waitFor(async () => {
      const authoritative = (await world()).actors.find(actor => actor.id === target.id);
      const client = await evaluate(session, `({state:window.quake.state(),actor:window.quake.world().actors.find(actor => actor.id === ${target.id})})`);
      return client.state.killedMonsters > killsBefore && client.actor?.model === target.model &&
        client.actor.frame === authoritative.frame && Math.hypot(...client.actor.origin.map((n, i) => n - authoritative.origin[i])) < 4 ? client : false;
    }, 'monster death, animation, position and shared kill count replicated');
    replicas.push(replica);
    await evaluate(session, "window.quake.command('god 0'); true");
  }
  monsterEvidence = { spawned: spawnedMonsters.alive, target, activeMonster, playerHealthBefore: healthBefore,
    playerHealthAfter: hurt.health, damagedMonster, deadMonster, replicas };
  passed('original monster AI attacks a player; player fire kills it; both browsers share the corpse and kill count');

  server.stdin.write('changelevel e1m2\n');
  for (const session of sessions) await joined(session, 'e1m2');
  assert.equal((await status()).connections, 2);
  assert.ok((await world()).alive > 0);
  for (const session of sessions) assert.ok((await game(session)).state.totalMonsters > 0);
  passed('both players retain their sessions across a level transition to e1m2');

  for (const session of sessions) {
    await browser(session, ['select', '#mode', 'deathmatch']);
    await join(session);
  }
  statusMode = 'deathmatch';
  const deathmatch = await status();
  assert.equal(deathmatch.deathmatch, 1); assert.equal(deathmatch.coop, 0);
  assert.equal((await world()).alive, 0);
  passed('both players switch through the selector into the separate deathmatch room');

  for (let i = 0; i < 3; i++) {
    await click(sessions[0], 'Leave multiplayer');
    await waitFor(async () => (await status()).connections === 1, 'departed player slot freed');
    const remaining = await game(sessions[1]);
    assert.equal(remaining.state.signon, 4); assert.equal(remaining.network[0].open, true);
    await join(sessions[0]);
    await waitFor(async () => (await status()).connections === 2, 'reconnected player');
  }
  passed('three disconnect/reconnect cycles free sockets and preserve the other player');

  await stopServer();
  for (const session of sessions) await waitFor(async () => (await game(session)).network.every(c => !c.open), 'client detects server loss', 20000);
  startServer();
  await waitFor(async () => (await status()).serverActive, 'server restart');
  for (const session of sessions) await join(session);
  passed('both browsers recover after server shutdown and restart');

  const final = [];
  for (const [index, session] of sessions.entries()) {
    const result = await game(session); assert.deepEqual(result.errors, []);
    assert.ok(result.network[0].reliableReceived > 0 && result.network[0].datagramsReceived > 0);
    final.push(result);
    await browser(session, ['screenshot', path.join(artifactDir, `webtransport-player-${index + 1}.png`)]);
  }
  await writeFile(path.join(artifactDir, 'webtransport-e2e.json'), JSON.stringify({ date: new Date().toISOString(), checks, monsterEvidence, server: await status(), clients: final }, null, 2));
  passed('no browser errors; verification artifacts saved');
} catch (error) {
  failure = error;
  console.error(error.stack);
  await writeFile(path.join(artifactDir, 'webtransport-failure.json'), JSON.stringify({ server: await status().catch(() => null), clients: await Promise.all(sessions.map(session => game(session).catch(() => null))) }, null, 2));
} finally {
  for (const session of sessions) await browser(session, ['close']).catch(() => {});
  await stopServer();
  await writeFile(path.join(artifactDir, 'webtransport-server.log'), serverOutput);
}
if (failure) process.exitCode = 1;
