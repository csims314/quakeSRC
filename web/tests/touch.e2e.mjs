// Phone-style end-to-end check: real multi-touch input through Chrome's
// DevTools protocol, the player's own music files, and the public status page.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as portProbe } from 'node:net';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.QUAKE_TEST_WEB_PORT || 3106);
const quicPort = Number(process.env.QUAKE_TEST_MULTIPLAYER_PORT || 4448);
const url = process.env.QUAKE_TEST_PUBLIC_URL || `http://127.0.0.1:${port}`;
const nativeCli = path.join(path.dirname(process.execPath), 'node_modules', 'agent-browser', 'bin', 'agent-browser-win32-x64.exe');
const cli = process.env.AGENT_BROWSER_BIN || (process.platform === 'win32' && existsSync(nativeCli) ? nativeCli : 'agent-browser');
const artifactDir = path.join(project, 'web/test-artifacts');
const session = `quake-touch-test-${process.pid}`;
const checks = [];
let server, serverOutput = '', failure, devtools, musicDir;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(fn, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    try { last = await fn(); if (last) return last; } catch (error) { last = error.message; }
    await delay(150);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}; last result: ${JSON.stringify(last)}`);
}
function browser(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ['--session', session, '--json', ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '', error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Browser command timed out: ${args.join(' ')}`)); }, 30000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    // On Windows a newly started daemon can inherit the CLI's output pipe.
    child.on('exit', code => {
      clearTimeout(timer);
      child.stdout.destroy(); child.stderr.destroy();
      try {
        const result = JSON.parse(output.trim());
        if (code || !result.success) throw new Error(result.error || error || output);
        resolve(result.data);
      } catch (problem) { reject(new Error(`${args.join(' ')}: ${problem.message}; ${error}`)); }
    });
    child.stdin.end();
  });
}

// A small DevTools protocol client for touch emulation and touch input.
async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('DevTools connection failed')); });
  let next = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  return { send, close: () => socket.close() };
}
async function attach(targetId) {
  const { sessionId } = await devtools.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => devtools.send(method, params, sessionId);
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  return { send, evaluate };
}
const touch = (page, type, points) => page.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
async function box(page, selector) {
  return page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height }; })()`);
}
async function tap(page, selector, hold = 80) {
  const { x, y } = await box(page, selector);
  await touch(page, 'touchStart', [[x, y]]);
  await delay(hold);
  await touch(page, 'touchEnd', []);
}
async function drag(page, from, to, hold = 0, steps = 8) {
  await touch(page, 'touchStart', [from]);
  for (let i = 1; i <= steps; i++) {
    await touch(page, 'touchMove', [[from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps]]);
    await delay(16);
  }
  await delay(hold);
  await touch(page, 'touchEnd', []);
}
async function screenshot(page, name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(artifactDir, name), Buffer.from(data, 'base64'));
}
const game = page => page.evaluate('window.quake?.ready ? window.quake.state() : null');
const distance = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]));
const mobileAPIs = `
  Object.defineProperty(HTMLCanvasElement.prototype, 'requestPointerLock', { configurable: true, writable: true, value: undefined });
  Object.defineProperty(document, 'exitPointerLock', { configurable: true, writable: true, value: undefined });
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, writable: true, value: undefined });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, writable: true, value: undefined });
`;

// One-second PCM WAV tone, so the test needs no audio encoder.
function wav(frequency) {
  const rate = 22050, samples = rate, data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * i / rate) * 8000), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function passed(name) { checks.push(name); console.log(`PASS ${name}`); }

await mkdir(artifactDir, { recursive: true });
try {
  if (!process.env.QUAKE_TEST_PUBLIC_URL) {
  await new Promise((resolve, reject) => {
    const probe = portProbe();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  server = spawn(process.execPath, ['web/server.mjs'], {
    cwd: project, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, QUAKE_WEB_PORT: String(port), QUAKE_MULTIPLAYER_PORT: String(quicPort), QUAKE_MULTIPLAYER_MODE: 'coop', QUAKE_MULTIPLAYER_MAP: 'e1m1' },
  });
  server.stdout.on('data', chunk => { serverOutput += chunk; });
  server.stderr.on('data', chunk => { serverOutput += chunk; });
  }
  await waitFor(async () => (await fetch(`${url}/healthz`)).ok, 'server startup');

  await browser(['open', 'about:blank']);
  devtools = await connect((await browser(['get', 'cdp-url'])).cdpUrl);
  const { targetInfos } = await devtools.send('Target.getTargets');
  const page = await attach(targetInfos.find(target => target.type === 'page').targetId);
  // The browser can hold another tab; a background tab is hidden, never renders and never takes touch input.
  await page.send('Page.bringToFront');
  await page.send('Page.enable');
  // A landscape phone: touch only, no mouse.
  await page.send('Emulation.setDeviceMetricsOverride', { width: 915, height: 412, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // Desktop touch emulation retains APIs that actual mobile browsers can lack.
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: mobileAPIs });
  await page.send('Page.navigate', { url });
  await waitFor(() => page.evaluate("document.readyState === 'complete' && (window.__quakeErrors?.length || document.getElementById('music-status').textContent !== 'checking…')"), 'page load');
  assert.equal(await page.evaluate("typeof document.exitPointerLock"), 'undefined');
  assert.deepEqual(await page.evaluate('window.__quakeErrors'), [], 'mobile startup must not require mouse capture or native fullscreen');

  const tracks = await page.evaluate("[...document.querySelectorAll('#music-status')].map(e => e.textContent)[0]");
  musicDir = await mkdtemp(path.join(tmpdir(), 'quake-touch-music-'));
  const files = [];
  for (let track = 2; track <= 11; track++) {
    const file = path.join(musicDir, `track${String(track).padStart(2, '0')}.wav`);
    await writeFile(file, wav(200 + track * 40));
    files.push(file);
  }
  await writeFile(path.join(musicDir, 'Quake Theme.wav'), wav(100));
  const { root } = await page.send('DOM.getDocument');
  const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#music-files' });
  await page.send('DOM.setFileInputFiles', { nodeId, files: [...files, path.join(musicDir, 'Quake Theme.wav')] });
  await waitFor(async () => { const text = await page.evaluate("document.getElementById('loading').textContent"); if (!text.includes('Added 10 tracks')) throw new Error(text || 'no note yet'); return true; }, 'music files added, shown on the start screen');
  const note = await page.evaluate("document.getElementById('music-note').textContent");
  assert.match(note, /Skipped Quake Theme\.wav \(name it like track02\.ogg\)/);
  assert.match(await page.evaluate("document.getElementById('music-status').textContent"), /^10 of your tracks/);
  passed(`player music files are stored in this browser (before: ${tracks})`);

  assert.equal(await page.evaluate("document.getElementById('touch-toggle').getAttribute('aria-pressed')"), 'true');
  passed('a touch-only device turns touch controls on');

  await page.evaluate("document.getElementById('stage').scrollIntoView({ block: 'end' })");
  await screenshot(page, 'touch-cover.png');
  await tap(page, '#start');
  await waitFor(async () => (await game(page))?.signon === 4, 'single-player start map', 60000);
  assert.equal(await page.evaluate("document.getElementById('capture').hidden"), true);
  assert.equal(await page.evaluate("document.querySelector('.touch').hidden"), false);
  passed('Launch Quake by touch starts without the mouse-capture prompt');
  await page.evaluate('window.scrollTo(0, 0)');
  await tap(page, '#fullscreen');
  await waitFor(() => page.evaluate("document.getElementById('stage').classList.contains('expanded') && !document.getElementById('view-exit').hidden"), 'fullscreen fallback');
  assert.equal(await page.evaluate("Math.round(document.getElementById('stage').getBoundingClientRect().height)"), 412);
  passed('mobile gameplay fills the viewport without the native Fullscreen API');

  const music = await waitFor(async () => {
    const state = await page.evaluate('window.quake.music.state()');
    return state.current && !state.paused && state.time > 0.2 ? state : false;
  }, 'start map music playing');
  assert.equal(music.source, 'yours'); assert.match(music.current, /^track\d\d$/);
  await page.evaluate("window.quake.command('pause'); true");
  await waitFor(async () => (await page.evaluate('window.quake.music.state()')).paused, 'music pauses with the game');
  await page.evaluate("window.quake.command('pause'); true");
  await waitFor(async () => !(await page.evaluate('window.quake.music.state()')).paused, 'music resumes with the game');
  await page.evaluate("window.quake.command('bgmvolume 0.25'); true");
  await waitFor(async () => (await page.evaluate('window.quake.music.state()')).volume === 0.25, 'music volume follows the game setting');
  passed(`engine-requested ${music.current} streams from the player's file and follows pause and volume`);

  await page.evaluate("document.getElementById('stage').scrollIntoView({ block: 'end' })");
  const stage = await box(page, '#stage');
  const left = [stage.x - stage.width * 0.3, stage.y + stage.height * 0.15];
  const right = [stage.x + stage.width * 0.05, stage.y - stage.height * 0.2];
  let before = await game(page);
  await drag(page, left, [left[0], left[1] - 80], 900);
  let after = await waitFor(async () => { const state = await game(page); return distance(state.origin, before.origin) > 64 ? state : false; }, 'touch stick moves the player');
  passed(`left-side stick moves the player ${Math.round(distance(after.origin, before.origin))} units`);

  before = after;
  await drag(page, right, [right[0] + 150, right[1] + 40]);
  after = await waitFor(async () => { const state = await game(page); return Math.abs(state.angles[1] - before.angles[1]) > 20 ? state : false; }, 'right-side drag turns the view');
  assert.ok(after.angles[0] > before.angles[0], 'dragging down looks down');
  passed(`right-side drag turns ${Math.round(Math.abs(after.angles[1] - before.angles[1]))}° and pitches the view`);

  // Two thumbs at once: run with the stick while turning on the right.
  before = await game(page);
  await touch(page, 'touchStart', [left, right]);
  for (let i = 1; i <= 10; i++) {
    await touch(page, 'touchMove', [[left[0] + 60, left[1] - 60], [right[0] - i * 12, right[1]]]);
    await delay(60);
  }
  await delay(400);
  await touch(page, 'touchEnd', []);
  after = await game(page);
  assert.ok(distance(after.origin, before.origin) > 40 && Math.abs(after.angles[1] - before.angles[1]) > 15, 'stick and look work together');
  passed('two-thumb input moves and turns at the same time');

  const ammo = (await game(page)).ammo;
  await tap(page, '.touch-fire', 700);
  await waitFor(async () => (await game(page)).ammo < ammo, 'Fire button shoots');
  passed('Fire button fires the current weapon');

  await tap(page, '.touch-top [data-key=escape]');
  await waitFor(async () => (await game(page)).keyDest === 'menu' && await page.evaluate("document.querySelector('.touch').dataset.mode === 'menu'"), 'Menu opens the game menu');
  assert.ok(await page.evaluate("getComputedStyle(document.querySelector('.touch-menu')).display !== 'none' && getComputedStyle(document.querySelector('.touch-actions')).display === 'none'"));
  await screenshot(page, 'touch-menu.png');
  await tap(page, '.touch-menu [data-key=down]');
  await tap(page, '.touch-menu [data-key=escape]');
  await waitFor(async () => (await game(page)).keyDest === 'game' && await page.evaluate("document.querySelector('.touch').dataset.mode === 'game'"), 'Back closes the menu');
  passed('Menu button and arrow pad drive the original menus');
  await screenshot(page, 'touch-controls.png');
  await tap(page, '#view-exit');
  assert.equal(await page.evaluate("document.getElementById('stage').classList.contains('expanded')"), false);

  await page.evaluate("window.quake.command('name Thumbs'); true");
  await page.evaluate("window.scrollTo(0, 0)");
  await tap(page, '#join');
  await waitFor(async () => { const state = await game(page); return state?.signon === 4 && !state.serverActive && state.map === 'maps/e1m1.bsp'; }, 'joining co-op by touch');
  const status = await waitFor(async () => {
    const result = await (await fetch(`${url}/api/status`)).json();
    return result.rooms.find(room => room.id === 'coop')?.players.some(player => player.name === 'Thumbs') ? result : false;
  }, 'player listed in public status');
  const listed = status.rooms.find(room => room.id === 'coop').players.find(player => player.name === 'Thumbs');
  assert.equal(listed.name, 'Thumbs');
  assert.ok(Number.isInteger(listed.ping) && listed.seconds >= 0);
  assert.deepEqual(Object.keys(listed).sort(), ['frags', 'name', 'ping', 'seconds']);
  passed('public status lists the player by name with ping and time online');

  const { targetId } = await devtools.send('Target.createTarget', { url: `${url}/status` });
  const statusPage = await attach(targetId);
  const row = await waitFor(() => statusPage.evaluate("[...document.querySelectorAll('.room tbody tr')].map(row => row.innerText).join('\\n')"), 'status page row');
  assert.match(row, /Thumbs/);
  assert.match(await statusPage.evaluate("document.getElementById('summary').textContent"), /^\d+ players? online/);
  await screenshot(statusPage, 'status-page.png');
  passed('status page shows who is playing');

  assert.deepEqual(await page.evaluate('window.__quakeErrors'), []);
  const { targetId: olderPhoneId } = await devtools.send('Target.createTarget', { url: 'about:blank' });
  const olderPhone = await attach(olderPhoneId);
  await olderPhone.send('Page.enable');
  await olderPhone.send('Page.bringToFront');
  await olderPhone.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await olderPhone.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await olderPhone.send('Page.addScriptToEvaluateOnNewDocument', { source: `${mobileAPIs}\nObject.defineProperty(window, 'WebTransport', { configurable: true, value: undefined });` });
  await olderPhone.send('Page.navigate', { url });
  await waitFor(() => olderPhone.evaluate("document.readyState === 'complete' && document.getElementById('music-status').textContent !== 'checking…'"), 'older phone launcher');
  await olderPhone.evaluate("document.getElementById('start').scrollIntoView({block:'center'})");
  await tap(olderPhone, '#start');
  await waitFor(async () => (await game(olderPhone))?.signon === 4, 'single player without WebTransport', 60000);
  assert.equal(await olderPhone.evaluate("document.getElementById('join').disabled"), true);
  assert.match(await olderPhone.evaluate("document.getElementById('network-status').textContent"), /Single player is available/);
  await olderPhone.evaluate('window.scrollTo(0, 0)');
  await tap(olderPhone, '#fullscreen');
  await waitFor(() => olderPhone.evaluate("document.getElementById('stage').classList.contains('expanded')"), 'portrait fullscreen fallback');
  await screenshot(olderPhone, 'touch-portrait.png');
  assert.equal(await olderPhone.evaluate("Math.round(document.getElementById('stage').getBoundingClientRect().height)"), 844);
  assert.deepEqual(await olderPhone.evaluate('window.__quakeErrors'), []);
  passed('portrait phones can launch single player when WebTransport is unavailable');
  passed('no browser errors');
} catch (error) {
  failure = error;
  console.error(error.stack);
} finally {
  devtools?.close();
  await browser(['close']).catch(() => {});
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  if (musicDir) await rm(musicDir, { recursive: true, force: true });
  await writeFile(path.join(artifactDir, 'touch-server.log'), serverOutput);
}
if (failure) process.exitCode = 1;
