import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { MUSIC_TYPES, musicExtension, musicKey } from './dist/music.js';

export const MUSIC_FILE = /^[a-zA-Z0-9_-]+\.(ogg|oga|opus|mp3|flac|wav|m4a)$/;
const FORMAT_ORDER = Object.keys(MUSIC_TYPES);

export const musicType = name => MUSIC_TYPES[musicExtension(name)];

// Music in runtime/id1/music that browsers may stream. When a track exists
// in several formats, the preferred format comes first.
export async function listMusic(directory) {
  let names;
  try { names = await readdir(directory); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const tracks = [];
  for (const name of names.filter(name => MUSIC_FILE.test(name))) {
    const info = await stat(path.join(directory, name)).catch(() => null);
    if (!info?.isFile()) continue;
    tracks.push({ key: musicKey(name), name, url: `/assets/music/${name}`, type: musicType(name), size: info.size });
  }
  const rank = track => FORMAT_ORDER.indexOf(musicExtension(track.name));
  return tracks.sort((a, b) => a.key.localeCompare(b.key) || rank(a) - rank(b));
}

// A single "bytes=start-end" range, as audio players request while streaming.
// Other forms are ignored and the whole file is sent.
export function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() || '');
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : { unsatisfiable: true };
}
