import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Tests a running public server through normal HTTPS, WebTransport and its
// compatibility fallback, without
// opening server diagnostics, changing its configuration, or bypassing TLS.
const url = process.env.QUAKE_TEST_PUBLIC_URL;
if (!url || new URL(url).protocol !== 'https:') throw new Error('Set QUAKE_TEST_PUBLIC_URL to the public HTTPS origin');
const nativeCli = path.join(path.dirname(process.execPath), 'node_modules', 'agent-browser', 'bin', 'agent-browser-win32-x64.exe');
const cli = process.env.AGENT_BROWSER_BIN || (process.platform === 'win32' && existsSync(nativeCli) ? nativeCli : 'agent-browser');
const sessions = [`quake-public-a-${process.pid}`, `quake-public-b-${process.pid}`];
const artifacts = path.resolve('web/test-artifacts');
const checks = [];
let evidence, failure;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function browser(session, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ['--session', session, '--json', ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Browser command timed out: ${args.join(' ')}`)); }, 30000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('exit', code => {
      clearTimeout(timer); child.stdout.destroy(); child.stderr.destroy();
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
async function actor(session, id) { return evaluate(session, `window.quake.world().actors.find(a=>a.id===${id})`); }
async function waitFor(fn, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    try { last = await fn(); if (last) return last; } catch (error) { last = error.message; }
    await delay(200);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}; last result: ${JSON.stringify(last)}`);
}
function passed(name) { checks.push(name); console.log(`PASS ${name}`); }
await mkdir(artifacts, { recursive: true });
try {
  assert.equal((await fetch(`${url}/healthz`)).status, 200);
  assert.equal((await fetch(`${url}/api/multiplayer/world`)).status, 404);
  const config = await (await fetch(`${url}/api/multiplayer`)).json();
  assert.equal(config.available, true); assert.equal(config.mode, 'coop'); assert.equal(config.monsters, true);
  assert.equal(config.map, 'e1m1'); assert.equal(new URL(config.url).hostname, new URL(url).hostname);
  assert.equal(new URL(config.url).protocol, 'https:'); assert.equal(config.maxPlayers, 8);
  for (const [index, session] of sessions.entries()) {
    await browser(session, ['open', url]);
    const snapshot = await browser(session, ['snapshot', '-i']);
    assert.ok(JSON.stringify(snapshot).includes('Launch Quake'));
    assert.equal(await evaluate(session, 'window.isSecureContext && typeof WebTransport === "function"'), true);
    await browser(session, ['find', 'role', 'button', 'click', '--name', 'Launch Quake']);
    await waitFor(async () => await evaluate(session, 'window.quake?.ready && window.quake.state().signon === 4'), 'single-player launch', 60000);
    await browser(session, ['press', 'Escape']);
    if (index === 1) await evaluate(session, `(() => {
      const Native = window.WebTransport;
      window.WebTransport = class {
        constructor(...args) {
          const session = new Native(...args);
          Object.defineProperty(session, 'createBidirectionalStream', { value: () => new Promise(() => {}) });
          return session;
        }
      };
      return true;
    })()`);
    await browser(session, ['snapshot', '-i']);
    await browser(session, ['find', 'role', 'button', 'click', '--name', 'Join co-op']);
    await waitFor(async () => {
      const result = await game(session);
      return result.state?.signon === 4 && !result.state.serverActive && result.state.map === 'maps/e1m1.bsp' && result.network.some(c => c.open) ? result : false;
    }, 'public multiplayer join, including a stalled native stream');
    assert.equal((await game(session)).network.find(connection => connection.open).transport, index === 1 ? 'websocket' : 'webtransport');
    assert.deepEqual((await game(session)).errors, []);
  }
  passed('native WebTransport and a hung-stream fallback join the same public co-op room with valid HTTPS');
  await command(sessions[0], 'name PublicAlpha\nsay Public WebTransport chat verified');
  await command(sessions[1], 'name PublicBeta');
  await waitFor(async () => (await game(sessions[1])).log.some(line => line.includes('Public WebTransport chat verified')), 'reliable chat');
  const firstPlayer = (await game(sessions[0])).state;
  assert.ok(firstPlayer.players.length >= 2);
  const before = firstPlayer.origin;
  const playerSlot = firstPlayer.players.reduce((closest, player) =>
    Math.hypot(...player.origin.map((n, i) => n - before[i])) < Math.hypot(...closest.origin.map((n, i) => n - before[i])) ? player : closest).slot;
  await command(sessions[0], '+forward'); await delay(500); await command(sessions[0], '-forward');
  const moved = await waitFor(async () => {
    const state = (await game(sessions[0])).state;
    return Math.hypot(...state.origin.map((n, i) => n - before[i])) > 20 ? state : false;
  }, 'server-authoritative movement');
  await waitFor(async () => {
    const peer = (await game(sessions[1])).state.players.find(p => p.slot === playerSlot);
    return peer && Math.hypot(...peer.origin.map((n, i) => n - moved.origin[i])) < 20;
  }, 'movement replicated to the other browser');
  passed('reliable chat and player movement cross the public WebTransport/WebSocket connection');
  const healthBefore = (await game(sessions[1])).state.health;
  const killsBefore = (await game(sessions[1])).state.killedMonsters;
  await command(sessions[1], 'setpos 96 608 24 0 198.435 0\nnoclip 0');
  const soldier = await waitFor(async () => {
    const actors = await evaluate(sessions[1], 'window.quake.world().actors');
    return actors.find(a => a.model === 'progs/soldier.mdl' && Math.hypot(a.origin[0], a.origin[1] - 576) < 200);
  }, 'original soldier in the first room');
  const hurt = await waitFor(async () => {
    const state = (await game(sessions[1])).state;
    return state.health < healthBefore && state.health > 0 ? state : false;
  }, 'original monster attack damages player two');
  await command(sessions[1], 'god 1');
  await command(sessions[0], 'god 1\nsetpos 160 608 24 0 180 0\nnoclip 0');
  for (const session of sessions) await waitFor(async () => (await actor(session, soldier.id))?.model === soldier.model, 'monster visible to both players');
  const ammoBefore = (await game(sessions[0])).state.ammo;
  await waitFor(async () => {
    if ((await game(sessions[0])).state.killedMonsters > killsBefore) return true;
    const target = await actor(sessions[0], soldier.id);
    const position = (await game(sessions[0])).state.origin;
    const dx = target.origin[0] - position[0], dy = target.origin[1] - position[1];
    const pitch = -Math.atan2(target.origin[2] + 16 - (position[2] + 22), Math.hypot(dx, dy)) * 180 / Math.PI;
    const yaw = Math.atan2(dy, dx) * 180 / Math.PI;
    await command(sessions[0], `setpos ${position.join(' ')} ${pitch} ${yaw} 0\nnoclip 0\n+attack`);
    return false;
  }, 'player fire kills the monster');
  await command(sessions[0], '-attack');
  assert.ok((await game(sessions[0])).state.ammo < ammoBefore);
  const replicas = await waitFor(async () => {
    const a = { state: (await game(sessions[0])).state, actor: await actor(sessions[0], soldier.id) };
    const b = { state: (await game(sessions[1])).state, actor: await actor(sessions[1], soldier.id) };
    return a.state.killedMonsters > killsBefore && a.state.killedMonsters === b.state.killedMonsters &&
      a.actor?.frame >= 8 && a.actor.frame === b.actor?.frame &&
      Math.hypot(...a.actor.origin.map((n, i) => n - b.actor.origin[i])) < 4 ? [a, b] : false;
  }, 'shared monster corpse and kill count');
  evidence = { soldier, healthBefore, healthAfter: hurt.health, replicas };
  passed('original monster attacks, player fire kills it, and both browsers share its corpse and kill count');
  for (const session of sessions) {
    assert.deepEqual((await game(session)).errors, []);
    await browser(session, ['screenshot', path.join(artifacts, `${session}.png`)]);
    await command(session, 'god 0\ndisconnect');
  }
  passed('both browsers finish without JavaScript errors and disconnect cleanly');
} catch (error) {
  failure = error;
  console.error(error.stack);
} finally {
  await writeFile(path.join(artifacts, 'production-e2e.json'), JSON.stringify({ url, checks, evidence, error: failure?.stack, finished: new Date().toISOString() }, null, 2));
  for (const session of sessions) await browser(session, ['close']).catch(() => {});
}
if (failure) process.exitCode = 1;
