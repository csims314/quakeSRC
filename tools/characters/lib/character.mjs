import { readFileSync } from 'node:fs';
import { readMdl, quantizeFrames, writeMdl } from './mdl.mjs';
import { createQuantizer, SKIN_INDICES, PICTURE_INDICES } from './palette.mjs';
import { components, allFramePositions, track, smoothNormals, steadyLightNormals, groupCentroid } from './compose.mjs';
import { apply, nearestLightNormal, lightNormals as lightNormalTable } from './math.mjs';
import { encodePng } from './png.mjs';
import { createNeckMesh, createCollarInsert } from './neck-mesh.mjs';

const vendor = new URL('../vendor/librequake/', import.meta.url);
export const palette = readFileSync(new URL('palette.lmp', vendor));

// Attach a photo head to the shared animated body and build its HUD assets.
export function createCharacterBuilder({ buildHead, loadFront, frontGrid, RINGS,
  frontTexture, backTexture, sideTextures, neckTexture, hudFaces, shrink, gibBottom = -5.2,
  headScale = 1, neckTop = -4.5, neck }) {
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
  const panels = [...(sideTextures ? ['front', 'back', 'left', 'right'] : ['front', 'back']), ...(neckTexture ? ['neck'] : [])];
  const ATLAS = { front: 296, width: 296 + frontGrid.width * panels.length, height: frontGrid.height };

  function headAtlas(quantizer) {
    const region = image => quantizer.quantize(image.rgba, image.width, image.height, { strength: 0.75 });
    const front = loadFront();
    const images = { front: frontTexture(front), back: backTexture(front) };
    if (sideTextures) Object.assign(images, sideTextures(front, images));
    if (neckTexture) images.neck = neckTexture(front, images);
    return Object.fromEntries(panels.map(panel => [panel, region(images[panel])]));
  }

  function skinWith(head, body = null) {
    const width = body ? ATLAS.width : frontGrid.width * panels.length, height = ATLAS.height;
    const skin = new Uint8Array(width * height).fill(body ? body.skins[0][0] : 0);
    if (body) for (let t = 0; t < body.skinHeight; t++) skin.set(body.skins[0].subarray(t * body.skinWidth, (t + 1) * body.skinWidth), t * width);
    const x0 = body ? ATLAS.front : 0;
    for (let t = 0; t < frontGrid.height; t++) {
      for (const [i, panel] of panels.entries()) {
        skin.set(head[panel].subarray(t * frontGrid.width, (t + 1) * frontGrid.width), t * width + x0 + i * frontGrid.width);
      }
    }
    return { skin, width, height };
  }

  function stvert(vertex, x0) {
    if (vertex.bodyUv) return vertex.bodyUv;
    const s = Math.max(0, Math.min(frontGrid.width - 1, Math.round(vertex.uv[0] - 0.5)));
    const t = Math.max(0, Math.min(frontGrid.height - 1, Math.round(vertex.uv[1] - 0.5)));
    return { onseam: 0, s: x0 + s + panels.indexOf(vertex.side) * frontGrid.width, t };
  }

  function buildPlayer(head = buildHead(loadFront()), atlas = headAtlas(createQuantizer(palette, SKIN_INDICES))) {
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
    // Fit the attachment to the armor's own collar, which moves independently
    // of the broader chest during running and attacks.
    const unique = new Set();
    const collar = pose.flatMap((p, i) => {
      if (removed.has(i) || p[2] < 15 || p[2] > 17.5 || Math.hypot(p[0] - HEAD_ORIGIN[0], p[1] - HEAD_ORIGIN[1]) > 2.2) return [];
      const key = p.map(v => v.toFixed(4)).join(',');
      if (unique.has(key)) return [];
      unique.add(key); return [i];
    });
    if (collar.length < 3) throw new Error('Could not find the armor collar');
    const headMotion = track(frames, STAND, helmet), collarMotion = track(frames, STAND, collar);

    const column = createNeckMesh(neck, frontGrid), insert = createCollarInsert(body, pose, removed, palette);
    const additions = [head, column, insert], extraVertices = [], extraTriangles = [];
    for (const part of additions) {
      const start = extraVertices.length;
      extraVertices.push(...part.vertices);
      extraTriangles.push(...part.triangles.map(t => t.map(i => i + start)));
    }

    const keep = body.stverts.map((_, i) => i).filter(i => !removed.has(i));
    const remap = new Map(keep.map((old, i) => [old, i]));
    const offset = keep.length;
    const triangles = [
      ...body.triangles.filter(t => t.v.every(v => !removed.has(v))).map(t => ({ front: 1, v: t.v.map(v => remap.get(v)) })),
      ...extraTriangles.map(t => ({ front: 1, v: t.map(v => v + offset) })),
    ];
    const stverts = [...keep.map(i => body.stverts[i]), ...extraVertices.map(v => stvert(v, ATLAS.front))];
    const placed = head.vertices.map(v => {
      const [x, y, z] = v.position;
      return [x * headScale + HEAD_ORIGIN[0], y * headScale + HEAD_ORIGIN[1],
        neckTop + (z - neckTop) * headScale + HEAD_ORIGIN[2]];
    });
    const headFrames = frames.map((positions, f) => [
      ...placed.map(p => apply(headMotion[f], p)),
      ...column.posed(headMotion[f], collarMotion[f]), ...insert.posed(positions),
    ]);
    const headDirections = headFrames.map(positions => smoothNormals(positions, extraTriangles));
    const headNormals = steadyLightNormals(headDirections, FRAME_NAMES.map(name => name.replace(/\d+$/, '')));
    // The body keeps LibreQuake's light normals, so it is lit the same with or without fine data.
    const table = lightNormalTable();
    const outFrames = frames.map((positions, f) => {
      const bodyNormals = keep.map(i => body.frames[f].verts[i * 4 + 3]);
      return {
        name: FRAME_NAMES[f],
        positions: [...keep.map(i => positions[i]), ...headFrames[f]],
        normals: [...bodyNormals, ...headNormals[f]],
        directions: [...bodyNormals.map(n => table[n]), ...headDirections[f]],
      };
    });
    const quantized = quantizeFrames(outFrames);
    const { skin, width, height } = skinWith(atlas, body);
    return writeMdl({
      ...quantized, eye: body.eye, synctype: body.synctype, flags: body.flags, size: body.size,
      skinWidth: width, skinHeight: height, skins: [skin], stverts, triangles,
    });
  }

  // The detached head, enlarged like Quake's gib heads.
  function buildGibHead(atlas = headAtlas(createQuantizer(palette, SKIN_INDICES))) {
    const head = buildHead(loadFront(), { rings: RINGS.filter(z => z >= gibBottom + 0.25), bottom: gibBottom });
    const scale = 1.35 * headScale, lift = -Math.min(...head.vertices.map(v => v.position[2])) * scale - 1.5;
    const positions = head.vertices.map(v => [(v.position[0] - 0.2) * scale, v.position[1] * scale, v.position[2] * scale + lift]);
    const directions = smoothNormals(positions, head.triangles);
    const quantized = quantizeFrames([{ name: 'frame1', positions, normals: directions.map(nearestLightNormal), directions }]);
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

  // Every file the character ships, keyed by its path inside characters/<id>/.
  function buildFiles() {
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

  return { buildPlayer, buildGibHead, buildFiles };
}
