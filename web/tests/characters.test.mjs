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
const custom = manifest.characters.filter(character => character.files?.length);
const FACES = ['face1', 'face2', 'face3', 'face4', 'face5', 'face_p1', 'face_p2', 'face_p3', 'face_p4', 'face_p5', 'face_quad', 'face_invis', 'face_invul2', 'face_inv2'];

test('manifest offers Ranger, Nick and Chris with exactly the shipped files', () => {
  validateManifest(manifest);
  assert.deepEqual(manifest.characters.map(character => character.id), [DEFAULT_CHARACTER, 'nick', 'chris']);
  for (const character of custom) assert.deepEqual([...character.files].sort(), readdirSync(new URL(`${character.id}/`, root)).sort());
  assert.throws(() => validateManifest({ characters: [{ id: 'ranger', name: 'Ranger' }, { id: '../x', name: 'X' }] }));
  assert.throws(() => validateManifest({ characters: [{ id: 'ranger', name: 'Ranger' }, { id: 'x', name: 'X', files: ['../player.mdl'] }] }));
  assert.throws(() => validateManifest({ characters: [{ id: 'nick', name: 'Nick' }] }), /original player/);
});

for (const character of custom) {
  test(`${character.name}'s player model fits the engine and keeps every player animation`, () => {
    const model = readMdl(readFileSync(new URL(`${character.id}/player.mdl`, root)));
    assert.equal(model.frames.length, 143);
    assert.deepEqual([model.frames[0].name, model.frames[12].name, model.frames.at(-1).name], ['axrun1', 'stand1', 'axattd6']);
    assert.ok(model.stverts.length <= 2400 && model.triangles.length <= 4096);
    assert.equal(model.skinWidth % 4, 0);
    assert.ok(model.skinHeight <= 480);
    assert.ok(model.stverts.every(v => !v.onseam && v.s >= 0 && v.s < model.skinWidth && v.t >= 0 && v.t < model.skinHeight));
    assert.ok(model.triangles.every(t => t.v.every(i => i >= 0 && i < model.stverts.length)));
  });

  test(`${character.name}'s face keeps its shape and lighting through the idle animations`, () => {
    // With only 8-bit positions each ring of the face rounds differently every frame, so the photo
    // slides over the head; nearest light normals flip as the head nods, so its shading flickers.
    const model = readMdl(readFileSync(new URL(`${character.id}/player.mdl`, root)));
    assert.ok(model.frames.every(frame => frame.fine), 'player.mdl must carry fine vertex data');
    // The head's front texture follows the 296-texel body skin; take the middle of the face.
    const front = decodePng(readFileSync(new URL(`../../tools/characters/${character.id}/art/front.png`, import.meta.url))).width;
    const face = model.stverts.flatMap((v, i) => (v.s >= 296 + 0.2 * front && v.s < 296 + 0.8 * front &&
      v.t > 0.23 * model.skinHeight && v.t < 0.65 * model.skinHeight ? [i] : []));
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

  test(`${character.name}'s head never uses team colours or fullbright palette entries`, () => {
    const model = readMdl(readFileSync(new URL(`${character.id}/player.mdl`, root)));
    const skin = model.skins[0];
    for (let y = 0; y < model.skinHeight; y++) for (let x = 296; x < model.skinWidth; x++) {
      const index = skin[y * model.skinWidth + x];
      assert.ok(!RECOLOURED(index) && !FULLBRIGHT(index), `texel ${x},${y} uses palette index ${index}`);
    }
    // The body keeps the recolourable shirt and pants from LibreQuake.
    assert.ok([...skin.subarray(0, 296)].some(RECOLOURED));
  });

  test(`${character.name}'s neck stays inside the collar through every animation`, () => {
    const model = readMdl(readFileSync(new URL(`${character.id}/player.mdl`, root)));
    const stand = framePositions(model, model.frames[12]);
    const base = model.stverts.flatMap((uv, i) => uv.s >= 296 && stand[i][2] < 15.8
      && Math.abs(stand[i][1] + 1.3) < 2 && Math.abs(stand[i][0] - 0.4) < 2 ? [i] : []);
    const collar = model.stverts.flatMap((uv, i) => uv.s < 296 && stand[i][2] > 15 && stand[i][2] < 17.5
      && Math.hypot(stand[i][0] - 0.4, stand[i][1] + 1.3) < 2.2 ? [i] : []);
    assert.ok(base.length > 20, 'the neck must extend into the armor, below the jaw');
    assert.ok(collar.length >= 3);
    const unique = new Map(collar.map(i => [stand[i].map(v => v.toFixed(3)).join(','), i]));
    const anchors = [...unique.values()];
    for (const frame of model.frames) {
      const positions = framePositions(model, frame);
      const fit = rigidFit(anchors.map(i => stand[i]), anchors.map(i => positions[i]));
      const error = Math.max(...base.map(i => length(sub(apply(fit, stand[i]), positions[i]))));
      assert.ok(error < 0.02, `${frame.name} separates the neck base from the armor (${error.toFixed(3)} units)`);
    }
    assert.ok(Math.max(...base.map(i => stand[i][0])) < 0.6, 'the neck base must stay behind the front armor');
    assert.ok(Math.max(...base.map(i => stand[i][1])) - Math.min(...base.map(i => stand[i][1])) < 1.7, 'the neck must taper inward inside the collar');
    const crown = Math.max(...stand.filter((_, i) => model.stverts[i].s >= 296).map(p => p[2]));
    assert.ok(crown > 29.7 && crown < 30.2, 'the enlarged head must retain its 150% height above the neck');
    {
      const width = decodePng(readFileSync(new URL(`../../tools/characters/${character.id}/art/front.png`, import.meta.url))).width;
      const throat = model.stverts.flatMap((uv, i) => uv.s >= 296 + 4 * width && stand[i][0] > 0.3
        && stand[i][2] < 17.1 && stand[i][2] > 15.5 && Math.abs(stand[i][1] + 1.3) < 0.2 ? [i] : []);
      assert.ok(throat.length >= 4);
      assert.ok(throat.every(i => model.frames[12].fine[i * FINE_STRIDE + 3] > 60), 'the neck front must face and light outward');
    }
  });

  test(`${character.name}'s jaw and neck form one closed surface with no split edges`, async () => {
    const { buildHead, loadFront, NECK } = await import(`../../tools/characters/${character.id}/head.mjs`);
    const mesh = buildHead(loadFront()), welded = new Map(), edges = new Map(), adjacent = new Map();
    const ids = mesh.vertices.map(vertex => {
      const key = vertex.position.map(v => v.toFixed(4)).join(',');
      if (!welded.has(key)) welded.set(key, welded.size);
      return welded.get(key);
    });
    for (const triangle of mesh.triangles) for (let k = 0; k < 3; k++) {
      const [a, b] = [ids[triangle[k]], ids[triangle[(k + 1) % 3]]];
      const key = [a, b].sort((x, y) => x - y).join('/');
      edges.set(key, (edges.get(key) ?? 0) + 1);
      if (!adjacent.has(a)) adjacent.set(a, new Set());
      adjacent.get(a).add(b);
    }
    assert.ok([...edges.values()].every(count => count === 2), 'every edge must have both adjoining faces');
    const reached = new Set(), pending = [0];
    while (pending.length) {
      const id = pending.pop(); if (reached.has(id)) continue;
      reached.add(id); pending.push(...(adjacent.get(id) ?? []));
    }
    assert.equal(reached.size, welded.size, 'the neck cannot be a disconnected tube');
    const rings = new Map();
    for (const vertex of mesh.vertices) if (vertex.position[2] <= NECK.throat && vertex.position[2] >= NECK.base) {
      const z = vertex.position[2]; if (!rings.has(z)) rings.set(z, []);
      rings.get(z).push(vertex.position);
    }
    let last = Infinity;
    for (const [z, points] of [...rings].sort((a, b) => b[0] - a[0])) {
      const width = Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1]));
      assert.ok(width < last, `neck widens toward the armor at ${z}`); last = width;
    }
  });

  test(`${character.name}'s side UVs follow head depth instead of stretching its front photo`, () => {
    const model = readMdl(readFileSync(new URL(`${character.id}/player.mdl`, root)));
    const positions = framePositions(model, model.frames[12]);
    const width = decodePng(readFileSync(new URL(`../../tools/characters/${character.id}/art/front.png`, import.meta.url))).width;
    for (const panel of [2, 3]) {
      const samples = model.stverts.flatMap((uv, i) => uv.s >= 296 + panel * width && uv.s < 296 + (panel + 1) * width && positions[i][2] > 19
        ? [[positions[i][0], uv.s - 296 - panel * width]] : []);
      assert.ok(samples.length > 100, 'each side must have its own atlas panel');
      const average = column => samples.reduce((sum, p) => sum + p[column], 0) / samples.length;
      const [mx, ms] = [average(0), average(1)];
      const slope = samples.reduce((sum, [x, s]) => sum + (x - mx) * (s - ms), 0)
        / samples.reduce((sum, [x]) => sum + (x - mx) ** 2, 0);
      const worst = Math.max(...samples.map(([x, s]) => Math.abs(s - (ms + slope * (x - mx)))));
      assert.ok(slope > 20 && worst < 1, `side texture must advance along depth, without streaks (${worst.toFixed(2)} texels)`);
    }
  });

  test(`${character.name}'s gib head and status-bar faces are complete`, () => {
    const head = readMdl(readFileSync(new URL(`${character.id}/h_player.mdl`, root)));
    assert.equal(head.frames.length, 1);
    assert.equal(head.flags, 4);
    assert.ok(head.frames[0].fine, 'h_player.mdl must carry fine vertex data');
    for (const face of FACES) {
      const image = decodePng(readFileSync(new URL(`${character.id}/${face}.png`, root)));
      assert.deepEqual([image.width, image.height], [96, 96], face);
      const lump = readFileSync(new URL(`${character.id}/${face}.lmp`, root));
      assert.deepEqual([lump.readInt32LE(0), lump.readInt32LE(4), lump.length], [24, 24, 8 + 24 * 24], face);
      assert.ok(!lump.subarray(8).includes(255), `${face} must be opaque`);
    }
  });
}

test('installation writes each character and the engine list', async () => {
  const files = new Map(), directories = [];
  const FS = { mkdirTree: path => directories.push(path), writeFile: (path, data) => files.set(path, data) };
  const installed = await installCharacters(FS, manifest, async (id, file) => new TextEncoder().encode(`${id}/${file}`));
  assert.deepEqual(installed, ['nick', 'chris']);
  assert.equal(files.get('/quake/id1/characters/list.txt'), 'nick\nchris\n');
  assert.equal(new TextDecoder().decode(files.get('/quake/id1/characters/nick/player.mdl')), 'nick/player.mdl');
  assert.equal(new TextDecoder().decode(files.get('/quake/id1/characters/chris/player.mdl')), 'chris/player.mdl');
  assert.equal(files.size, custom.reduce((sum, character) => sum + character.files.length, 0) + 1);
});

test('committed character files match a fresh build', () => {
  for (const [name, bytes] of buildCharacters()) {
    if (name.endsWith('.png')) {
      // PNG compression can differ between zlib versions; compare pixels.
      assert.deepEqual(decodePng(readFileSync(new URL(name, root))).rgba, decodePng(bytes).rgba, name);
    } else assert.ok(sameFile(name, readFileSync(new URL(name, root)), bytes), `${name} is out of date; run node tools/characters/build.mjs`);
  }
});
