// Quake palette helpers: perceptual nearest colour and error-diffusion quantization.

// Palette rows the engine recolours (shirt 16-31, pants 96-111) and fullbrights (224-255).
export const RECOLOURED = index => (index >= 16 && index < 32) || (index >= 96 && index < 112);
export const FULLBRIGHT = index => index >= 224;
export const SKIN_INDICES = Array.from({ length: 256 }, (_, i) => i).filter(i => !RECOLOURED(i) && !FULLBRIGHT(i));
export const PICTURE_INDICES = Array.from({ length: 255 }, (_, i) => i); // 255 is transparent in 2D pictures

const linear = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export function lab(r, g, b) {
  const [R, G, B] = [r, g, b].map(linear);
  const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function createQuantizer(palette, indices) {
  const colours = indices.map(i => ({ index: i, rgb: [palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]], lab: lab(palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]) }));
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let found = cache.get(key);
    if (found) return found;
    const target = lab(r, g, b);
    let best = Infinity;
    for (const colour of colours) {
      const d = (colour.lab[0] - target[0]) ** 2 + (colour.lab[1] - target[1]) ** 2 + (colour.lab[2] - target[2]) ** 2;
      if (d < best) { best = d; found = colour; }
    }
    cache.set(key, found);
    return found;
  };
  // Serpentine Floyd–Steinberg; `strength` < 1 keeps flat areas calm.
  const quantize = (rgba, width, height, { strength = 0.8, region = null } = {}) => {
    const out = new Uint8Array(width * height), error = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      const reverse = y % 2 === 1;
      for (let step = 0; step < width; step++) {
        const x = reverse ? width - 1 - step : step, i = y * width + x;
        if (region && !region(x, y)) continue;
        const want = [0, 1, 2].map(c => Math.max(0, Math.min(255, rgba[i * 4 + c] + error[i * 3 + c])));
        const colour = nearest(...want.map(Math.round));
        out[i] = colour.index;
        const diff = want.map((v, c) => (v - colour.rgb[c]) * strength);
        const spread = (dx, dy, weight) => {
          const nx = x + (reverse ? -dx : dx), ny = y + dy;
          if (nx < 0 || nx >= width || ny >= height) return;
          for (let c = 0; c < 3; c++) error[(ny * width + nx) * 3 + c] += diff[c] * weight;
        };
        spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
      }
    }
    return out;
  };
  return { nearest, quantize };
}

export function indexedToRgba(pixels, palette, transparent = -1) {
  const rgba = new Uint8Array(pixels.length * 4);
  pixels.forEach((p, i) => {
    rgba.set([palette[p * 3], palette[p * 3 + 1], palette[p * 3 + 2], p === transparent ? 0 : 255], i * 4);
  });
  return rgba;
}
