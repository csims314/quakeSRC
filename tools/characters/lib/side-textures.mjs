// Project a real profile along head depth. Front/back colors blend into the
// atlas joins, while the broad side uses its own ear, skin and hair detail.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function interpolate(points, value) {
  if (value <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) if (value <= points[i][0]) {
    const t = (value - points[i - 1][0]) / (points[i][0] - points[i - 1][0]);
    return points[i - 1][1] * (1 - t) + points[i][1] * t;
  }
  return points.at(-1)[1];
}
function sample(image, s, t) {
  const x = clamp(s, 0, image.width - 1.001), y = clamp(t, 0, image.height - 1.001);
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const at = (x, y, c) => image.rgba[(y * image.width + x) * 4 + c];
  return [0, 1, 2].map(c => (at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx) * (1 - fy)
    + (at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx) * fy);
}

// Extend the cutout's colors into transparent space for interpolation at the
// crown and neck. The original source image keeps its transparency on disk.
function extendColors(image) {
  const rgba = Uint8Array.from(image.rgba), count = image.width * image.height;
  const known = new Uint8Array(count), queue = new Int32Array(count);
  let first = 0, last = 0;
  for (let i = 0; i < count; i++) if (rgba[i * 4 + 3] >= 128) { known[i] = 1; queue[last++] = i; }
  if (!last) throw new Error('The profile texture is empty');
  while (first < last) {
    const i = queue[first++], x = i % image.width;
    for (const n of [x ? i - 1 : -1, x + 1 < image.width ? i + 1 : -1, i - image.width, i + image.width]) {
      if (n < 0 || n >= count || known[n]) continue;
      known[n] = 1; queue[last++] = n;
      rgba.set(rgba.subarray(i * 4, i * 4 + 3), n * 4);
    }
  }
  return { ...image, rgba };
}

export function createSideTextures({ frontGrid, sideGrid, silhouette, surfaceX, RINGS, NECK }, loadProfile, landmarks) {
  const xMap = [...landmarks.x].sort((a, b) => a[0] - b[0]);
  const zMap = [...landmarks.z].sort((a, b) => a[0] - b[0]);
  return (front, images) => {
    const profile = extendColors(loadProfile());
    const { width, height, xMin, xMax, zTop, step } = sideGrid;
    const original = { ...images };
    const amountAt = (u, z) => smooth(0.62, 0.90, u)
      * (landmarks.fadeBottom ? smooth(...landmarks.fadeBottom, z) : 1);
    const detailAt = (x, z) => sample(profile, interpolate(xMap, x), interpolate(zMap, z));
    // Blend the same profile into the peripheral front/back texels as well.
    // Both projections then agree at their shared positions; the center of
    // the original face (including its eyes, nose and mouth) stays untouched.
    for (const [name, back] of [['front', false], ['back', true]]) {
      const rgba = Uint8Array.from(original[name].rgba);
      for (let t = 0; t < height; t++) {
        const z = zTop - (t + 0.5) * step;
        const outline = silhouette(front, clamp(z, NECK?.start ?? RINGS.at(-1), RINGS[0]));
        for (let s = 0; s < width; s++) {
          const y = back ? frontGrid.yMax - (s + 0.5) * step : frontGrid.yMin + (s + 0.5) * step;
          const half = y < 0 ? -outline.left : outline.right;
          const u = clamp(Math.abs(y) / half, 0, 1), amount = amountAt(u, z);
          if (!amount) continue;
          const detail = detailAt(surfaceX(Math.sign(y) * half * u, z, outline, back), z);
          const i = (t * width + s) * 4;
          for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(rgba[i + c] * (1 - amount) + detail[c] * amount);
        }
      }
      images[name] = { width, height, rgba };
    }
    const sides = {};
    for (const [name, sign] of [['left', -1], ['right', 1]]) {
      const rgba = new Uint8Array(width * height * 4);
      for (let t = 0; t < height; t++) {
        const z = zTop - (t + 0.5) * step;
        const outline = silhouette(front, clamp(z, NECK?.start ?? RINGS.at(-1), RINGS[0]));
        const half = sign < 0 ? -outline.left : outline.right;
        // Tables invert both curves once per row, instead of searching the
        // full mesh for every pixel. Include ears and beard relief in the fit.
        const curves = [false, true].map(back => Array.from({ length: 97 }, (_, i) => {
          const u = i / 96;
          return { u, x: surfaceX(sign * half * u, z, outline, back) };
        }));
        for (let s = 0; s < width; s++) {
          const x = xMin + (s + 0.5) / width * (xMax - xMin);
          const back = x < curves[0].at(-1).x;
          const curve = curves[back ? 1 : 0];
          let nearest = curve[0];
          for (const p of curve) if (Math.abs(p.x - x) < Math.abs(nearest.x - x)) nearest = p;
          const y = sign * half * nearest.u;
          const oldS = back ? (frontGrid.yMax - y) / frontGrid.step - 0.5 : (y - frontGrid.yMin) / frontGrid.step - 0.5;
          const old = sample(original[back ? 'back' : 'front'], oldS, t);
          const detail = detailAt(x, z);
          const amount = amountAt(nearest.u, z);
          rgba.set([...old.map((v, c) => Math.round(v * (1 - amount) + detail[c] * amount)), 255], (t * width + s) * 4);
        }
      }
      sides[name] = { width, height, rgba };
    }
    return sides;
  };
}
