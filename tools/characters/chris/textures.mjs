// Photo-projected face and ears; the unseen back uses the photo's own hair/neck.
import { photo, frontGrid, silhouette } from './head.mjs';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function sample(front, px, py) {
  const s = clamp(Math.round((px - photo.front.x) / photo.front.pixelsPerTexel), 0, front.width - 1);
  const t = clamp(Math.round((py - photo.front.y) / photo.front.pixelsPerTexel), 0, front.height - 1);
  return [...front.rgba.subarray((t * front.width + s) * 4, (t * front.width + s) * 4 + 3)];
}

export function frontTexture(front) {
  // Source art already extends edge colors into transparent space for mipmaps.
  const rgba = Uint8Array.from(front.rgba);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { width: front.width, height: front.height, rgba };
}

export function backTexture(front) {
  const { width, height, step, yMax, zTop } = frontGrid;
  const rgba = new Uint8Array(width * height * 4);
  for (let t = 0; t < height; t++) {
    const z = zTop - (t + 0.5) * step;
    const outline = silhouette(front, clamp(z, -4.15, 3.5));
    for (let s = 0; s < width; s++) {
      const y = yMax - (s + 0.5) * step;
      const u = clamp((y - outline.left) / (outline.right - outline.left), 0, 1);
      // Tile a patch of the real curls over the back, with grey temple tones.
      const hair = sample(front, 263 + u * 235, 173 + Math.abs((t * 0.7) % 100 - 50));
      const temple = sample(front, u < 0.5 ? 207 : 545, 335 + (t % 12));
      const grey = (1 - smooth(0.1, 0.45, Math.min(u, 1 - u))) * 0.4;
      const neck = sample(front, 340 + u * 70, 781 + (s % 12));
      const skin = 1 - smooth(-2.1, -1.4, z);
      const back = hair.map((v, c) => (v * (1 - grey) + temple[c] * grey) * (1 - skin) + neck[c] * skin);
      // Match the front at each side seam, including the visible ears.
      const edgeY = u < 0.5 ? outline.left + 0.12 : outline.right - 0.12;
      const edge = sample(front, photo.center[0] + edgeY * photo.pixelsPerUnit,
        photo.center[1] - z * photo.pixelsPerUnit);
      const seam = 1 - smooth(0, 0.1, Math.min(u, 1 - u));
      rgba.set([...back.map((v, c) => Math.round(clamp(v * (1 - seam) + edge[c] * seam, 0, 255))), 255], (t * width + s) * 4);
    }
  }
  return { width, height, rgba };
}
