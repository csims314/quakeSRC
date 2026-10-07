import { frontGrid } from './head.mjs';

// Bare neck colors from the photo, used on a cylindrical UV surface rather
// than projecting the beard/side hair onto the throat.
export function neckTexture(front) {
  const { width, height } = frontGrid, rgba = new Uint8Array(width * height * 4);
  const average = (cx, cy) => {
    const sum = [0, 0, 0]; let count = 0;
    for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) {
      const i = (y * front.width + x) * 4;
      if (front.rgba[i + 3] < 128) continue;
      for (let c = 0; c < 3; c++) sum[c] += front.rgba[i + c];
      count++;
    }
    if (!count) throw new Error('Nick photo is missing bare neck skin');
    return sum.map(v => v / count);
  };
  const top = average(153, 305), bottom = average(153, 325);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = y / (height - 1);
    rgba.set([...top.map((v, c) => Math.round(v * (1 - t) + bottom[c] * t)), 255], (y * width + x) * 4);
  }
  return { width, height, rgba };
}
