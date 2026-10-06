// Nick's head textures in true colour: the photo front, and a back of the head
// made from the photo's own side hair.
import { frontGrid, silhouette, EDGE_INSET } from './head.mjs';

const hash = (x, y, seed) => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const fade = t => t * t * (3 - 2 * t);
function noise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = fade(x - xi), yf = fade(y - yi);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
const smooth = (a, b, t) => fade(Math.max(0, Math.min(1, (t - a) / (b - a))));

const texelY = (s, mirrored) => (mirrored ? frontGrid.yMax - (s + 0.5) * frontGrid.step : frontGrid.yMin + (s + 0.5) * frontGrid.step);
const texelZ = t => frontGrid.zTop - (t + 0.5) * frontGrid.step;

const pingpong = (d, band) => { const p = d % (2 * band); return p <= band ? p : 2 * band - p; };

// The band of side hair reflected onto the back: up to 0.6 units inside
// EDGE_INSET, stopping before the first skin (bright and pink, unlike hair,
// highlights and the dark glasses frames). The hairline recedes at the
// temples, so near the forehead the band is much narrower.
const HAIR_BAND = 0.6;
const HAIR_MEDIAN = [57, 42, 35]; // measured from the sides of the photo
// Skin, lips and the ginger beard are warm; Nick's hair is a cooler dark brown.
const warm = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b > 95 && r - b > 30;
function hairBand(front, row, edge, direction) {
  const skin = x => {
    const i = (row * front.width + x) * 4, [r, g, b] = front.rgba.subarray(i, i + 3);
    return 0.299 * r + 0.587 * g + 0.114 * b > 135 && r - b > 35;
  };
  // direction points inward: +1 from the left edge, -1 from the right edge.
  const start = Math.round((edge + direction * EDGE_INSET - frontGrid.yMin) / frontGrid.step - 0.5);
  let steps = 0;
  for (let x = start; steps < HAIR_BAND / frontGrid.step && x > 0 && x < front.width - 1; x += direction, steps++) {
    if (skin(x) && skin(x + direction)) break;
  }
  return Math.max(0.15, steps * frontGrid.step - 0.05);
}

// Real hair from the photo for any point of the head. Each side reflects the
// photo's band of side hair inward at the same height, and the two sides blend
// across the back, so the back matches the front where they meet at the sides.
function photoHair(front) {
  const sample = (y, z) => {
    const s = Math.max(0, Math.min(front.width - 1.001, (y - frontGrid.yMin) / frontGrid.step - 0.5));
    const t = Math.max(0, Math.min(front.height - 1.001, (frontGrid.zTop - z) / frontGrid.step - 0.5));
    const x0 = Math.floor(s), y0 = Math.floor(t), fx = s - x0, fy = t - y0;
    const at = (x, y, c) => front.rgba[(y * front.width + x) * 4 + c];
    return [0, 1, 2].map(c => (at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx) * (1 - fy) + (at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx) * fy);
  };
  const rows = new Map();
  const bands = z => {
    const key = Math.round(z / frontGrid.step);
    if (rows.has(key)) return rows.get(key);
    let outline = null, at = z;
    for (let dz = 0; !outline && dz < 4; dz += frontGrid.step) {
      for (at of [z - dz, z + dz]) if ((outline = silhouette(front, at))) break;
    }
    const { left, right, runs } = outline;
    const row = Math.max(0, Math.min(front.height - 1, Math.round((frontGrid.zTop - at) / frontGrid.step - 0.5)));
    const half = (right - left) / 2;
    const width = (run, edge, direction) => Math.max(0.15, Math.min(hairBand(front, row, edge, direction), half - EDGE_INSET - 0.05,
      runs.length > 1 && run !== outline.core ? run[1] - run[0] - EDGE_INSET : Infinity));
    const result = { left, right, bandLeft: width(runs[0], left, 1), bandRight: width(runs.at(-1), right, -1) };
    // Any warm sample that slips into a band is replaced by the row's own hair colour.
    const hairs = [];
    for (let d = 0; d <= result.bandLeft; d += frontGrid.step) hairs.push(sample(left + EDGE_INSET + d, at));
    for (let d = 0; d <= result.bandRight; d += frontGrid.step) hairs.push(sample(right - EDGE_INSET - d, at));
    const cool = hairs.filter(colour => !warm(colour));
    result.fallback = cool.length ? [0, 1, 2].map(c => cool.reduce((sum, colour) => sum + colour[c], 0) / cool.length) : HAIR_MEDIAN;
    rows.set(key, result);
    return result;
  };
  const hair = (y, z) => {
    const { left, right, bandLeft, bandRight, fallback } = bands(z);
    const hairOnly = colour => (warm(colour) ? fallback : colour);
    const fromRight = hairOnly(sample(right - EDGE_INSET - pingpong(Math.max(0, right - y), bandRight), z));
    const fromLeft = hairOnly(sample(left + EDGE_INSET + pingpong(Math.max(0, y - left), bandLeft), z));
    const w = smooth(-0.9, 0.9, y);
    // Faint strands break up the reflected pattern without changing its colour.
    const strands = 0.9 + 0.2 * noise(y * 14, z * 0.35, 5);
    return fromLeft.map((v, c) => (v * (1 - w) + fromRight[c] * w) * strands);
  };
  hair.bands = bands;
  return hair;
}

export { warm };

export function backTexture(front) {
  const { width, height } = frontGrid, colours = new Float32Array(width * height * 3), hair = photoHair(front);
  for (let t = 0; t < height; t++) for (let s = 0; s < width; s++) colours.set(hair(texelY(s, true), texelZ(t)), (t * width + s) * 3);
  // Blur along the strands (vertically) to even out row-to-row differences.
  const radius = 6, rgba = new Uint8Array(width * height * 4);
  for (let t = 0; t < height; t++) for (let s = 0; s < width; s++) {
    const sum = [0, 0, 0];
    let n = 0;
    for (let k = Math.max(0, t - radius); k <= Math.min(height - 1, t + radius); k++, n++) for (let c = 0; c < 3; c++) sum[c] += colours[(k * width + s) * 3 + c];
    rgba.set([...sum.map(v => Math.round(Math.min(255, v / n))), 255], (t * width + s) * 4);
  }
  return { width, height, rgba };
}

// The photo front. Everything outside the silhouette becomes hair: the gaps
// beside the neck are shadowed hair behind it, and the rest keeps distant mip
// levels (seen when the sides of the head are at a grazing angle) dark brown.
export function frontTexture(front) {
  const rgba = Uint8Array.from(front.rgba), hair = photoHair(front);
  for (let t = 0; t < front.height; t++) {
    const z = texelZ(t), outline = silhouette(front, z);
    const { left, right, bandLeft, bandRight, fallback } = hair.bands(z);
    for (let s = 0; s < front.width; s++) {
      const y = texelY(s, false), i = (t * front.width + s) * 4;
      if (front.rgba[i + 3] >= 128) {
        // Skin showing through the side hair (the ears) would streak across the
        // sides of the head, which this texture covers at a grazing angle.
        const side = y <= left + EDGE_INSET + bandLeft || y >= right - EDGE_INSET - bandRight;
        if (side && warm(rgba.subarray(i, i + 3))) rgba.set(fallback.map(Math.round), i);
        continue;
      }
      const gap = outline && outline.runs.length > 1 && y > outline.left && y < outline.right;
      rgba.set(hair(y, z).map(v => Math.round(Math.min(255, v * (gap ? 0.55 : 0.9)))), i);
    }
  }
  for (let i = 0; i < front.width * front.height; i++) rgba[i * 4 + 3] = 255;
  return { width: front.width, height: front.height, rgba };
}
