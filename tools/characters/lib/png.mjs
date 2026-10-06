// Minimal PNG codec for the character asset tools (8-bit, non-interlaced).
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// Chooses the filter with the smallest absolute sum per row, as libpng does.
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error('PNG data does not match its size');
  const stride = width * 4, raw = Buffer.alloc((stride + 1) * height), row = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const line = rgba.subarray(y * stride, (y + 1) * stride);
    const above = y ? rgba.subarray((y - 1) * stride, y * stride) : null;
    let best = 0, bestScore = Infinity, bestRow = null;
    for (let filter = 0; filter < 5; filter++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? line[x - 4] : 0, b = above ? above[x] : 0, c = above && x >= 4 ? above[x - 4] : 0;
        const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
        row[x] = (line[x] - predicted) & 0xff;
        score += row[x] < 128 ? row[x] : 256 - row[x];
      }
      if (score < bestScore) { bestScore = score; best = filter; bestRow = Buffer.from(row); }
    }
    raw[y * (stride + 1)] = best;
    bestRow.copy(raw, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export function decodePng(buffer) {
  if (!SIGNATURE.equals(buffer.subarray(0, 8))) throw new Error('Not a PNG file');
  let offset = 8, width, height, depth, type, interlace, palette, transparency;
  const data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset), name = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (name === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; type = body[9]; interlace = body[12];
    } else if (name === 'PLTE') palette = body;
    else if (name === 'tRNS') transparency = body;
    else if (name === 'IDAT') data.push(body);
    else if (name === 'IEND') break;
    offset += length + 12;
  }
  if (depth !== 8 || interlace) throw new Error('Only 8-bit non-interlaced PNG files are supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`Unsupported PNG color type ${type}`);
  const raw = inflateSync(Buffer.concat(data)), stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y ? pixels[(y - 1) * stride + x] : 0;
      const c = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      if (predicted === undefined) throw new Error(`Invalid PNG filter ${filter}`);
      pixels[y * stride + x] = (line[x] + predicted) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = pixels.subarray(i * channels, (i + 1) * channels);
    if (type === 3) {
      rgba.set(palette.subarray(p[0] * 3, p[0] * 3 + 3), i * 4);
      rgba[i * 4 + 3] = transparency && p[0] < transparency.length ? transparency[p[0]] : 255;
    } else if (type === 0 || type === 4) {
      rgba.fill(p[0], i * 4, i * 4 + 3);
      rgba[i * 4 + 3] = type === 4 ? p[1] : 255;
    } else {
      rgba.set(p.subarray(0, 3), i * 4);
      rgba[i * 4 + 3] = type === 6 ? p[3] : 255;
    }
  }
  return { width, height, rgba };
}
