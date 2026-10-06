import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { musicKey } from '../dist/music.js';
import { listMusic, byteRange, MUSIC_FILE } from '../music.mjs';

test('music files map to the engine track they replace', () => {
  for (const name of ['track02.ogg', 'TRACK2.mp3', '02 - Quake Theme.mp3', '2.flac', 'music/track02.opus', 'track02']) {
    assert.equal(musicKey(name), 'track02', name);
  }
  assert.equal(musicKey('track11.wav'), 'track11');
  assert.equal(musicKey('e1m1_theme.ogg'), 'e1m1_theme');
  for (const name of ['100 tracks.ogg', 'Quake Theme.mp3', 'song.ogg.exe']) assert.equal(musicKey(name), null, name);
});

test('the server lists playable music with its preferred format first', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'quake-music-'));
  try {
    await writeFile(path.join(directory, 'track03.mp3'), 'mp3');
    await writeFile(path.join(directory, 'track03.ogg'), 'ogg!');
    await writeFile(path.join(directory, 'track02.wav'), 'w');
    await writeFile(path.join(directory, 'notes.txt'), 'no');
    await writeFile(path.join(directory, 'bad name.ogg'), 'no');
    await mkdir(path.join(directory, 'folder.ogg'));
    assert.deepEqual(await listMusic(directory), [
      { key: 'track02', name: 'track02.wav', url: '/assets/music/track02.wav', type: 'audio/wav', size: 1 },
      { key: 'track03', name: 'track03.ogg', url: '/assets/music/track03.ogg', type: 'audio/ogg', size: 4 },
      { key: 'track03', name: 'track03.mp3', url: '/assets/music/track03.mp3', type: 'audio/mpeg', size: 3 },
    ]);
    assert.deepEqual(await listMusic(path.join(directory, 'missing')), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('music file names cannot leave the music folder', () => {
  for (const name of ['track02.ogg', 'my-song_2.m4a']) assert.match(name, MUSIC_FILE);
  for (const name of ['../track02.ogg', 'a/b.ogg', 'track02.ogg.exe', '.ogg', 'track 02.ogg', 'x.pak']) assert.doesNotMatch(name, MUSIC_FILE);
});

test('audio streaming byte ranges', () => {
  assert.equal(byteRange(undefined, 100), null);
  assert.deepEqual(byteRange('bytes=0-', 100), { start: 0, end: 99 });
  assert.deepEqual(byteRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(byteRange('bytes=90-500', 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange('bytes=-30', 100), { start: 70, end: 99 });
  assert.deepEqual(byteRange('bytes=100-', 100), { unsatisfiable: true });
  assert.deepEqual(byteRange('bytes=20-10', 100), { unsatisfiable: true });
  assert.equal(byteRange('bytes=0-1,5-6', 100), null);
  assert.equal(byteRange('items=0-1', 100), null);
});

test('music blocked by the browser starts on the next player input', async () => {
  const listeners = new Map(), plays = [];
  const on = (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]);
  const off = (type, fn) => listeners.set(type, (listeners.get(type) || []).filter(f => f !== fn));
  const globals = {
    Audio: class {
      paused = true; volume = 1; loop = false; currentTime = 0; src = '';
      canPlayType() { return 'maybe'; }
      play() {
        plays.push(this.src);
        if (plays.length === 1) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
        this.paused = false; return Promise.resolve();
      }
      pause() { this.paused = true; } load() {} removeAttribute() { this.src = ''; }
    },
    document: { hidden: false, addEventListener() {} },
    window: { addEventListener: on, removeEventListener: off },
    location: { href: 'https://quake.example/' },
    indexedDB: { open() { const request = {}; queueMicrotask(() => request.onerror?.()); return request; } },
    fetch: async () => ({ ok: true, json: async () => ({ tracks: [{ key: 'track04', name: 'track04.mp3', url: '/assets/music/track04.mp3', type: 'audio/mpeg' }] }) }),
  };
  const saved = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  try {
    const { createMusicPlayer } = await import('../dist/music.js');
    const music = createMusicPlayer();
    await music.load();
    assert.equal(music.play('track04', true), true);
    await new Promise(resolve => setTimeout(resolve));
    assert.equal(plays.length, 1); assert.equal(music.state().paused, true);
    assert.ok(listeners.get('pointerdown')?.length, 'waits for the next input');
    for (const fn of listeners.get('pointerdown')) fn();
    await new Promise(resolve => setTimeout(resolve));
    assert.equal(plays.length, 2); assert.equal(music.state().paused, false);
    assert.equal(listeners.get('pointerdown').length + listeners.get('keydown').length, 0, 'stops listening once playing');
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
