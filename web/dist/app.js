import { createQuakeTransport, connectQuake } from './network.js';
import { createMusicPlayer } from './music.js';
import { createTouchControls, prefersTouch } from './touch.js';
import { DEFAULT_CHARACTER, validateManifest, installCharacters } from './characters.js';

const $ = id => document.getElementById(id);
const canvas = $('canvas');
const logs = [];
let engine, starting = false, ready = false, pausedByToolbar = false;
let pendingRestore;
let syncTimer;
let joining = false, leaving = false;
let activeMode = null, catalog;
const requestedMode = new URL(location.href).searchParams.get('mode');
const explicitMode = ['coop', 'deathmatch'].includes(requestedMode);
$('mode').value = explicitMode ? requestedMode : 'coop';
const selectedMode = () => $('mode').value;
const multiplayerSupported = typeof globalThis.WebTransport === 'function' || typeof globalThis.WebSocket === 'function';
function updateJoinButton() {
  $('join').disabled = !multiplayerSupported || !ready || joining || leaving || activeMode === selectedMode();
}
if (!multiplayerSupported) $('network-status').textContent = 'Single player is available. This browser has no supported multiplayer connection.';
async function waitForGame(predicate) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (predicate(window.quake.state())) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('The game did not finish switching. Please try joining again.');
}
function showServerInfo(config) {
  if (!multiplayerSupported) {
    $('multiplayer-summary').textContent = 'Single player available · This browser has no supported multiplayer connection.';
    return;
  }
  if (!config.available) {
    $('multiplayer-summary').textContent = 'Multiplayer server unavailable';
    return;
  }
  const coop = config.mode === 'coop';
  $('join').textContent = coop ? 'Join co-op' : 'Join deathmatch';
  const difficulty = ['Easy', 'Normal', 'Hard', 'Nightmare'][config.skill];
  $('multiplayer-summary').textContent = [
    coop ? 'Co-op' : 'Deathmatch',
    config.monsters ? 'Original monsters' : 'No monsters',
    coop ? difficulty : null,
    !coop && config.fragLimit ? `${config.fragLimit} frag limit` : null,
    !coop && config.timeLimit ? `${config.timeLimit} minute rounds` : null,
    config.map,
    `Up to ${config.maxPlayers} players`,
  ].filter(Boolean).join(' · ');
}
function showSelectedRoom() {
  if (!catalog) return;
  showServerInfo(catalog.rooms?.find(room => room.id === selectedMode()) || catalog);
  updateJoinButton();
}
async function refreshRooms() {
  const response = await fetch('/api/multiplayer');
  if (!response.ok) throw new Error('Multiplayer server unavailable');
  catalog = await response.json();
  showSelectedRoom();
}
refreshRooms().then(() => {
  if (!explicitMode && catalog.defaultMode) { $('mode').value = catalog.defaultMode; showSelectedRoom(); }
}).catch(() => { $('multiplayer-summary').textContent = 'Multiplayer server unavailable'; });
$('mode').addEventListener('change', () => {
  const url = new URL(location.href);
  url.searchParams.set('mode', selectedMode());
  history.replaceState(null, '', url);
  showSelectedRoom();
});
const roomTimer = window.setInterval(() => { if (!document.hidden) refreshRooms().catch(() => {}); }, 15000);

// Player characters: the choice is remembered in this browser and sent to every server joined.
let characters = [{ id: DEFAULT_CHARACTER, name: 'Ranger', description: 'The original Quake marine.' }];
let character = DEFAULT_CHARACTER;
try { character = localStorage.getItem('quake.character') || DEFAULT_CHARACTER; } catch {}
function portrait(choice, className = 'portrait') {
  if (!choice.portrait) return Object.assign(document.createElement('span'), { className: `${className} sigil-portrait`, textContent: 'Ϙ' });
  return Object.assign(document.createElement('img'), { className, src: choice.portrait, alt: '' });
}
// The remembered choice stays pending until the character list has loaded.
const currentCharacter = () => characters.find(choice => choice.id === character) || characters[0];
function renderCharacters() {
  const current = currentCharacter();
  $('character').replaceChildren(...characters.map(choice => new Option(choice.name, choice.id, false, choice === current)));
  $('character-portrait').replaceChildren(portrait(current, 'portrait small'));
  $('character-cards').replaceChildren(...characters.map(choice => {
    const card = Object.assign(document.createElement('label'), { className: 'character-card' });
    const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'character-card', value: choice.id, checked: choice === current });
    input.addEventListener('change', () => chooseCharacter(choice.id));
    const text = Object.assign(document.createElement('span'), { className: 'card-text' });
    text.append(Object.assign(document.createElement('strong'), { textContent: choice.name }), Object.assign(document.createElement('small'), { textContent: choice.description || '' }));
    card.append(input, portrait(choice), text);
    return card;
  }));
}
function chooseCharacter(id) {
  character = id;
  try { localStorage.setItem('quake.character', id); } catch {}
  renderCharacters();
  command(`character ${currentCharacter().id}`);
}
const charactersReady = fetch('characters/manifest.json')
  .then(response => (response.ok ? response.json() : Promise.reject(new Error('Character list unavailable'))))
  .then(manifest => {
    validateManifest(manifest);
    characters = manifest.characters;
    if (!characters.some(choice => choice.id === character)) character = DEFAULT_CHARACTER;
    renderCharacters();
    return manifest;
  });
charactersReady.catch(error => log(`Characters: ${error.message}`));
renderCharacters();
$('character').addEventListener('change', event => chooseCharacter(event.target.value));
const transport = createQuakeTransport(event => {
  if (event.state === 'closed' && transport.snapshot().some(connection => connection.open)) return;
  $('network-status').textContent = event.state === 'ready' ? 'Connected. Joining the game…' : `Disconnected: ${event.reason}`;
  if (event.state === 'closed') {
    if (!joining) { activeMode = null; $('pause').disabled = !ready; }
    updateJoinButton();
    $('leave').hidden = true;
  }
});
window.__quakeErrors = [];
window.addEventListener('error', event => window.__quakeErrors.push(event.message));
window.addEventListener('unhandledrejection', event => window.__quakeErrors.push(String(event.reason)));
// SDL also requests pointer lock during map changes and toolbar clicks. Let
// the player opt in through Click to play, the canvas, or Fullscreen so Esc
// reliably leaves the toolbar usable throughout a room transition.
const nativePointerLock = canvas.requestPointerLock?.bind(canvas);
const releaseMouse = () => document.exitPointerLock?.();
let captureRequested = false;
canvas.requestPointerLock = (...args) => {
  if (!captureRequested || !nativePointerLock || touch.enabled) return Promise.resolve();
  const result = nativePointerLock(...args);
  result?.catch(error => log(`Mouse capture: ${error.message}`));
  return result;
};

const music = createMusicPlayer({ log });
const musicReady = music.load().then(showMusic).catch(error => log(`Music: ${error.message}`));
function showMusic({ yours, server }) {
  const parts = [yours && `${yours} of your tracks`, server && `${server} from this server`].filter(Boolean);
  $('music-status').textContent = parts.length ? parts.join(' and ') : 'none added';
  $('music-clear').disabled = !yours;
}
async function addMusic(event) {
  const input = event.target;
  try {
    const result = await music.addFiles([...input.files]);
    showMusic(result);
    $('music-note').textContent = [
      result.added && `Added ${result.added} track${result.added === 1 ? '' : 's'}.`,
      result.rejected.length && `Skipped ${result.rejected.join(', ')}.`,
    ].filter(Boolean).join(' ');
  } catch (error) { $('music-note').textContent = `Could not add music: ${error.message}`; }
  if (!starting) $('loading').textContent = $('music-note').textContent;
  input.value = '';
}

const touch = createTouchControls($('stage'), {
  ready: () => ready,
  move: (forward, side) => engine.ccall('Web_SetMove', null, ['number', 'number'], [forward, side]),
  look: (yaw, pitch) => engine.ccall('Web_Look', null, ['number', 'number'], [yaw, pitch]),
  key: (code, down) => engine.ccall('Web_Key', null, ['number', 'number'], [code, down ? 1 : 0]),
  command: text => command(text),
  state: () => window.quake.state(),
});
let touchChoice = null;
try { touchChoice = localStorage.getItem('quake-touch'); } catch {}
function setTouch(enabled, remember = false) {
  touch.setEnabled(enabled);
  $('touch-toggle').setAttribute('aria-pressed', String(enabled));
  if (remember) try { localStorage.setItem('quake-touch', enabled ? 'on' : 'off'); touchChoice = enabled ? 'on' : 'off'; } catch {}
  if (enabled) releaseMouse();
  updateCaptureHint();
}
// Touch play needs no mouse capture, so the Click to play prompt stays away.
function updateCaptureHint() {
  $('capture').hidden = !ready || touch.enabled || document.pointerLockElement === canvas;
}

function log(line) {
  console.log(line);
  logs.push(String(line));
  if (logs.length > 500) logs.shift();
  $('log').textContent = logs.join('\n');
  if (String(line).includes('Quake Initialized')) {
    ready = true;
    window.setTimeout(() => {
      command(`character ${currentCharacter().id}\nstopdemo\nmap start`);
      $('status').textContent = 'Running';
      $('cover').hidden = true;
      updateCaptureHint();
      touch.refresh();
      for (const id of ['pause', 'backup', 'send-command']) $(id).disabled = false;
      updateJoinButton();
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
    await musicReady;
    engine = await createQuakeSpasm({
      canvas, noInitialRun: true, quakeTransport: transport, quakeMusic: music,
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
      music,
      touch,
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
    const manifest = await charactersReady.catch(() => null);
    if (manifest) await installCharacters(engine.FS, manifest, async (id, file) => {
      const response = await fetch(`characters/${id}/${file}`);
      if (!response.ok) throw new Error(`Missing character file ${id}/${file}`);
      return new Uint8Array(await response.arrayBuffer());
    });
    // Use original gameplay; only supply desktop browser-friendly input defaults.
    if (!engine.FS.analyzePath('/user/id1/config.cfg').exists) {
      engine.FS.writeFile('/user/id1/config.cfg', 'bind w +forward\nbind s +back\nbind a +moveleft\nbind d +moveright\nbind SPACE +jump\nbind MOUSE1 +attack\nbind TAB +showscores\n+mlook\n');
    }
    if (pendingRestore) { await applyRestore(pendingRestore); pendingRestore = null; }
    $('loading').textContent = 'Starting Quake…';
    const args = ['-basedir', '/quake', '-userdir', '/user', '-heapsize', '196608', '-window', '-width', '1280', '-height', '720', '-noipx', '-nopackedpixels', '+r_vfog', '0'];
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
  if (!nativePointerLock && navigator.maxTouchPoints > 0) setTouch(true);
  if (touch.enabled) return;
  try {
    captureRequested = true;
    if (document.pointerLockElement !== canvas) await canvas.requestPointerLock();
  } catch (error) { log(`Mouse capture: ${error.message}`); }
  finally { captureRequested = false; }
}

$('start').addEventListener('click', start);
$('join').addEventListener('click', async () => {
  if (joining || leaving || !ready) return;
  joining = true; $('join').disabled = true;
  $('network-status').textContent = 'Connecting to multiplayer…';
  releaseMouse();
  try {
    const response = await fetch(`/api/multiplayer?mode=${selectedMode()}`);
    if (!response.ok) throw new Error('The selected multiplayer mode is unavailable.');
    const config = await response.json();
    showServerInfo(config);
    const entered = $('server-url').value.trim();
    if (!entered && !config.available) throw new Error(config.error || 'The local multiplayer server is unavailable.');
    const matched = entered && [config, ...(config.rooms || [])].find(room => new URL(entered).href === new URL(room.url).href);
    const target = entered ? { ...matched, url: entered } : config;
    const joinGame = async forceWebSocket => {
      command('disconnect'); transport.closeAll();
      // Commands run in the next engine frame. Release the previous connection
      // before opening another session, including after a failed sign-on.
      await waitForGame(state => !state.connected && state.signon === 0);
    const connectionId = await connectQuake(transport, target, { forceWebSocket,
        onProgress: text => { $('network-status').textContent = text; },
        onFallback: reason => log(`Using compatible connection: ${reason}`) });
      command('stopdemo\nconnect webtransport\nmenu_main\ntogglemenu');
      await waitForGame(state => state.connectionId === connectionId && state.signon === 4 && !state.serverActive);
    };
    try { await joinGame(false); }
    catch (error) {
      // Some transports establish a session but stall during Quake sign-on.
      // Retry once over HTTPS, without leaking the half-connected player.
      if (!target.websocketUrl || !transport.snapshot().some(connection => connection.transport === 'webtransport')) throw error;
      log(`WebTransport sign-on failed: ${error.message}`);
      await joinGame(true);
    }
    releaseMouse();
    $('leave').hidden = false;
    $('network-status').textContent = `Connected to ${entered ? 'multiplayer' : config.mode === 'coop' ? 'co-op' : 'deathmatch'}. ${touch.enabled ? 'Tap' : 'Click'} the game to play.`;
    $('save-status').textContent = entered ? 'MULTIPLAYER' : config.mode === 'coop' ? 'CO-OP / ORIGINAL MONSTERS' : 'DEATHMATCH';
    activeMode = entered ? 'custom' : config.id || selectedMode();
    pausedByToolbar = false; $('pause').textContent = 'Pause';
    $('pause').disabled = !entered && config.mode === 'deathmatch';
  } catch (error) {
    transport.closeAll();
    $('network-status').textContent = error.message;
    activeMode = null; command('map start');
    log(error.message);
  } finally { joining = false; updateJoinButton(); }
});
$('leave').addEventListener('click', async () => {
  leaving = true;
  command('disconnect\nmap start\nmenu_main\ntogglemenu');
  transport.closeAll();
  activeMode = null; updateJoinButton(); $('leave').hidden = true; $('pause').disabled = false;
  $('network-status').textContent = 'Returning to single player…';
  $('save-status').textContent = 'LOCAL SINGLE PLAYER';
  try {
    await waitForGame(state => state.serverActive && state.map === 'start' && state.signon === 4);
    releaseMouse();
    $('network-status').textContent = 'Returned to single player.';
  } catch (error) { $('network-status').textContent = error.message; }
  finally { leaving = false; updateJoinButton(); }
});
$('resume').addEventListener('click', capture);
canvas.addEventListener('click', capture);
canvas.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('pointerlockchange', updateCaptureHint);
$('touch-toggle').addEventListener('click', () => setTouch(!touch.enabled, true));
// A finger on the game turns touch controls on unless the player turned them off.
$('stage').addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch' && !touch.enabled && touchChoice !== 'off') setTouch(true);
}, true);
setTouch(touchChoice ? touchChoice === 'on' : prefersTouch() || (!nativePointerLock && navigator.maxTouchPoints > 0));
for (const id of ['music-files', 'music-add']) $(id).addEventListener('change', addMusic);
$('music-clear').addEventListener('click', async () => {
  try { showMusic(await music.clearFiles()); $('music-note').textContent = 'Removed your music from this browser.'; }
  catch (error) { $('music-note').textContent = `Could not remove music: ${error.message}`; }
});
$('pause').addEventListener('click', () => {
  command('pause'); pausedByToolbar = !pausedByToolbar;
  $('pause').textContent = pausedByToolbar ? 'Resume' : 'Pause';
  if (pausedByToolbar) releaseMouse();
});
function updateGameView() {
  const expanded = $('stage').classList.contains('expanded') || document.fullscreenElement === $('stage');
  $('view-exit').hidden = !expanded;
  $('fullscreen').setAttribute('aria-pressed', String(expanded));
}
function expandGame(value) {
  $('stage').classList.toggle('expanded', value);
  document.body.classList.toggle('expanded-game', value);
  updateGameView();
}
document.addEventListener('fullscreenchange', updateGameView);
$('view-exit').addEventListener('click', async () => {
  if (document.fullscreenElement) await document.exitFullscreen?.();
  expandGame(false);
});
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen?.();
    else if ($('stage').classList.contains('expanded')) expandGame(false);
    else {
      if ($('stage').requestFullscreen) {
        try { await $('stage').requestFullscreen(); }
        catch { expandGame(true); }
      } else expandGame(true);
      if (touch.enabled) await screen.orientation?.lock?.('landscape').catch(() => {});
    }
    updateGameView();
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
window.addEventListener('pagehide', () => { if (syncTimer) clearInterval(syncTimer); clearInterval(roomTimer); transport.closeAll(); if (engine) sync().catch(() => {}); });
