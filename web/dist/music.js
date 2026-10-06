// Background music through the browser's own audio player. The engine asks
// for tracks by name ("track02", or a file given to the music command); this
// streams the matching file instead of decoding it in WebAssembly memory.
// Tracks come from files the player added in this browser, then from the
// server's runtime/id1/music folder.

export const MUSIC_TYPES = {
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg; codecs=opus', mp3: 'audio/mpeg',
  flac: 'audio/flac', wav: 'audio/wav', m4a: 'audio/mp4',
};
const MAX_FILE = 256 * 1024 * 1024;

export function musicExtension(name) {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match && MUSIC_TYPES[match[1]] ? match[1] : null;
}

// "track02.ogg", "track2", "02 - Name.mp3" -> "track02"; "song.ogg" -> "song".
export function musicKey(name) {
  const base = String(name).replace(/^.*[\\/]/, '').toLowerCase();
  const stem = musicExtension(base) ? base.slice(0, base.lastIndexOf('.')) : base;
  const numbered = stem.match(/^(?:track)?\s*0*(\d{1,2})(?!\d)/);
  if (numbered && Number(numbered[1]) > 0) return `track${numbered[1].padStart(2, '0')}`;
  return /^[a-z0-9_-]+$/.test(stem) ? stem : null;
}

function openStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('quake-music', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('tracks', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeRequest(mode, action) {
  const db = await openStore();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('tracks', mode);
      const request = action(transaction.objectStore('tracks'));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export function createMusicPlayer({ log = () => {} } = {}) {
  const audio = new Audio();
  audio.preload = 'auto';
  let tracks = new Map(), sessionFiles = new Map(), objectUrls = new Map();
  let current = null, wanted = null, wantedLoop = true, enginePaused = false;

  const playable = type => audio.canPlayType(type) !== '';
  // Tracks start seconds after the Launch click, which some browsers (Safari,
  // strict autoplay settings) refuse. Try again on the player's next input.
  let waiting = false;
  const retry = () => {
    waiting = false;
    for (const type of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(type, retry, true);
    if (current && !enginePaused && !document.hidden && audio.paused) start();
  };
  const start = () => audio.play().catch(error => {
    if (error.name !== 'NotAllowedError') { log(`Music: ${error.message}`); return; }
    if (waiting) return;
    waiting = true;
    for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, retry, true);
  });

  async function storedFiles() {
    try { return await storeRequest('readonly', store => store.getAll()); }
    catch { return []; }
  }

  async function load() {
    const next = new Map(), urls = new Map();
    const offer = (key, track) => { if (key && !next.has(key) && playable(track.type)) next.set(key, track); };
    for (const file of [...sessionFiles.values(), ...await storedFiles()]) {
      const id = `${file.key}/${file.name}/${file.blob.size}`;
      const url = objectUrls.get(id) || URL.createObjectURL(file.blob);
      urls.set(id, url);
      offer(file.key, { url, type: file.type, name: file.name, source: 'yours' });
    }
    for (const [id, url] of objectUrls) if (!urls.has(id)) URL.revokeObjectURL(url);
    objectUrls = urls;
    try {
      const response = await fetch('/api/music');
      if (response.ok) for (const track of (await response.json()).tracks) {
        offer(track.key, { ...track, url: new URL(track.url, location.href).href, source: 'server' });
      }
    } catch (error) { log(`Music list: ${error.message}`); }
    tracks = next;
    // Follow the engine's request when its file was added, removed or replaced.
    const track = wanted && tracks.get(musicKey(wanted));
    if (current && !track) stop();
    else if (track && audio.src !== track.url) {
      const paused = enginePaused;
      play(wanted, wantedLoop);
      if (paused) control('pause');
    }
    return summary();
  }

  function play(name, loop) {
    const track = tracks.get(musicKey(name));
    wanted = name; wantedLoop = loop;
    if (!track) { stop(); return false; }
    current = name; enginePaused = false;
    audio.loop = loop;
    if (audio.src !== track.url) audio.src = track.url;
    audio.currentTime = 0;
    if (!document.hidden) start();
    return true;
  }

  function stop() {
    current = null; enginePaused = false;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }

  function control(action, value) {
    if (action === 'stop') { wanted = null; stop(); }
    else if (action === 'pause' && current) { enginePaused = true; audio.pause(); }
    else if (action === 'resume' && current && enginePaused) { enginePaused = false; if (!document.hidden) start(); }
    else if (action === 'volume') audio.volume = Math.min(1, Math.max(0, value));
    else if (action === 'loop') { wantedLoop = Boolean(value); audio.loop = wantedLoop; }
  }

  async function addFiles(files) {
    const added = [], rejected = [];
    for (const file of files) {
      const extension = musicExtension(file.name), key = musicKey(file.name);
      const type = file.type || MUSIC_TYPES[extension];
      if (!extension || !key) rejected.push(`${file.name} (name it like track02.ogg)`);
      else if (!playable(type)) rejected.push(`${file.name} (this browser can't play .${extension})`);
      else if (file.size > MAX_FILE) rejected.push(`${file.name} (larger than 256 MB)`);
      else added.push({ key, name: file.name, type, blob: file });
    }
    try { await storeRequest('readwrite', store => { for (const file of added) store.put(file); }); }
    catch { for (const file of added) sessionFiles.set(file.key, file); }
    return { added: added.length, rejected, ...await load() };
  }

  async function clearFiles() {
    sessionFiles = new Map();
    try { await storeRequest('readwrite', store => store.clear()); } catch {}
    return load();
  }

  function summary() {
    const list = [...tracks.entries()].map(([key, track]) => ({ key, source: track.source }));
    return { yours: list.filter(t => t.source === 'yours').length, server: list.filter(t => t.source === 'server').length, tracks: list };
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.pause();
    else if (current && !enginePaused) start();
  });

  return {
    load, play, control, addFiles, clearFiles, summary,
    state: () => ({ current, wanted, paused: audio.paused, enginePaused, volume: audio.volume, loop: audio.loop,
      time: audio.currentTime, source: current ? tracks.get(musicKey(current))?.source : null }),
  };
}
