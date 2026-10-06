import { createQuakeTransport, connectQuake } from './network.js';

const $ = id => document.getElementById(id);
const canvas = $('canvas');
const logs = [];
let engine, starting = false, ready = false, pausedByToolbar = false;
let pendingRestore;
let syncTimer;
let joining = false;
function showServerInfo(config) {
  if (!config.available) {
    $('multiplayer-summary').textContent = 'Local multiplayer server unavailable';
    return;
  }
  const coop = config.mode === 'coop';
  $('join').textContent = coop ? 'Join co-op' : 'Join deathmatch';
  const difficulty = ['Easy', 'Normal', 'Hard', 'Nightmare'][config.skill];
  $('multiplayer-summary').textContent = [
    coop ? 'Co-op' : 'Deathmatch',
    config.monsters ? 'Original monsters' : 'No monsters',
    difficulty,
    `Up to ${config.maxPlayers} players`,
  ].filter(Boolean).join(' · ');
}
fetch('/api/multiplayer').then(response => response.json()).then(showServerInfo)
  .catch(() => { $('multiplayer-summary').textContent = 'Local multiplayer server unavailable'; });
const transport = createQuakeTransport(event => {
  if (event.state === 'closed' && transport.snapshot().some(connection => connection.open)) return;
  $('network-status').textContent = event.state === 'ready' ? 'WebTransport connected. Joining the game…' : `Disconnected: ${event.reason}`;
  if (event.state === 'closed') {
    $('join').disabled = !ready || joining;
    $('leave').hidden = true;
  }
});
window.__quakeErrors = [];
window.addEventListener('error', event => window.__quakeErrors.push(event.message));
window.addEventListener('unhandledrejection', event => window.__quakeErrors.push(String(event.reason)));

function log(line) {
  console.log(line);
  logs.push(String(line));
  if (logs.length > 500) logs.shift();
  $('log').textContent = logs.join('\n');
  if (String(line).includes('Quake Initialized')) {
    ready = true;
    window.setTimeout(() => {
      command('stopdemo\nmap start');
      $('status').textContent = 'Running';
      $('cover').hidden = true;
      $('capture').hidden = Boolean(document.pointerLockElement);
      for (const id of ['pause', 'backup', 'send-command']) $(id).disabled = false;
      $('join').disabled = false;
    }, 0);
  }
}

function reportError(error) {
  const message = error?.message || String(error);
  log(message);
  $('status').textContent = 'Could not start';
  $('loading').textContent = message;
  $('cover').hidden = false;
  $('start').disabled = true;
  $('start').textContent = 'Reload to try again';
  window.__quakeErrors.push(message);
}

function command(text) {
  if (!engine || !ready) return;
  engine.ccall('Web_Command', null, ['string'], [text]);
}

function sync(populate = false) {
  return new Promise((resolve, reject) => engine.FS.syncfs(populate, error => error ? reject(error) : resolve()));
}

async function getAsset(name, required = true) {
  const response = await fetch(`/assets/${name}`);
  if (response.status === 204 && !required) return null;
  if (!response.ok) {
    if (required) throw new Error(`Missing ${name}. Put your game data in runtime/id1, or select your PAK files.`);
    return null;
  }
  return new Uint8Array(await response.arrayBuffer());
}

function validatePak(data, name) {
  if (data.byteLength < 12 || String.fromCharCode(...data.subarray(0, 4)) !== 'PACK') throw new Error(`${name} is not a Quake PAK file.`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const offset = view.getUint32(4, true), length = view.getUint32(8, true);
  if (offset < 12 || offset + length > data.length || length % 64) throw new Error(`${name} has an invalid PAK directory.`);
}

async function applyRestore(file) {
  if (!file) return;
  if (!engine) { pendingRestore = file; $('loading').textContent = `Will import ${file.name} when Quake starts.`; return; }
  const entries = file.name.toLowerCase().endsWith('.sav')
    ? [{ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }]
    : JSON.parse(await file.text()).files;
  if (!Array.isArray(entries)) throw new Error('This is not a Quake save backup.');
  for (const item of entries) {
    if (!/^[a-zA-Z0-9_-]+\.(sav|cfg)$/.test(item.name)) throw new Error('Backup contains an unsupported filename.');
    const data = typeof item.data === 'string' ? Uint8Array.from(atob(item.data), char => char.charCodeAt(0)) : item.data;
    if (data.byteLength > 16 * 1024 * 1024) throw new Error('Save file is too large.');
    engine.FS.writeFile(`/user/id1/${item.name}`, data);
  }
  await sync();
  $('save-status').textContent = `IMPORTED ${entries.length} FILE(S)`;
}

async function start() {
  if (starting) return;
  starting = true;
  $('start').disabled = true;
  $('paks').disabled = true;
  $('start').textContent = 'Loading…';
  $('loading').textContent = 'Loading the engine and game data…';
  try {
    if (typeof createQuakeSpasm !== 'function') throw new Error('Browser engine is missing. Run build-web.cmd first.');
    engine = await createQuakeSpasm({
      canvas, noInitialRun: true, quakeTransport: transport,
      locateFile: name => `engine/${name}`,
      print: log, printErr: log,
      onAbort: reportError,
      onExit: code => { $('status').textContent = code ? 'Stopped' : 'Game closed'; $('cover').hidden = false; $('loading').textContent = 'Reload this page to launch again.'; },
      setStatus: text => { if (text) $('loading').textContent = text; },
    });
    window.quake = {
      command,
      state: () => JSON.parse(engine.ccall('Web_State', 'string', [], [])),
      world: () => JSON.parse(engine.ccall('Web_WorldState', 'string', [], [])),
      fs: engine.FS,
      sync,
      logs,
      network: transport,
      get ready() { return ready; },
    };
    engine.FS.mkdir('/quake');
    engine.FS.mkdir('/quake/id1');
    engine.FS.mkdir('/user');
    engine.FS.mount(engine.IDBFS, { autoPersist: true }, '/user');
    await sync(true);
    engine.FS.mkdirTree('/user/id1');
    const selected = [...$('paks').files];
    const data = new Map();
    for (const file of selected) {
      const name = file.name.toLowerCase();
      if (!['pak0.pak', 'pak1.pak'].includes(name)) throw new Error('Select files named pak0.pak and optionally pak1.pak.');
      if (data.has(name)) throw new Error(`Duplicate ${name}.`);
      data.set(name, new Uint8Array(await file.arrayBuffer()));
    }
    if (selected.length && !data.has('pak0.pak')) throw new Error('Select pak0.pak along with pak1.pak.');
    if (!selected.length) {
      data.set('pak0.pak', await getAsset('pak0.pak'));
      const pak1 = await getAsset('pak1.pak', false);
      if (pak1) data.set('pak1.pak', pak1);
    }
    for (const [name, bytes] of data) {
      validatePak(bytes, name);
      engine.FS.writeFile(`/quake/id1/${name}`, bytes);
    }
    const extras = await getAsset('quakespasm.pak');
    engine.FS.writeFile('/quake/quakespasm.pak', extras);
    // Use original gameplay; only supply desktop browser-friendly input defaults.
    if (!engine.FS.analyzePath('/user/id1/config.cfg').exists) {
      engine.FS.writeFile('/user/id1/config.cfg', 'bind w +forward\nbind s +back\nbind a +moveleft\nbind d +moveright\nbind SPACE +jump\nbind MOUSE1 +attack\n+mlook\n');
    }
    if (pendingRestore) { await applyRestore(pendingRestore); pendingRestore = null; }
    $('loading').textContent = 'Starting Quake…';
    const args = ['-basedir', '/quake', '-userdir', '/user', '-heapsize', '196608', '-window', '-width', '1280', '-height', '720', '-noipx', '-nopackedpixels'];
    const result = engine.callMain(args);
    if (result?.catch) result.catch(reportError);
    syncTimer = window.setInterval(() => {
      command('web_writeconfig');
      sync().catch(error => { $('save-status').textContent = 'SAVE SYNC FAILED — EXPORT A BACKUP'; log(error); });
    }, 10000);
    navigator.storage?.persist?.().catch(() => {});
  } catch (error) { reportError(error); }
}

async function capture() {
  if (!ready) return;
  canvas.focus();
  if (pausedByToolbar) { command('pause'); pausedByToolbar = false; $('pause').textContent = 'Pause'; }
  try {
    if (document.pointerLockElement !== canvas) await canvas.requestPointerLock();
  } catch (error) { log(`Mouse capture: ${error.message}`); }
}

$('start').addEventListener('click', start);
$('join').addEventListener('click', async () => {
  if (joining || !ready) return;
  joining = true; $('join').disabled = true;
  $('network-status').textContent = 'Connecting to multiplayer…';
  document.exitPointerLock();
  try {
    const response = await fetch('/api/multiplayer');
    const config = await response.json();
    showServerInfo(config);
    const entered = $('server-url').value.trim();
    if (!entered && !config.available) throw new Error(config.error || 'The local multiplayer server is unavailable.');
    const target = entered ? { url: entered } : config;
    if (entered && config.url && new URL(entered).href === new URL(config.url).href) target.certificateHash = config.certificateHash;
    await connectQuake(transport, target);
    command('stopdemo\nconnect webtransport');
    $('leave').hidden = false;
    $('network-status').textContent = `Connected to ${target.url}. Click the game to play.`;
    $('save-status').textContent = entered ? 'MULTIPLAYER' : config.mode === 'coop' ? 'CO-OP / ORIGINAL MONSTERS' : 'DEATHMATCH';
  } catch (error) {
    $('network-status').textContent = error.message;
    log(error.message); $('join').disabled = false;
  } finally { joining = false; }
});
$('leave').addEventListener('click', () => {
  command('disconnect\nmap start');
  $('join').disabled = false; $('leave').hidden = true;
  $('network-status').textContent = 'Returned to single player.';
  $('save-status').textContent = 'LOCAL SINGLE PLAYER';
});
$('resume').addEventListener('click', capture);
canvas.addEventListener('click', capture);
canvas.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('pointerlockchange', () => { if (ready) $('capture').hidden = document.pointerLockElement === canvas; });
$('pause').addEventListener('click', () => {
  command('pause'); pausedByToolbar = !pausedByToolbar;
  $('pause').textContent = pausedByToolbar ? 'Resume' : 'Pause';
  if (pausedByToolbar) document.exitPointerLock();
});
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('stage').requestFullscreen();
    if (ready) await capture();
  } catch (error) { log(`Fullscreen: ${error.message}`); }
});
$('details-toggle').addEventListener('click', () => {
  $('details').hidden = !$('details').hidden;
  $('details-toggle').setAttribute('aria-expanded', String(!$('details').hidden));
});
$('command-form').addEventListener('submit', event => { event.preventDefault(); command($('command').value); $('command').value = ''; });
$('restore').addEventListener('change', async event => {
  try { await applyRestore(event.target.files[0]); }
  catch (error) { $('save-status').textContent = 'IMPORT FAILED'; log(error.message); }
  event.target.value = '';
});
$('backup').addEventListener('click', async () => {
  try {
    command('web_writeconfig');
    await new Promise(resolve => setTimeout(resolve, 300));
    await sync();
    const files = engine.FS.readdir('/user/id1').filter(name => /^[a-zA-Z0-9_-]+\.(sav|cfg)$/.test(name)).map(name => {
      const bytes = engine.FS.readFile(`/user/id1/${name}`);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return { name, data: btoa(binary) };
    });
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'quakespasm-saves-v1', files })], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'quake-saves.json'; link.hidden = true;
    document.body.appendChild(link); link.click();
    setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 30000);
    $('save-status').textContent = 'SAVE BACKUP EXPORTED';
  } catch (error) { $('save-status').textContent = 'EXPORT FAILED'; log(error.message); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && ready) { command('web_writeconfig'); sync().catch(log); }
});
window.addEventListener('pagehide', () => { if (syncTimer) clearInterval(syncTimer); transport.closeAll(); if (engine) sync().catch(() => {}); });
