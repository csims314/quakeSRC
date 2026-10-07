// Bake cylindrical neck UVs from the existing jaw/nape edge and bare skin.
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smooth = (a, b, value) => { const t = clamp((value - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function sample(image, x, y) {
  const s = clamp(x, 0, image.width - 1.001), t = clamp(y, 0, image.height - 1.001);
  const sx = Math.floor(s), ty = Math.floor(t), fx = s - sx, fy = t - ty;
  const at = (x, y, c) => image.rgba[(y * image.width + x) * 4 + c];
  return [0, 1, 2].map(c => (at(sx, ty, c) * (1 - fx) + at(sx + 1, ty, c) * fx) * (1 - fy)
    + (at(sx, ty + 1, c) * (1 - fx) + at(sx + 1, ty + 1, c) * fx) * fy);
}
export function createNeckTexture({ frontGrid, silhouette, NECK }, skinPatches) {
  return (front, images) => {
    const { width, height, step, yMin, yMax, zTop } = frontGrid;
    const outline = silhouette(front, NECK.start);
    const patch = ([cx, cy]) => {
      const sum = [0, 0, 0];
      for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) {
        const rgb = sample(front, x, y);
        for (let c = 0; c < 3; c++) sum[c] += rgb[c] / 49;
      }
      return sum;
    };
    const [top, bottom] = skinPatches.map(patch), rgba = new Uint8Array(width * height * 4);
    for (let s = 0; s < width; s++) {
      const angle = ((s - 1) / (width - 2) * 2 - 1) * Math.PI;
      const u = Math.sin(angle), back = Math.cos(angle) < 0;
      const y = u < 0 ? -u * outline.left : u * outline.right;
      const x = (back ? yMax - y : y - yMin) / step - 0.5;
      const edge = sample(images[back ? 'back' : 'front'], x, (zTop - NECK.start) / step - 0.5);
      for (let t = 0; t < height; t++) {
        const v = clamp((t - 1) / (height - 2), 0, 1);
        const blend = smooth(0, back ? 0.62 : 0.46, v);
        const skin = top.map((color, c) => color * (1 - v) + bottom[c] * v);
        rgba.set([...edge.map((color, c) => Math.round(color * (1 - blend) + skin[c] * blend)), 255], (t * width + s) * 4);
      }
    }
    return { width, height, rgba };
  };
}
