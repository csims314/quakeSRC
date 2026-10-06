import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Identify installed retail data for diagnostics; this never gates playtests.
const registeredMarkerHash =
  "59a7a58a257ae6a231ca4201a8330fa9d90779ea5e230e07d530f2478521bb9a";
function range(buffer, offset, length) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > buffer.length
  )
    throw new Error("Game asset contains an invalid offset");
  return buffer.subarray(offset, offset + length);
}
const nameAt = (b, o, n) => range(b, o, n).toString("ascii").split("\0")[0];
export function readPak(buffer) {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "PACK")
    throw new Error("Invalid Quake PAK");
  const offset = buffer.readUInt32LE(4),
    length = buffer.readUInt32LE(8);
  range(buffer, offset, length);
  if (length % 64 || length / 64 > 65536)
    throw new Error("Invalid PAK directory");
  const entries = new Map();
  for (let o = offset; o < offset + length; o += 64)
    entries.set(
      nameAt(buffer, o, 56),
      range(buffer, buffer.readUInt32LE(o + 56), buffer.readUInt32LE(o + 60)),
    );
  return entries;
}
export function readBspTextures(buffer) {
  if (buffer.length < 124 || buffer.readInt32LE(0) !== 29) return [];
  const lump = range(buffer, buffer.readInt32LE(20), buffer.readInt32LE(24));
  if (lump.length < 4) return [];
  const count = lump.readInt32LE(0),
    result = [];
  if (count < 0 || count > 4096) throw new Error("Invalid BSP textures");
  range(lump, 4, count * 4);
  for (let i = 0; i < count; i++) {
    const o = lump.readInt32LE(4 + i * 4);
    if (o === -1) continue;
    range(lump, o, 40);
    const name = nameAt(lump, o, 16),
      width = lump.readUInt32LE(o + 16),
      height = lump.readUInt32LE(o + 20);
    if (
      !/^[a-zA-Z0-9_*+!-]{1,15}$/.test(name) ||
      !width ||
      !height ||
      width > 4096 ||
      height > 4096 ||
      width % 16 ||
      height % 16
    )
      continue;
    const mip = lump.readUInt32LE(o + 24);
    if (!mip) continue;
    result.push({
      name,
      width,
      height,
      pixels: range(lump, o + mip, width * height),
    });
  }
  return result;
}
export function nearestColor(palette, r, g, b) {
  let best = 0,
    distance = Infinity;
  for (let i = 0; i < 224; i++) {
    const d =
      (r - palette[i * 3]) ** 2 +
      (g - palette[i * 3 + 1]) ** 2 +
      (b - palette[i * 3 + 2]) ** 2;
    if (d < distance) {
      best = i;
      distance = d;
    }
  }
  return best;
}
export function gridTexture(palette) {
  const dark = nearestColor(palette, 58, 64, 69),
    line = nearestColor(palette, 112, 129, 132);
  return {
    name: "ed_grid",
    width: 64,
    height: 64,
    pixels: Buffer.from(
      Array.from({ length: 4096 }, (_, i) =>
        (i % 64) % 16 === 0 || Math.floor(i / 64) % 16 === 0 ? line : dark,
      ),
    ),
  };
}
export function makeWad(textures) {
  const lumps = textures.map((t) => {
    if (
      !/^[a-zA-Z0-9_*+!-]{1,15}$/.test(t.name) ||
      !Number.isInteger(t.width) ||
      !Number.isInteger(t.height) ||
      t.width < 16 ||
      t.height < 16 ||
      t.width > 4096 ||
      t.height > 4096 ||
      t.width % 16 ||
      t.height % 16 ||
      t.pixels.length !== t.width * t.height
    )
      throw new Error("Invalid WAD texture");
    const levels = [Buffer.from(t.pixels)];
    let w = t.width,
      h = t.height;
    for (let level = 1; level < 4; level++) {
      const previous = levels.at(-1),
        next = Buffer.alloc((w * h) / 4);
      for (let y = 0; y < h / 2; y++)
        for (let x = 0; x < w / 2; x++)
          next[y * (w / 2) + x] = previous[y * 2 * w + x * 2];
      levels.push(next);
      w /= 2;
      h /= 2;
    }
    const header = Buffer.alloc(40);
    header.write(t.name, 0, "ascii");
    header.writeUInt32LE(t.width, 16);
    header.writeUInt32LE(t.height, 20);
    let offset = 40;
    levels.forEach((l, i) => {
      header.writeUInt32LE(offset, 24 + i * 4);
      offset += l.length;
    });
    return Buffer.concat([header, ...levels]);
  });
  const header = Buffer.alloc(12);
  header.write("WAD2");
  header.writeInt32LE(lumps.length, 4);
  let offset = 12;
  const directory = Buffer.alloc(lumps.length * 32);
  lumps.forEach((l, i) => {
    const o = i * 32;
    directory.writeInt32LE(offset, o);
    directory.writeInt32LE(l.length, o + 4);
    directory.writeInt32LE(l.length, o + 8);
    directory[o + 12] = 68;
    directory.write(textures[i].name, o + 16, "ascii");
    offset += l.length;
  });
  header.writeInt32LE(offset, 8);
  return Buffer.concat([header, ...lumps, directory]);
}
export function customTextures(project) {
  const seen = new Set();
  return project.textures.map((t) => {
    if (
      !t ||
      typeof t.name !== "string" ||
      !/^ed_[a-zA-Z0-9_]{1,12}$/.test(t.name) ||
      seen.has(t.name) ||
      typeof t.pixels !== "string" ||
      t.pixels.length > 512 * 512 * 2 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(t.pixels) ||
      !Number.isInteger(t.width) ||
      !Number.isInteger(t.height) ||
      t.width < 16 ||
      t.height < 16 ||
      t.width > 512 ||
      t.height > 512 ||
      t.width % 16 ||
      t.height % 16
    )
      throw new Error("Invalid imported texture");
    seen.add(t.name);
    const pixels = Buffer.from(t.pixels, "base64");
    if (pixels.length !== t.width * t.height || pixels.some((p) => p >= 224))
      throw new Error("Invalid imported texture pixels");
    if (
      t.source &&
      (typeof t.source !== "string" || t.source.length > 12 * 1024 * 1024)
    )
      throw new Error("Imported image is too large");
    return { name: t.name, width: t.width, height: t.height, pixels };
  });
}
export function createAssetLibrary(projectRoot) {
  let cached, stamp;
  return async function load() {
    const files = [];
    for (const name of ["pak0.pak", "pak1.pak"]) {
      const file = path.join(projectRoot, "runtime", "id1", name);
      try {
        const s = await stat(file);
        files.push({ name, file, key: `${name}:${s.size}:${s.mtimeMs}` });
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    const key = files.map((f) => f.key).join("|");
    if (cached && stamp === key) return cached;
    const entries = new Map(),
      fingerprint = [];
    for (const f of files) {
      const bytes = await readFile(f.file);
      fingerprint.push({ name: f.name, sha256: hash(bytes) });
      for (const entry of readPak(bytes)) entries.set(...entry);
    }
    const palette =
      entries.get("gfx/palette.lmp") ||
      Buffer.from(Array.from({ length: 768 }, (_, i) => Math.floor(i / 3)));
    if (palette.length !== 768) throw new Error("Invalid Quake palette");
    const textures = new Map([["ed_grid", gridTexture(palette)]]),
      maps = [];
    for (const [name, bytes] of [...entries].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (!/^maps\/[a-zA-Z0-9_]+\.bsp$/.test(name)) continue;
      maps.push(name.slice(5, -4));
      for (const t of readBspTextures(bytes))
        if (!textures.has(t.name)) textures.set(t.name, t);
    }
    cached = {
      palette,
      textures,
      maps,
      fingerprint,
      registered:
        entries.has("gfx/pop.lmp") &&
        hash(entries.get("gfx/pop.lmp")) === registeredMarkerHash,
      available: files.some((f) => f.name === "pak0.pak"),
    };
    stamp = key;
    return cached;
  };
}
