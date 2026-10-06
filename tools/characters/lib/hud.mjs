// Damage, pain and power-up portraits for a photo-based player character.
export function createHud(photo, loadArt) {
  const SIZE = photo.hud.texels;
  const toHud = ([px, py]) => [((px - photo.hud.x) / photo.hud.size) * SIZE, ((py - photo.hud.y) / photo.hud.size) * SIZE];
  const L = photo.landmarks;
  const EYES = L.eyes.map(toHud);
  const LENSES = L.glasses ? [
    [toHud([L.glasses.left, L.glasses.top]), toHud([L.glasses.bridge[0], L.glasses.bottom])],
    [toHud([L.glasses.bridge[1], L.glasses.top]), toHud([L.glasses.right, L.glasses.bottom])],
  ] : [];
  const NOSE = toHud(L.noseTip);
  const MOUTH = L.mouth.map(toHud);

  const clamp = v => Math.max(0, Math.min(255, v));
  const hash = (x, y, seed) => {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  function canvas(base) {
    const rgba = Uint8Array.from(base.rgba);
    const px = (x, y) => (Math.round(y) * SIZE + Math.round(x)) * 4;
    const inside = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
    const blend = (x, y, colour, alpha) => {
      if (!inside(Math.round(x), Math.round(y)) || alpha <= 0) return;
      const i = px(x, y);
      for (let c = 0; c < 3; c++) rgba[i + c] = clamp(rgba[i + c] * (1 - alpha) + colour[c] * alpha);
    };
    const each = fn => { for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) fn(x, y, (y * SIZE + x) * 4); };
    // Soft round blot, used for blood, bruises and glows.
    const blot = (cx, cy, radius, colour, strength, seed = 0) => {
      for (let y = Math.floor(cy - radius - 1); y <= cy + radius + 1; y++) for (let x = Math.floor(cx - radius - 1); x <= cx + radius + 1; x++) {
        const d = Math.hypot(x - cx, y - cy) / radius + (hash(x, y, seed) - 0.5) * 0.35;
        blend(x, y, colour, strength * Math.max(0, Math.min(1, (1 - d) * 2.5)));
      }
    };
    const line = (x0, y0, x1, y1, colour, alpha, width = 1) => {
      const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3);
      for (let s = 0; s <= steps; s++) {
        const x = x0 + ((x1 - x0) * s) / steps, y = y0 + ((y1 - y0) * s) / steps;
        for (let dy = -width + 1; dy < width; dy++) for (let dx = -width + 1; dx < width; dx++) blend(x + dx, y + dy, colour, alpha);
      }
    };
    const drip = (x, y, length, seed) => {
      blot(x, y, 2.2, [120, 8, 6], 0.85, seed);
      for (let k = 0; k < length; k++) blot(x + Math.sin(k * 0.7 + seed) * 0.6, y + k, 1.1 - k / (length * 2.2), [105, 6, 5], 0.8, seed + k);
    };
    return { rgba, blend, each, blot, line, drip };
  }

  function backdrop(base) {
    // Composite the cut-out over the dark status-bar tone.
    const rgba = new Uint8Array(SIZE * SIZE * 4);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4, a = base.rgba[i + 3] / 255;
      const bg = [44 - y * 0.18, 34 - y * 0.15, 24 - y * 0.1].map(v => v + (hash(x, y, 9) - 0.5) * 6);
      for (let c = 0; c < 3; c++) rgba[i + c] = clamp(base.rgba[i + c] * a + bg[c] * (1 - a));
      rgba[i + 3] = 255;
    }
    return { rgba };
  }

  function closeEyes(face) {
    // Squeezed-shut eyes behind the lenses: skin over the eye, a dark lash line.
    for (const [ex, ey] of EYES) {
      face.blot(ex, ey, 4.2, [176, 122, 104], 0.9, 3);
      face.line(ex - 4.5, ey + 0.6, ex + 4.5, ey + 0.2, [52, 30, 24], 0.85);
      face.line(ex - 4, ey - 1.6, ex + 3.5, ey - 2.2, [120, 78, 64], 0.5);
    }
  }

  function crack(face, lens, seed) {
    if (!LENSES[lens]) return;
    const [[x0, y0], [x1, y1]] = LENSES[lens];
    const cx = x0 + (x1 - x0) * (0.35 + hash(lens, 1, seed) * 0.3), cy = y0 + (y1 - y0) * (0.3 + hash(lens, 2, seed) * 0.4);
    for (let k = 0; k < 6; k++) {
      const angle = (k / 6) * Math.PI * 2 + hash(k, lens, seed) * 0.8, reach = 5 + hash(k, 3, seed) * 7;
      face.line(cx, cy, cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach * 0.7, [235, 238, 240], 0.75);
    }
    face.blot(cx, cy, 1.4, [250, 250, 250], 0.8, seed);
  }

  function damage(face, level) {
    const [left, right] = EYES;
    if (level >= 1) face.drip(left[0] + 6, left[1] - 18, 6, 11);
    if (level >= 2) {
      face.blot(right[0] + 2, right[1] + 5, 5, [92, 52, 88], 0.45, 4);
      face.drip(NOSE[0] - 1, NOSE[1] + 3, 7, 12);
      face.line(MOUTH[1][0] + 9, NOSE[1] - 4, MOUTH[1][0] + 14, NOSE[1] + 3, [140, 14, 10], 0.8);
    }
    if (level >= 3) {
      crack(face, 1, 5);
      face.drip(right[0] + 10, right[1] - 16, 12, 13);
      face.blot(MOUTH[0][0] + 4, MOUTH[0][1] + 2, 4, [110, 8, 6], 0.7, 6);
      face.blot(left[0] - 3, left[1] + 6, 4.5, [96, 50, 90], 0.4, 7);
    }
    if (level >= 4) {
      crack(face, 0, 8);
      face.drip(left[0] - 8, left[1] - 14, 16, 14);
      face.drip(MOUTH[1][0] - 2, MOUTH[1][1] + 2, 12, 15);
      face.each((x, y, i) => {
        const grey = 0.3 * face.rgba[i] + 0.59 * face.rgba[i + 1] + 0.11 * face.rgba[i + 2];
        for (let c = 0; c < 3; c++) face.rgba[i + c] = clamp((face.rgba[i + c] * 0.7 + grey * 0.3) * 0.85);
      });
    }
  }

  function tint(face, colour, amount) {
    face.each((x, y, i) => { for (let c = 0; c < 3; c++) face.rgba[i + c] = clamp(face.rgba[i + c] * (1 - amount) + colour[c] * amount); });
  }

  function glowEyes(face, colour, radius = 3.4) {
    for (const [ex, ey] of EYES) { face.blot(ex, ey, radius + 2, colour, 0.45, 21); face.blot(ex, ey, radius * 0.6, [255, 250, 210], 0.9, 22); }
  }

  function darkness(face, amount) {
    face.each((x, y, i) => { for (let c = 0; c < 3; c++) face.rgba[i + c] = clamp(face.rgba[i + c] * (1 - amount)); });
  }

  function hudFaces() {
    const base = backdrop(loadArt());
    const faces = new Map();
    const make = (name, fn) => { const face = canvas(base); fn(face); faces.set(name, face.rgba); };
    for (let level = 0; level < 5; level++) {
      make(`face${level + 1}`, face => damage(face, level));
      make(`face_p${level + 1}`, face => {
        damage(face, level);
        closeEyes(face);
        tint(face, [200, 20, 10], 0.12);
      });
    }
    make('face_quad', face => { tint(face, [40, 90, 255], 0.28); glowEyes(face, [120, 170, 255]); });
    make('face_invul2', face => { tint(face, [255, 190, 40], 0.3); glowEyes(face, [255, 150, 20]); });
    make('face_invis', face => { darkness(face, 0.9); glowEyes(face, [200, 60, 20], 2.4); });
    make('face_inv2', face => { darkness(face, 0.9); glowEyes(face, [255, 200, 40], 3); });
    return { size: SIZE, faces };
  }

  // Box-filters a face to the original 24x24 status-bar size, then redraws the
  // glasses frames as solid pixels so they survive the reduction.
  function shrink(rgba, factor = 4) {
    const size = SIZE / factor, out = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) sum += rgba[((y * factor + dy) * SIZE + x * factor + dx) * 4 + c];
      out[(y * size + x) * 4 + c] = Math.round(sum / (factor * factor));
    }
    const frame = (x, y) => {
      const i = (Math.round(y) * size + Math.round(x)) * 4;
      const dark = Math.min(out[i], out[i + 1], out[i + 2]) < 40;
      if (!dark) for (let c = 0; c < 3; c++) out[i + c] = Math.round(out[i + c] * 0.3);
    };
    for (const [[x0, y0], [x1, y1]] of LENSES) {
      const [l, t, r, b] = [x0 / factor, y0 / factor, x1 / factor - 1, y1 / factor - 1];
      for (let x = Math.ceil(l); x <= Math.floor(r); x++) { frame(x, t); frame(x, b); }
      for (let y = Math.ceil(t); y <= Math.floor(b); y++) { frame(l, y); frame(r, y); }
    }
    return { size, rgba: out };
  }

  return { hudFaces, shrink };
}
