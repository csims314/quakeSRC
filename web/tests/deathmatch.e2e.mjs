import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:net';

const publicUrl = process.env.QUAKE_TEST_PUBLIC_URL;
const port = 3104;
const url = publicUrl || `http://127.0.0.1:${port}`;
const nativeCli = path.join(path.dirname(process.execPath), 'node_modules/agent-browser/bin/agent-browser-win32-x64.exe');
const cli = process.env.AGENT_BROWSER_BIN || (process.platform === 'win32' && existsSync(nativeCli) ? nativeCli : 'agent-browser');
const sessions = ['a', 'b', 'coop'].map(name => `quake-dm-${name}-${process.pid}`);
const names = [`DMAlpha${process.pid}`, `DMBeta${process.pid}`];
const artifacts = path.resolve('web/test-artifacts');
let server, serverOutput = '', failure, combat;
const checks = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function browser(session, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ['--session', session, '--json', ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Browser timeout: ${args.join(' ')}`)); }, 30000);
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('exit', code => {
      clearTimeout(timer); child.stdout.destroy(); child.stderr.destroy();
      try { const result = JSON.parse(output.trim()); if (code || !result.success) throw new Error(result.error || error || output); resolve(result.data); }
      catch (problem) { reject(new Error(`${args.join(' ')}: ${problem.message}; ${error}`)); }
    });
    child.stdin.end(input);
  });
}
async function evaluate(session, code) { return (await browser(session, ['eval', '--stdin'], code)).result; }
async function command(session, text) { return evaluate(session, `window.quake.command(${JSON.stringify(text)}); true`); }
async function game(session) { return evaluate(session, '({state:window.quake?.state(),network:window.quake?.network.snapshot(),errors:window.__quakeErrors,log:window.quake?.logs})'); }
async function config(mode) { return (await fetch(`${url}/api/multiplayer?mode=${mode}`)).json(); }
async function waitFor(fn, label, timeout = 30000) {
  const deadline = Date.now() + timeout; let last;
  do { try { last = await fn(); if (last) return last; } catch (error) { last = error.message; } await delay(180); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}; last result: ${JSON.stringify(last)}`);
}
async function joined(session) {
  return waitFor(async () => { const g = await game(session); return g.state?.signon === 4 && !g.state.serverActive && g.state.map === 'maps/e1m1.bsp' && g.network.some(c => c.open) ? g : false; }, 'joining the selected room');
}
async function selectRoom(session, mode) {
  await browser(session, ['press', 'Escape']);
  await browser(session, ['snapshot', '-i']);
  await browser(session, ['select', '#mode', mode]);
  assert.equal(await evaluate(session, "document.getElementById('mode').value"), mode);
  await browser(session, ['snapshot', '-i']);
  await browser(session, ['find', 'role', 'button', 'click', '--name', mode === 'coop' ? 'Join co-op' : 'Join deathmatch']);
  await joined(session);
}
async function leave(session) {
  await browser(session, ['press', 'Escape']);
  await browser(session, ['find', 'role', 'button', 'click', '--name', 'Leave multiplayer']);
  await waitFor(async () => (await game(session)).state.serverActive, 'returning to single player');
}
function passed(label) { checks.push(label); console.log(`PASS ${label}`); }

// Read original BSP geometry only to find two normal spawn positions with a
// clear shot. The test never teleports players, edits entities, or enables cheats.
async function mapVisibility() {
  const pak = Buffer.from(await (await fetch(`${url}/assets/pak0.pak`)).arrayBuffer());
  let map;
  for (let i = pak.readUInt32LE(4); i < pak.readUInt32LE(4) + pak.readUInt32LE(8); i += 64) {
    if (pak.subarray(i, i + 56).toString().split('\0')[0] === 'maps/e1m1.bsp') map = pak.subarray(pak.readUInt32LE(i + 56), pak.readUInt32LE(i + 56) + pak.readUInt32LE(i + 60));
  }
  assert.ok(map); assert.equal(map.readInt32LE(0), 29);
  const lump = n => map.subarray(map.readUInt32LE(4 + n * 8), map.readUInt32LE(4 + n * 8) + map.readUInt32LE(8 + n * 8));
  const planes = lump(1), nodes = lump(5), leaves = lump(10), models = lump(14);
  function solid(point) {
    let node = models.readInt32LE(36);
    while (node >= 0) {
      const offset = node * 24, plane = nodes.readInt32LE(offset) * 20;
      const distance = point.reduce((sum, value, axis) => sum + value * planes.readFloatLE(plane + axis * 4), 0) - planes.readFloatLE(plane + 12);
      node = nodes.readInt16LE(offset + (distance >= 0 ? 4 : 6));
    }
    return leaves.readInt32LE((-1 - node) * 28) === -2;
  }
  return (a, b) => {
    const start = [a[0], a[1], a[2] + 22], end = [b[0], b[1], b[2] + 16];
    const count = Math.ceil(Math.hypot(...end.map((n, i) => n - start[i])) / 4);
    for (let step = 0; step <= count; step++) if (solid(start.map((n, i) => n + (end[i] - n) * step / count))) return false;
    return true;
  };
}
const wrap = value => ((value + 180) % 360 + 360) % 360 - 180;
async function aim(session, target) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const state = (await game(session)).state;
    const dx = target[0] - state.origin[0], dy = target[1] - state.origin[1];
    const desired = [-Math.atan2(target[2] + 16 - (state.origin[2] + 22), Math.hypot(dx, dy)) * 180 / Math.PI, Math.atan2(dy, dx) * 180 / Math.PI];
    const pitch = desired[0] - state.angles[0], yaw = wrap(desired[1] - state.angles[1]);
    if (Math.abs(pitch) < 1.5 && Math.abs(yaw) < 1.5) return;
    // Ordinary client look controls, timed inside the page to avoid CLI latency.
    const speed = attempt < 2 ? 180 : 30;
    const turn = Math.abs(yaw) >= 1.5 ? (yaw > 0 ? 'left' : 'right') : null;
    const look = Math.abs(pitch) >= 1.5 ? (pitch > 0 ? 'lookdown' : 'lookup') : null;
    const controls = [`cl_alwaysrun 0`, `cl_yawspeed ${speed}`, `cl_pitchspeed ${speed}`, turn && `+${turn}`, look && `+${look}`].filter(Boolean).join('\n');
    await evaluate(session, `window.quake.command(${JSON.stringify(controls)});
      ${turn ? `setTimeout(()=>window.quake.command('-${turn}'), ${Math.abs(yaw) / speed * 1000});` : ''}
      ${look ? `setTimeout(()=>window.quake.command('-${look}'), ${Math.abs(pitch) / speed * 1000});` : ''} true`);
    await delay(Math.max(Math.abs(yaw), Math.abs(pitch)) / speed * 1000 + 120);
  }
  throw new Error('Could not aim at the other player using ordinary look controls');
}
await mkdir(artifacts, { recursive: true });
try {
  if (!publicUrl) {
    await new Promise((resolve, reject) => { const probe = createServer(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => probe.close(resolve)); });
    server = spawn(process.execPath, ['web/server.mjs'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env,
      QUAKE_WEB_PORT: String(port), QUAKE_MULTIPLAYER_PORT: '4446', QUAKE_MULTIPLAYER_MODE: 'coop', QUAKE_SERVER_CONSOLE: '1' } });
    server.stdout.on('data', data => { serverOutput += data; }); server.stderr.on('data', data => { serverOutput += data; });
  }
  await waitFor(async () => (await fetch(`${url}/healthz`)).ok, 'both rooms healthy');
  const coop = await config('coop'), dm = await config('deathmatch');
  assert.equal(coop.monsters, true); assert.equal(dm.monsters, false); assert.equal(dm.mode, 'deathmatch');
  assert.equal(dm.fragLimit, 20); assert.equal(dm.timeLimit, 10); assert.equal(dm.maxPlayers, 8);
  assert.notEqual(coop.url, dm.url); assert.equal(new URL(coop.url).port, new URL(dm.url).port);
  assert.equal((await fetch(`${url}/api/multiplayer?mode=invalid`)).status, 400);
  for (const [index, session] of sessions.entries()) {
    await browser(session, ['open', `${url}/?mode=${index === 2 ? 'coop' : 'deathmatch'}`]);
    await browser(session, ['snapshot', '-i']);
    await browser(session, ['find', 'role', 'button', 'click', '--name', 'Launch Quake']);
    await waitFor(async () => await evaluate(session, 'window.quake?.ready && window.quake.state().signon===4'), 'single-player launch', 60000);
    await browser(session, ['press', 'Escape']);
    await selectRoom(session, index === 2 ? 'coop' : 'deathmatch');
    if (index < 2) { await command(session, `name ${names[index]}`); assert.equal((await game(session)).state.totalMonsters, 0); }
  }
  assert.ok((await game(sessions[2])).state.totalMonsters > 0);
  if (!publicUrl) {
    const state = await (await fetch(`${url}/api/multiplayer/world?mode=deathmatch`)).json(); assert.equal(state.alive, 0);
  }
  passed('two browsers join deathmatch while a third plays co-op with its original monsters');
  const chat = `Deathmatch chat ${process.pid}`;
  await command(sessions[0], `say ${chat}`);
  await waitFor(async () => (await game(sessions[1])).log.some(line => line.includes(chat)), 'deathmatch chat');
  assert.ok(!(await game(sessions[2])).log.some(line => line.includes(chat)));
  passed('chat stays in its room');

  const visible = await mapVisibility(); let positions;
  for (let attempt = 0; attempt < 24; attempt++) {
    const a = (await game(sessions[0])).state, b = (await game(sessions[1])).state;
    console.log('SPAWNS', a.origin, b.origin, visible(a.origin, b.origin));
    if (Math.hypot(...a.origin.map((n, i) => n - b.origin[i])) < 600 && visible(a.origin, b.origin)) { positions = [a.origin, b.origin]; break; }
    await leave(sessions[1]); await selectRoom(sessions[1], 'deathmatch'); await command(sessions[1], `name ${names[1]}`);
    if (attempt % 4 === 3) { await leave(sessions[0]); await selectRoom(sessions[0], 'deathmatch'); await command(sessions[0], `name ${names[0]}`); }
  }
  assert.ok(positions, 'normal deathmatch spawn points provide a clear shot');
  const victimBefore = (await game(sessions[1])).state.health;
  await command(sessions[1], 'god 1\ngive h 999\nsetpos 0 0 0');
  await delay(200);
  assert.equal((await game(sessions[1])).state.health, victimBefore);
  assert.ok(Math.hypot(...(await game(sessions[1])).state.origin.map((n, i) => n - positions[1][i])) < 2);
  const fragsBefore = (await game(sessions[0])).state.players.find(player => player.name === names[0]).frags;
  const ammoBefore = (await game(sessions[0])).state.ammo;
  let damage;
  await waitFor(async () => {
    const victim = (await game(sessions[1])).state;
    if (victim.health < victimBefore) damage ||= victim;
    if (victim.health <= 0) return victim;
    await aim(sessions[0], victim.origin);
    await command(sessions[0], '+attack'); await delay(600); await command(sessions[0], '-attack');
    return false;
  }, 'player weapon damages and kills another player with cheats rejected', 60000);
  assert.ok(damage); assert.ok((await game(sessions[0])).state.ammo < ammoBefore);
  const scores = [];
  for (const session of sessions.slice(0, 2)) scores.push(await waitFor(async () => {
    const state = (await game(session)).state;
    return state.players.find(player => player.name === names[0])?.frags === fragsBefore + 1 ? state : false;
  }, 'frag score replicated to both players'));
  await delay(1800); await command(sessions[1], '+attack'); await delay(150); await command(sessions[1], '-attack');
  const respawn = await waitFor(async () => { const state = (await game(sessions[1])).state; return state.health === 100 && state.signon === 4 ? state : false; }, 'victim respawns by pressing fire');
  combat = { positions, victimBefore, damagedHealth: damage.health, scores, respawn };
  await command(sessions[0], '+showscores');
  await browser(sessions[0], ['screenshot', path.join(artifacts, `deathmatch-scoreboard-${publicUrl ? 'public' : 'local'}.png`)]);
  await command(sessions[0], '-showscores');
  passed('real PvP damage, death, replicated frag scores, scoreboard and fire-to-respawn work without cheats');

  if (!publicUrl) {
    server.stdin.write('deathmatch: fraglimit 1\n');
    for (const session of sessions.slice(0, 2)) await waitFor(async () => (await game(session)).state.intermission === 1, 'frag limit ends the round');
    await delay(5200); await command(sessions[0], '+attack'); await delay(180); await command(sessions[0], '-attack');
    for (const session of sessions.slice(0, 2)) await waitFor(async () => { const state = (await game(session)).state; return state.signon === 4 && state.intermission === 0 && state.players.find(player => player.name === names[0])?.frags === 0; }, 'new round resets scores and preserves connections');
    server.stdin.write('deathmatch: timelimit 0.001\n');
    for (const session of sessions.slice(0, 2)) await waitFor(async () => (await game(session)).state.intermission === 1, 'time limit ends the round');
    server.stdin.write('deathmatch: fraglimit 20\ndeathmatch: timelimit 10\n');
    await delay(5200); await command(sessions[0], '+attack'); await delay(180); await command(sessions[0], '-attack');
    for (const session of sessions.slice(0, 2)) await waitFor(async () => (await game(session)).state.signon === 4 && (await game(session)).state.intermission === 0, 'restart after time limit');
    passed('frag limit and time limit trigger original intermission, followed by a fresh round with scores reset');
  }
  await selectRoom(sessions[0], 'coop');
  assert.ok((await game(sessions[0])).state.totalMonsters > 0);
  assert.equal((await game(sessions[1])).state.totalMonsters, 0); assert.equal((await game(sessions[1])).state.signon, 4);
  assert.ok((await game(sessions[2])).state.totalMonsters > 0);
  await selectRoom(sessions[0], 'deathmatch');
  assert.equal((await game(sessions[0])).state.totalMonsters, 0);
  assert.ok((await game(sessions[2])).state.totalMonsters > 0);
  passed('switching rooms preserves players in both games');
  for (const session of sessions) { assert.deepEqual((await game(session)).errors, []); await command(session, 'disconnect'); }
  passed('all three clients finish without JavaScript errors');
} catch (error) { failure = error; console.error(error.stack); }
finally {
  await writeFile(path.join(artifacts, `deathmatch-${publicUrl ? 'public' : 'local'}.json`), JSON.stringify({ url, checks, combat, error: failure?.stack, date: new Date().toISOString() }, null, 2));
  for (const session of sessions) await browser(session, ['close']).catch(() => {});
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  if (server) await writeFile(path.join(artifacts, 'deathmatch-server.log'), serverOutput);
}
if (failure) process.exitCode = 1;
