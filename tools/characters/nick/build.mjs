// Stage 2: assembles Nick from LibreQuake's BSD player body and the committed head art.
import { readFileSync } from 'node:fs';
import { readMdl, quantizeFrames, writeMdl } from '../lib/mdl.mjs';
import { createQuantizer, SKIN_INDICES, PICTURE_INDICES } from '../lib/palette.mjs';
import { components, allFramePositions, track, blend, lightNormals, groupCentroid } from '../lib/compose.mjs';
import { encodePng } from '../lib/png.mjs';
import { buildHead, loadFront, frontGrid, RINGS } from './head.mjs';
import { frontTexture, backTexture } from './textures.mjs';
import { hudFaces, shrink } from './hud.mjs';

const vendor = new URL('../vendor/librequake/', import.meta.url);
export const palette = readFileSync(new URL('palette.lmp', vendor));

// Frame names follow the player animations in id's QuakeC player.qc.
const FRAME_NAMES = [
  ...['axrun', 'rockrun'].flatMap(n => [1, 2, 3, 4, 5, 6].map(i => n + i)),
  ...[1, 2, 3, 4, 5].map(i => 'stand' + i),
  ...Array.from({ length: 12 }, (_, i) => 'axstnd' + (i + 1)),
  ...['axpain', 'pain'].flatMap(n => [1, 2, 3, 4, 5, 6].map(i => n + i)),
  ...Array.from({ length: 9 }, (_, i) => 'axdeth' + (i + 1)),
  ...Array.from({ length: 11 }, (_, i) => 'deatha' + (i + 1)),
  ...Array.from({ length: 9 }, (_, i) => 'deathb' + (i + 1)),
  ...Array.from({ length: 15 }, (_, i) => 'deathc' + (i + 1)),
  ...['deathd', 'deathe'].flatMap(n => Array.from({ length: 9 }, (_, i) => n + (i + 1))),
  'nailatt1', 'nailatt2', 'light1', 'light2',
  ...['rockatt', 'shotatt', 'axatt', 'axattb', 'axattc', 'axattd'].flatMap(n => [1, 2, 3, 4, 5, 6].map(i => n + i)),
];
const STAND = FRAME_NAMES.indexOf('stand1');
// Head-local origin (eye line, face centre) in the body's stand1 pose.
const HEAD_ORIGIN = [0.4, -1.3, 22.35];
const ATLAS = { front: 296, back: 296 + frontGrid.width, width: 296 + frontGrid.width * 2, height: frontGrid.height };

function headAtlas(quantizer) {
  const region = image => quantizer.quantize(image.rgba, image.width, image.height, { strength: 0.75 });
  const front = loadFront();
  return { front: region(frontTexture(front)), back: region(backTexture(front)) };
}

function skinWith(head, body = null) {
  const width = body ? ATLAS.width : frontGrid.width * 2, height = ATLAS.height;
  const skin = new Uint8Array(width * height).fill(body ? body.skins[0][0] : 0);
  if (body) for (let t = 0; t < body.skinHeight; t++) skin.set(body.skins[0].subarray(t * body.skinWidth, (t + 1) * body.skinWidth), t * width);
  const x0 = body ? ATLAS.front : 0;
  for (let t = 0; t < frontGrid.height; t++) {
    skin.set(head.front.subarray(t * frontGrid.width, (t + 1) * frontGrid.width), t * width + x0);
    skin.set(head.back.subarray(t * frontGrid.width, (t + 1) * frontGrid.width), t * width + x0 + frontGrid.width);
  }
  return { skin, width, height };
}

function stvert(vertex, x0) {
  const s = Math.max(0, Math.min(frontGrid.width - 1, Math.round(vertex.uv[0] - 0.5)));
  const t = Math.max(0, Math.min(frontGrid.height - 1, Math.round(vertex.uv[1] - 0.5)));
  return { onseam: 0, s: x0 + s + (vertex.side === 'back' ? frontGrid.width : 0), t };
}

export function buildPlayer(head = buildHead(loadFront()), atlas = headAtlas(createQuantizer(palette, SKIN_INDICES))) {
  const body = readMdl(readFileSync(new URL('player.mdl', vendor)));
  if (body.frames.length !== FRAME_NAMES.length || body.stverts.some(v => v.onseam)) throw new Error('Unexpected LibreQuake player model');
  const frames = allFramePositions(body);
  const pose = frames[STAND];
  // The helmet is made of separate parts above the shoulders; the chest is the torso around the neck.
  const parts = components(body);
  const helmet = parts.filter(ids => Math.min(...ids.map(i => pose[i][2])) > 15.5 && Math.abs(groupCentroid(pose, ids)[1] - HEAD_ORIGIN[1]) < 3).flat();
  const removed = new Set(helmet);
  const chest = parts.filter(ids => ids.length >= 150).flat()
    .filter(i => !removed.has(i) && pose[i][2] > 12 && pose[i][2] < 19.8 && Math.abs(pose[i][1] - HEAD_ORIGIN[1]) < 4.5 && Math.abs(pose[i][0]) < 5);
  if (helmet.length < 40 || chest.length < 20) throw new Error('Could not find the helmet and chest in the body model');
  const headMotion = track(frames, STAND, helmet), chestMotion = track(frames, STAND, chest);

  const keep = body.stverts.map((_, i) => i).filter(i => !removed.has(i));
  const remap = new Map(keep.map((old, i) => [old, i]));
  const offset = keep.length;
  const triangles = [
    ...body.triangles.filter(t => t.v.every(v => !removed.has(v))).map(t => ({ front: 1, v: t.v.map(v => remap.get(v)) })),
    ...head.triangles.map(t => ({ front: 1, v: t.map(v => v + offset) })),
  ];
  const stverts = [...keep.map(i => body.stverts[i]), ...head.vertices.map(v => stvert(v, ATLAS.front))];
  const placed = head.vertices.map(v => v.position.map((p, k) => p + HEAD_ORIGIN[k]));
  const headTriangles = head.triangles;
  const outFrames = frames.map((positions, f) => {
    const headPositions = placed.map((p, i) => blend(headMotion[f], chestMotion[f], p, head.vertices[i].weight));
    return {
      name: FRAME_NAMES[f],
      positions: [...keep.map(i => positions[i]), ...headPositions],
      normals: [...keep.map(i => body.frames[f].verts[i * 4 + 3]), ...lightNormals(headPositions, headTriangles)],
    };
  });
  const quantized = quantizeFrames(outFrames);
  const { skin, width, height } = skinWith(atlas, body);
  return writeMdl({
    ...quantized, eye: body.eye, synctype: body.synctype, flags: body.flags, size: body.size,
    skinWidth: width, skinHeight: height, skins: [skin], stverts, triangles,
  });
}

// The head thrown when a player is gibbed: crown to beard, enlarged like id's gib heads.
export function buildGibHead(atlas = headAtlas(createQuantizer(palette, SKIN_INDICES))) {
  const head = buildHead(loadFront(), { rings: RINGS.filter(z => z >= -4.95), bottom: -5.2 });
  const scale = 1.35, lift = 5.2 * scale - 1.5;
  const positions = head.vertices.map(v => [(v.position[0] - 0.2) * scale, v.position[1] * scale, v.position[2] * scale + lift]);
  const quantized = quantizeFrames([{ name: 'frame1', positions, normals: lightNormals(positions, head.triangles) }]);
  const { skin, width, height } = skinWith(atlas);
  return writeMdl({
    ...quantized, eye: [0, 0, 0], synctype: 0, flags: 4, size: 6,
    skinWidth: width, skinHeight: height, skins: [skin],
    stverts: head.vertices.map(v => stvert(v, 0)),
    triangles: head.triangles.map(t => ({ front: 1, v: t })),
  });
}

function lmp(size, pixels) {
  const out = Buffer.alloc(8 + pixels.length);
  out.writeInt32LE(size, 0);
  out.writeInt32LE(size, 4);
  out.set(pixels, 8);
  return out;
}

// Every file the Nick character ships, keyed by its path inside characters/nick/.
export function buildNick() {
  const atlas = headAtlas(createQuantizer(palette, SKIN_INDICES));
  const files = new Map([['player.mdl', buildPlayer(undefined, atlas)], ['h_player.mdl', buildGibHead(atlas)]]);
  const pictures = createQuantizer(palette, PICTURE_INDICES);
  const { size, faces } = hudFaces();
  for (const [name, rgba] of faces) {
    files.set(`${name}.png`, encodePng(size, size, rgba));
    const small = shrink(rgba);
    files.set(`${name}.lmp`, lmp(small.size, pictures.quantize(small.rgba, small.size, small.size, { strength: 0 })));
  }
  return files;
}
