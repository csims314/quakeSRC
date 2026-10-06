import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DEFAULT_CHARACTER, validateManifest, installCharacters } from '../dist/characters.js';
import { readMdl, framePositions, FINE_STRIDE } from '../../tools/characters/lib/mdl.mjs';
import { rigidFit, apply, sub, length } from '../../tools/characters/lib/math.mjs';
import { decodePng } from '../../tools/characters/lib/png.mjs';
import { RECOLOURED, FULLBRIGHT } from '../../tools/characters/lib/palette.mjs';
import { buildCharacters, sameFile } from '../../tools/characters/build.mjs';

const root = new URL('../dist/characters/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const nick = manifest.characters.find(character => character.id === 'nick');
const FACES = ['face1', 'face2', 'face3', 'face4', 'face5', 'face_p1', 'face_p2', 'face_p3', 'face_p4', 'face_p5', 'face_quad', 'face_invis', 'face_invul2', 'face_inv2'];

test('manifest offers the original player and Nick with exactly the shipped files', () => {
  validateManifest(manifest);
  assert.deepEqual(manifest.characters.map(character => character.id), [DEFAULT_CHARACTER, 'nick']);
  assert.deepEqual([...nick.files].sort(), readdirSync(new URL('nick/', root)).sort());
  assert.throws(() => validateManifest({ characters: [{ id: 'ranger', name: 'Ranger' }, { id: '../x', name: 'X' }] }));
  assert.throws(() => validateManifest({ characters: [{ id: 'ranger', name: 'Ranger' }, { id: 'x', name: 'X', files: ['../player.mdl'] }] }));
  assert.throws(() => validateManifest({ characters: [{ id: 'nick', name: 'Nick' }] }), /original player/);
});

test("Nick's player model fits the engine and keeps every player animation", () => {
  const model = readMdl(readFileSync(new URL('nick/player.mdl', root)));
  assert.equal(model.frames.length, 143);
  assert.deepEqual([model.frames[0].name, model.frames[12].name, model.frames.at(-1).name], ['axrun1', 'stand1', 'axattd6']);
  assert.ok(model.stverts.length <= 2400 && model.triangles.length <= 4096);
  assert.equal(model.skinWidth % 4, 0);
  assert.ok(model.skinHeight <= 480);
  assert.ok(model.stverts.every(v => !v.onseam && v.s >= 0 && v.s < model.skinWidth && v.t >= 0 && v.t < model.skinHeight));
  assert.ok(model.triangles.every(t => t.v.every(i => i >= 0 && i < model.stverts.length)));
});

test("Nick's face keeps its shape and lighting through the idle animations", () => {
  // With only 8-bit positions each ring of the face rounds differently every frame, so the photo
  // slides over the head; nearest light normals flip as the head nods, so its shading flickers.
  const model = readMdl(readFileSync(new URL('nick/player.mdl', root)));
  assert.ok(model.frames.every(frame => frame.fine), 'player.mdl must carry fine vertex data');
  const face = model.stverts.flatMap((v, i) => (v.s >= 356 && v.s < 536 && v.t > 80 && v.t < 230 ? [i] : []));
  assert.ok(face.length > 50);
  const positions = model.frames.map(frame => framePositions(model, frame));
  for (const animation of ['stand', 'axstnd']) {
    const frames = model.frames.flatMap((frame, f) => (frame.name.replace(/\d+$/, '') === animation ? [f] : []));
    for (const f of frames.slice(1)) {
      const fit = rigidFit(face.map(i => positions[f - 1][i]), face.map(i => positions[f][i]));
      const warp = Math.max(...face.map(i => length(sub(apply(fit, positions[f - 1][i]), positions[f][i]))));
      assert.ok(warp < 0.02, `${model.frames[f].name} bends the face by ${warp.toFixed(3)} units`);
      assert.ok(face.every(i => model.frames[f].verts[i * 4 + 3] === model.frames[frames[0]].verts[i * 4 + 3]), `${model.frames[f].name} changes the face's light normals`);
    }
  }
  let worst = 0;
  for (const frame of model.frames) for (let i = 0; i < model.stverts.length; i++) {
    const normal = [3, 4, 5].map(k => frame.fine[i * FINE_STRIDE + k] / 127);
    worst = Math.max(worst, Math.abs(length(normal) - 1));
  }
  assert.ok(worst < 0.02, `fine normals must be unit length (off by ${worst.toFixed(3)})`);
});

test("Nick's head never uses team colours or fullbright palette entries", () => {
  const model = readMdl(readFileSync(new URL('nick/player.mdl', root)));
  const skin = model.skins[0];
  for (let y = 0; y < model.skinHeight; y++) for (let x = 296; x < model.skinWidth; x++) {
    const index = skin[y * model.skinWidth + x];
    assert.ok(!RECOLOURED(index) && !FULLBRIGHT(index), `texel ${x},${y} uses palette index ${index}`);
  }
  // The body keeps the recolourable shirt and pants from LibreQuake.
  assert.ok([...skin.subarray(0, 296)].some(RECOLOURED));
});

test('gib head and status-bar faces are complete', () => {
  const head = readMdl(readFileSync(new URL('nick/h_player.mdl', root)));
  assert.equal(head.frames.length, 1);
  assert.equal(head.flags, 4);
  assert.ok(head.frames[0].fine, 'h_player.mdl must carry fine vertex data');
  for (const face of FACES) {
    const image = decodePng(readFileSync(new URL(`nick/${face}.png`, root)));
    assert.deepEqual([image.width, image.height], [96, 96], face);
    const lump = readFileSync(new URL(`nick/${face}.lmp`, root));
    assert.deepEqual([lump.readInt32LE(0), lump.readInt32LE(4), lump.length], [24, 24, 8 + 24 * 24], face);
    assert.ok(!lump.subarray(8).includes(255), `${face} must be opaque`);
  }
});

test('installation writes each character and the engine list', async () => {
  const files = new Map(), directories = [];
  const FS = { mkdirTree: path => directories.push(path), writeFile: (path, data) => files.set(path, data) };
  const installed = await installCharacters(FS, manifest, async (id, file) => new TextEncoder().encode(`${id}/${file}`));
  assert.deepEqual(installed, ['nick']);
  assert.equal(files.get('/quake/id1/characters/list.txt'), 'nick\n');
  assert.equal(new TextDecoder().decode(files.get('/quake/id1/characters/nick/player.mdl')), 'nick/player.mdl');
  assert.equal(files.size, nick.files.length + 1);
});

test('committed character files match a fresh build', () => {
  for (const [name, bytes] of buildCharacters()) {
    if (name.endsWith('.png')) {
      // PNG compression can differ between zlib versions; compare pixels.
      assert.deepEqual(decodePng(readFileSync(new URL(name, root))).rgba, decodePng(bytes).rgba, name);
    } else assert.ok(sameFile(name, readFileSync(new URL(name, root)), bytes), `${name} is out of date; run node tools/characters/build.mjs`);
  }
});
