// Quake MDL (IDPO version 6) reader and writer. Single skins and frames only.
export const ONSEAM = 0x20;
const HEADER_SIZE = 84;

export function readMdl(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'IDPO' || buffer.readInt32LE(4) !== 6) throw new Error('Not a version 6 Quake model');
  const vec = offset => [0, 1, 2].map(i => buffer.readFloatLE(offset + i * 4));
  const model = {
    scale: vec(8), origin: vec(20), radius: buffer.readFloatLE(32), eye: vec(36),
    skinWidth: buffer.readInt32LE(52), skinHeight: buffer.readInt32LE(56),
    synctype: buffer.readInt32LE(72), flags: buffer.readInt32LE(76), size: buffer.readFloatLE(80),
    skins: [], stverts: [], triangles: [], frames: [],
  };
  const numSkins = buffer.readInt32LE(48), numVerts = buffer.readInt32LE(60);
  const numTris = buffer.readInt32LE(64), numFrames = buffer.readInt32LE(68);
  const skinSize = model.skinWidth * model.skinHeight;
  let offset = HEADER_SIZE;
  for (let i = 0; i < numSkins; i++) {
    if (buffer.readInt32LE(offset)) throw new Error('Skin groups are not supported');
    model.skins.push(Uint8Array.from(buffer.subarray(offset + 4, offset + 4 + skinSize)));
    offset += 4 + skinSize;
  }
  for (let i = 0; i < numVerts; i++, offset += 12) {
    model.stverts.push({ onseam: buffer.readInt32LE(offset), s: buffer.readInt32LE(offset + 4), t: buffer.readInt32LE(offset + 8) });
  }
  for (let i = 0; i < numTris; i++, offset += 16) {
    model.triangles.push({ front: buffer.readInt32LE(offset), v: [4, 8, 12].map(k => buffer.readInt32LE(offset + k)) });
  }
  for (let i = 0; i < numFrames; i++) {
    if (buffer.readInt32LE(offset)) throw new Error('Frame groups are not supported');
    const name = buffer.toString('ascii', offset + 12, offset + 28).split('\0')[0];
    offset += 28;
    model.frames.push({ name, verts: Uint8Array.from(buffer.subarray(offset, offset + numVerts * 4)) });
    offset += numVerts * 4;
  }
  if (offset !== buffer.length) throw new Error('Model has trailing data');
  return model;
}

// Positions of one frame in model units, as [x, y, z] arrays.
export function framePositions(model, frame) {
  const result = [];
  for (let i = 0; i < model.stverts.length; i++) {
    result.push([0, 1, 2].map(k => frame.verts[i * 4 + k] * model.scale[k] + model.origin[k]));
  }
  return result;
}

// Quantizes float positions for every frame onto a shared byte grid.
// frames: [{ name, positions: [[x,y,z]], normals: [index] }]
export function quantizeFrames(frames) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let radius = 0;
  for (const frame of frames) for (const p of frame.positions) {
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
    radius = Math.max(radius, Math.hypot(...p));
  }
  const scale = min.map((value, k) => Math.max(max[k] - value, 1e-3) / 255);
  const quantized = frames.map(frame => {
    const verts = new Uint8Array(frame.positions.length * 4);
    frame.positions.forEach((p, i) => {
      for (let k = 0; k < 3; k++) verts[i * 4 + k] = Math.max(0, Math.min(255, Math.round((p[k] - min[k]) / scale[k])));
      verts[i * 4 + 3] = frame.normals[i];
    });
    return { name: frame.name, verts };
  });
  return { scale, origin: min, radius, frames: quantized };
}

export function writeMdl(model) {
  const numVerts = model.stverts.length, skinSize = model.skinWidth * model.skinHeight;
  if (model.skinWidth % 4) throw new Error('Skin width must be a multiple of four');
  const size = HEADER_SIZE + model.skins.length * (4 + skinSize) + numVerts * 12 + model.triangles.length * 16 + model.frames.length * (28 + numVerts * 4);
  const out = Buffer.alloc(size);
  out.write('IDPO', 0, 'ascii');
  out.writeInt32LE(6, 4);
  model.scale.forEach((v, i) => out.writeFloatLE(v, 8 + i * 4));
  model.origin.forEach((v, i) => out.writeFloatLE(v, 20 + i * 4));
  out.writeFloatLE(model.radius, 32);
  model.eye.forEach((v, i) => out.writeFloatLE(v, 36 + i * 4));
  [model.skins.length, model.skinWidth, model.skinHeight, numVerts, model.triangles.length, model.frames.length, model.synctype, model.flags]
    .forEach((v, i) => out.writeInt32LE(v, 48 + i * 4));
  out.writeFloatLE(model.size, 80);
  let offset = HEADER_SIZE;
  for (const skin of model.skins) {
    if (skin.length !== skinSize) throw new Error('Skin data does not match the skin size');
    out.writeInt32LE(0, offset);
    out.set(skin, offset + 4);
    offset += 4 + skinSize;
  }
  for (const v of model.stverts) {
    out.writeInt32LE(v.onseam, offset); out.writeInt32LE(v.s, offset + 4); out.writeInt32LE(v.t, offset + 8);
    offset += 12;
  }
  for (const t of model.triangles) {
    out.writeInt32LE(t.front, offset);
    t.v.forEach((v, i) => out.writeInt32LE(v, offset + 4 + i * 4));
    offset += 16;
  }
  for (const frame of model.frames) {
    if (frame.verts.length !== numVerts * 4) throw new Error(`Frame ${frame.name} has the wrong vertex count`);
    const bounds = [[255, 255, 255], [0, 0, 0]];
    for (let i = 0; i < numVerts; i++) for (let k = 0; k < 3; k++) {
      bounds[0][k] = Math.min(bounds[0][k], frame.verts[i * 4 + k]);
      bounds[1][k] = Math.max(bounds[1][k], frame.verts[i * 4 + k]);
    }
    out.writeInt32LE(0, offset);
    out.set(bounds[0], offset + 4);
    out.set(bounds[1], offset + 8);
    out.write(frame.name.slice(0, 15), offset + 12, 'ascii');
    out.set(frame.verts, offset + 28);
    offset += 28 + numVerts * 4;
  }
  return out;
}
