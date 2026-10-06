// Area-average an existing white-background photo into model/HUD source art.
export function createPhotoArt(photo, spec, { maskPixel, erodeRadius = 4 } = {}) {
  if (photo.width !== spec.width || photo.height !== spec.height) throw new Error(`Expected a ${spec.width}x${spec.height} photo`);
  // The background is white; anti-aliased edges are dropped from colour sampling.
  const { width, height, rgba } = photo;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) < 235 ? 1 : 0;
  function erode(source, radius) {
    const pass = (src, horizontal) => {
      const out = new Uint8Array(src.length);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let keep = 1;
        for (let d = -radius; d <= radius && keep; d++) {
          const sx = horizontal ? x + d : x, sy = horizontal ? y : y + d;
          keep = sx >= 0 && sy >= 0 && sx < width && sy < height && src[sy * width + sx];
        }
        out[y * width + x] = keep ? 1 : 0;
      }
      return out;
    };
    return pass(pass(source, true), false);
  }
  if (maskPixel) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!maskPixel(x, y)) mask[y * width + x] = 0;
  }
  const core = erode(mask, erodeRadius);

  // Area-averages a photo rectangle into a texture; alpha is silhouette coverage.
  function sample(x0, y0, size, texelsWide, texelsHigh) {
    const out = new Uint8Array(texelsWide * texelsHigh * 4), known = new Uint8Array(texelsWide * texelsHigh);
    for (let ty = 0; ty < texelsHigh; ty++) for (let tx = 0; tx < texelsWide; tx++) {
      const sx0 = Math.floor(x0 + tx * size), sx1 = Math.min(width, Math.floor(x0 + (tx + 1) * size));
      const sy0 = Math.floor(y0 + ty * size), sy1 = Math.min(height, Math.floor(y0 + (ty + 1) * size));
      const sum = [0, 0, 0];
      let solid = 0, covered = 0, total = 0;
      for (let sy = Math.max(0, sy0); sy < sy1; sy++) for (let sx = Math.max(0, sx0); sx < sx1; sx++) {
        const i = sy * width + sx;
        total++;
        covered += mask[i];
        if (!core[i]) continue;
        solid++;
        for (let c = 0; c < 3; c++) sum[c] += rgba[i * 4 + c];
      }
      const t = ty * texelsWide + tx;
      if (solid) { for (let c = 0; c < 3; c++) out[t * 4 + c] = Math.round(sum[c] / solid); known[t] = 1; }
      out[t * 4 + 3] = total ? Math.round((covered / total) * 255) : 0;
    }
    // Fill colour outward from the silhouette so filtering never reaches white.
    for (let changed = true; changed;) {
      changed = false;
      const next = known.slice();
      for (let ty = 0; ty < texelsHigh; ty++) for (let tx = 0; tx < texelsWide; tx++) {
        const t = ty * texelsWide + tx;
        if (known[t]) continue;
        const sum = [0, 0, 0];
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = tx + dx, ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= texelsWide || ny >= texelsHigh || !known[ny * texelsWide + nx]) continue;
          for (let c = 0; c < 3; c++) sum[c] += out[(ny * texelsWide + nx) * 4 + c];
          n++;
        }
        if (!n) continue;
        for (let c = 0; c < 3; c++) out[t * 4 + c] = Math.round(sum[c] / n);
        next[t] = 1;
        changed = true;
      }
      known.set(next);
    }
    return out;
  }

  const { front, hud } = spec;
  return {
    front: { width: front.width, height: front.height, rgba: sample(front.x, front.y, front.pixelsPerTexel, front.width, front.height) },
    hud: { width: hud.texels, height: hud.texels, rgba: sample(hud.x, hud.y, hud.size / hud.texels, hud.texels, hud.texels) },
  };
}
