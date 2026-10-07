import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DEFAULT_CHARACTER, validateManifest, installCharacters } from '../dist/characters.js';
import { readMdl, framePositions, FINE_STRIDE } from '../../tools/characters/lib/mdl.mjs';
import { rigidFit, apply, sub, length, centroid, lerp } from '../../tools/characters/lib/math.mjs';
import { assertClosed, insideMesh, meshEdges } from './character-geometry.mjs';
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

  test(`${character.name}'s solid neck overlaps the head and armor through every animation`, () => {
    const model = readMdl(readFileSync(new URL(`${character.id}/player.mdl`, root)));
    const stand = framePositions(model, model.frames[12]);
    const width = decodePng(readFileSync(new URL(`../../tools/characters/${character.id}/art/front.png`, import.meta.url))).width;
    const start = 296 + 4 * width;
    const neck = model.stverts.flatMap((uv, i) => uv.s >= start && uv.s < start + width - 16 ? [i] : []);
    assert.equal(neck.length, 202, 'the neck has eight oval rings and both caps');
    const ids = new Set(neck), body = model.triangles.filter(t => t.v.every(i => model.stverts[i].s < 296)).map(t => t.v);
    const head = model.triangles.filter(t => t.v.every(i => model.stverts[i].s >= 296 && !ids.has(i))).map(t => t.v);
    const column = model.triangles.filter(t => t.v.every(i => ids.has(i))).map(t => t.v);
    const base = neck.slice(0, 25).concat(neck.at(-2)), top = neck.slice(175, 200).concat(neck.at(-1));
    const collar = model.stverts.flatMap((uv, i) => uv.s < 296 && stand[i][2] > 15 && stand[i][2] < 17.5
      && Math.hypot(stand[i][0] - 0.4, stand[i][1] + 1.3) < 2.2 ? [i] : []);
    assert.ok(collar.length >= 3);
    const unique = new Map(collar.map(i => [stand[i].map(v => v.toFixed(3)).join(','), i]));
    const anchors = [...unique.values()];
    for (const frame of model.frames) {
      const positions = framePositions(model, frame);
      const fit = rigidFit(anchors.map(i => stand[i]), anchors.map(i => positions[i]));
      const error = Math.max(...base.map(i => length(sub(apply(fit, stand[i]), positions[i]))));
      assert.ok(error < 0.004, `${frame.name} separates the base from the armor`);
      assertClosed(positions, column, `${frame.name} neck`);
      assertClosed(positions, head, `${frame.name} head`);
      assert.ok(base.every(i => insideMesh(positions[i], positions, body)), `${frame.name} exposes the bottom cap outside the armor`);
      assert.ok(top.every(i => insideMesh(positions[i], positions, head)), `${frame.name} exposes the top cap outside the head`);
      let previous = 0;
      for (let row = 0; row < 8; row++) {
        const ring = neck.slice(row * 25, row * 25 + 24).map(i => positions[i]), center = centroid(ring);
        const radius = Math.max(...ring.map(p => length(sub(p, center))));
        assert.ok(radius > previous && radius < 1.304, `${frame.name} neck bulges or splits at ring ${row}`);
        previous = radius;
      }
    }
    const poses = model.frames.map(frame => framePositions(model, frame));
    for (let f = 1; f < model.frames.length; f++) {
      if (model.frames[f].name.replace(/\d+$/, '') !== model.frames[f - 1].name.replace(/\d+$/, '')) continue;
      for (const t of [0.25, 0.5, 0.75]) {
        const positions = poses[f].map((p, i) => lerp(poses[f - 1][i], p, t));
        assert.ok(base.every(i => insideMesh(positions[i], positions, body)), `${model.frames[f].name} ${t} exposes the interpolated base`);
        assert.ok(top.every(i => insideMesh(positions[i], positions, head)), `${model.frames[f].name} ${t} exposes the interpolated top`);
      }
    }
    const crown = Math.max(...stand.filter((_, i) => model.stverts[i].s >= 296).map(p => p[2]));
    assert.ok(crown > 29.7 && crown < 30.2, 'the enlarged head must retain its 150% height above the neck');
  });

  test(`${character.name}'s armor opening stays sealed through every animation`, () => {
    const model = readMdl(readFileSync(new URL(`${character.id}/player.mdl`, root))), stand = framePositions(model, model.frames[12]);
    const collar = new Set(model.stverts.flatMap((uv, i) => uv.s < 296 && stand[i][2] > 14 && stand[i][2] < 21
      && Math.hypot(stand[i][0], stand[i][1] + 1.3) < 5 ? [i] : []));
    assert.ok(collar.size >= 15, 'the body includes the original rim and its fitted insert');
    const body = model.triangles.filter(t => t.v.every(i => model.stverts[i].s < 296)).map(t => t.v);
    for (const frame of model.frames) {
      const edges = meshEdges(framePositions(model, frame), body).filter(edge => edge.vertices.every(i => collar.has(i)));
      assert.ok(edges.length >= 8);
      assert.ok(edges.every(edge => edge.count === 2 && edge.winding === 0), `${frame.name} reopens the armor below the neck`);
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
    const positions = framePositions(head, head.frames[0]);
    assertClosed(positions, head.triangles.map(t => t.v), 'detached head');
    assert.ok(Math.abs(Math.min(...positions.map(p => p[2])) + 1.5) < 0.003, 'the detached head rests at the original ground offset');
    for (const face of FACES) {
      const image = decodePng(readFileSync(new URL(`${character.id}/${face}.png`, root)));
      assert.deepEqual([image.width, image.height], [96, 96], face);
      const lump = readFileSync(new URL(`${character.id}/${face}.lmp`, root));
      assert.deepEqual([lump.readInt32LE(0), lump.readInt32LE(4), lump.length], [24, 24, 8 + 24 * 24], face);
      assert.ok(!lump.subarray(8).includes(255), `${face} must be opaque`);
    }
  });

  test(`${character.name}'s wounds remain clearly visible in the native 24px HUD palette`, () => {
    const palette = readFileSync(new URL('../../tools/characters/vendor/librequake/palette.lmp', import.meta.url));
    const blood = name => [...readFileSync(new URL(`${character.id}/${name}.lmp`, root)).subarray(8)].filter(index => {
      const [r, g, b] = palette.subarray(index * 3, index * 3 + 3);
      return r > 75 && r > g * 2.5 && r > b * 2.5;
    }).length;
    const tiers = [1, 2, 3, 4, 5].map(level => blood('face' + level));
    assert.ok(tiers[1] >= 10, 'the first injured tier must retain a substantial red wound after downsampling');
    assert.ok(tiers[4] >= 100, 'critical injuries must cover a visible portion of the 576-pixel portrait');
    assert.ok(tiers.every((count, i) => !i || count > tiers[i - 1]), 'blood coverage must increase as health falls');
    assert.ok(blood('face_p1') >= 10, 'pain animation must not paint over the wounds');
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
