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
    const drip = (x, y, length, seed, width = 3.5) => {
      blot(x, y, width * 2, [171, 12, 9], 0.98, seed);
      for (let k = 0; k < length; k++) {
        const dx = x + Math.sin(k * 0.22 + seed) * 1.1, r = width * (1 - k / (length * 1.8));
        blot(dx, y + k, r, [151, 7, 6], 0.96, seed + k);
        blend(dx - r * 0.4, y + k, [231, 39, 22], 0.65);
      }
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
    // Paint broad, opaque wounds before reduction. A thin 96px scratch turns
    // into a barely tinted texel at the actual 24px HUD size. Keep fresh reds
    // over the pallor, with dark cuts and larger purple swelling for contrast.
    if (level >= 4) {
      face.each((x, y, i) => {
        const grey = 0.3 * face.rgba[i] + 0.59 * face.rgba[i + 1] + 0.11 * face.rgba[i + 2];
        for (let c = 0; c < 3; c++) face.rgba[i + c] = clamp((face.rgba[i + c] * 0.65 + grey * 0.35) * 0.8);
      });
    }
    if (level >= 1) {
      face.blot(left[0] + 3, left[1] - 13, 9, [172, 15, 11], 0.95, 10);
      face.line(left[0] - 4, left[1] - 13, left[0] + 11, left[1] - 16, [62, 4, 6], 0.95, 2);
      face.drip(left[0] + 6, left[1] - 12, 18, 11, 3.8);
      face.blot(right[0] + 3, right[1] + 7, 8, [101, 44, 79], 0.7, 4);
    }
    if (level >= 2) {
      face.blot(right[0] + 1, right[1] + 3, 12, [63, 29, 67], 0.82, 4);
      face.blot(right[0] + 3, right[1] + 8, 8, [117, 35, 51], 0.78, 5);
      face.drip(NOSE[0] - 2, NOSE[1] + 1, 19, 12, 4);
      face.blot(MOUTH[1][0] + 7, NOSE[1] + 5, 8, [181, 16, 10], 0.95, 16);
      face.line(MOUTH[1][0] + 2, NOSE[1], MOUTH[1][0] + 12, NOSE[1] + 8, [60, 4, 6], 0.98, 2);
    }
    if (level >= 3) {
      crack(face, 1, 5);
      face.drip(right[0] + 8, right[1] - 15, 33, 13, 5);
      face.blot(MOUTH[0][0] + 4, MOUTH[0][1] + 2, 9, [158, 9, 7], 0.95, 6);
      face.blot(left[0] - 3, left[1] + 5, 13, [62, 30, 72], 0.8, 7);
      face.line(MOUTH[0][0] - 3, MOUTH[0][1], MOUTH[0][0] + 8, MOUTH[0][1] + 2, [63, 3, 5], 0.98, 2);
      face.drip(MOUTH[0][0] + 3, MOUTH[0][1] + 3, 17, 18, 3.5);
    }
    if (level >= 4) {
      crack(face, 0, 8);
      face.drip(left[0] - 7, left[1] - 14, 38, 14, 5.5);
      face.blot(NOSE[0] + 2, NOSE[1] - 2, 9, [168, 10, 8], 0.94, 20);
      face.blot(MOUTH[1][0] - 3, MOUTH[1][1] + 2, 12, [148, 6, 6], 0.98, 15);
      face.drip(MOUTH[1][0] - 2, MOUTH[1][1] + 2, 21, 15, 5);
      face.line(left[0] - 8, left[1] + 14, NOSE[0] - 4, NOSE[1] + 10, [70, 3, 5], 0.98, 2);
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
        closeEyes(face);
        tint(face, [200, 20, 10], 0.12);
        damage(face, Math.max(1, level));
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
