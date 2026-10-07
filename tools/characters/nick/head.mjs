// Nick's photo measurements and long-hair head profile.
import { readFileSync } from 'node:fs';
import { decodePng } from '../lib/png.mjs';
import { createPhotoHead } from '../lib/photo-head.mjs';
const spec = JSON.parse(readFileSync(new URL('photo.json', import.meta.url), 'utf8'));
const front = () => decodePng(readFileSync(new URL('art/front.png', import.meta.url)));
const skinWeight = (_y, z) => {
  const t = Math.max(0, Math.min(1, (-z - 4.5) / 1.9));
  return 1 - t * t * (3 - 2 * t);
};
export const { photo, toLocal, frontGrid, sideGrid, surfaceX, EDGE_INSET, loadFront, silhouette, RINGS, buildHead: photoHead } =
  createPhotoHead(spec, front, { depthScale: 0.78, sidePanels: true, sideBottom: -4.5, frontSamples: 25, backSamples: 11, skinWeight });

// Long hair and the neck are different surfaces. Keep the hanging hair, remove
// the old flat photo neck below the beard, and insert a rounded skin neck.
export function buildHead(image, options) {
  if (options?.rings) return photoHead(image, options); // detached gib head has no torso joint
  // The lowest photo rows include clothing. Hair ends at the collar; the
  // designed neck continues beneath it without those flat clothing panels.
  const head = photoHead(image, { rings: RINGS.filter(z => z >= -5.35), bottom: -5.6 });
  const triangles = head.triangles.filter(t => {
    const v = t.map(i => head.vertices[i]);
    // The hanging hair has open tips, not a broad solid plug under the neck.
    if (v.every(p => p.position[2] <= -5.35)) return false;
    const midZ = v.reduce((sum, p) => sum + p.position[2], 0) / 3;
    const midY = v.reduce((sum, p) => sum + p.position[1], 0) / 3;
    const row = Math.max(0, Math.min(image.height - 1, Math.round((frontGrid.zTop - midZ) / frontGrid.step - 0.5)));
    const column = Math.max(0, Math.min(image.width - 1, Math.round((midY - frontGrid.yMin) / frontGrid.step - 0.5)));
    const gap = image.rgba[(row * image.width + column) * 4 + 3] < 128;
    return !(v.every(p => p.side === 'front') && midZ < -4.3
      && (Math.abs(midY) < 1.85 || gap));
  });
  const vertices = [], remap = new Map();
  for (const t of triangles) for (let k = 0; k < 3; k++) {
    const old = t[k];
    if (!remap.has(old)) { remap.set(old, vertices.length); vertices.push(head.vertices[old]); }
    t[k] = remap.get(old);
  }
  const slices = 24, levels = [-4.35, -4.8, -5.3, -5.8, -6.2, -6.6];
  const rings = [];
  for (const z of levels) {
    const t = (levels[0] - z) / (levels[0] - levels.at(-1)), ring = [];
    for (let i = 0; i <= slices; i++) {
      const angle = i / slices * 2 * Math.PI;
      ring.push(vertices.length);
      // The upper neck sits forward under the jaw; its base returns to the
      // body's collar axis. This hides the joint inside the beard volume.
      vertices.push({ position: [0.65 - 0.55 * t + (1.35 + 0.1 * t) * Math.cos(angle), (1.3 + 0.2 * t) * Math.sin(angle), z],
        uv: [1 + i / slices * (frontGrid.width - 2), 1 + t * (frontGrid.height - 2)], side: 'neck', weight: skinWeight(0, z) });
    }
    rings.push(ring);
  }
  for (let r = 0; r + 1 < rings.length; r++) for (let i = 0; i < slices; i++) {
    const [a, b, c, d] = [rings[r][i], rings[r][i + 1], rings[r + 1][i + 1], rings[r + 1][i]];
    triangles.push([a, b, c], [a, c, d]);
  }
  // Both ends overlap existing geometry (beard above, torso below).
  return { vertices, triangles };
}
