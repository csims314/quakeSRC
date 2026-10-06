import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DEFAULT_CHARACTER, validateManifest, installCharacters } from '../dist/characters.js';
import { readMdl } from '../../tools/characters/lib/mdl.mjs';
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

  test(`${character.name}'s gib head and status-bar faces are complete`, () => {
    const head = readMdl(readFileSync(new URL(`${character.id}/h_player.mdl`, root)));
    assert.equal(head.frames.length, 1);
    assert.equal(head.flags, 4);
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
