// Bake the column from bare skin sampled beneath the chin, avoiding the
// photograph's beard, hair and shirt at the edge of the head.
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function sample(image, x, y) {
  const s = clamp(x, 0, image.width - 1.001), t = clamp(y, 0, image.height - 1.001);
  const sx = Math.floor(s), ty = Math.floor(t), fx = s - sx, fy = t - ty;
  const at = (x, y, c) => image.rgba[(y * image.width + x) * 4 + c];
  return [0, 1, 2].map(c => (at(sx, ty, c) * (1 - fx) + at(sx + 1, ty, c) * fx) * (1 - fy)
    + (at(sx, ty + 1, c) * (1 - fx) + at(sx + 1, ty + 1, c) * fx) * fy);
}
export function createNeckTexture({ frontGrid }, skinPatches) {
  return front => {
    const { width, height } = frontGrid;
    const patch = ([cx, cy]) => {
      const sum = [0, 0, 0];
      for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) {
        const rgb = sample(front, x, y);
        for (let c = 0; c < 3; c++) sum[c] += rgb[c] / 49;
      }
      return sum;
    };
    const [top, bottom, underside = top] = skinPatches.map(patch), rgba = new Uint8Array(width * height * 4);
    for (let s = 0; s < width; s++) {
      for (let t = 0; t < height; t++) {
        const v = clamp((t - 1) / (height - 2), 0, 1);
        const skin = s >= width - 16 ? underside
          : top.map((color, c) => color * (1 - v) + bottom[c] * v);
        rgba.set([...skin.map(Math.round), 255], (t * width + s) * 4);
      }
    }
    return { width, height, rgba };
  };
}
