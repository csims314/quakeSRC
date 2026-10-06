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
