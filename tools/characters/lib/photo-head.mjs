import { sub, cross, dot, centroid } from './math.mjs';

// Silhouette-driven head mesh with configurable depth, crown and neck weights.
export function createPhotoHead(photo, loadFront, { profile = {}, rings, crown = 3.67, skinWeight,
  frontSamples = 15, backSamples = 7, depthScale = 1, sidePanels = false, sideBottom = -Infinity, outlineAt } = {}) {
  const UNIT = 1 / photo.pixelsPerUnit;
  const [CX, CY] = photo.center;
  const toLocal = ([px, py]) => [(px - CX) * UNIT, (CY - py) * UNIT];

  // Front texture placement in head-local units; the back uses the same grid, mirrored.
  const frontGrid = (() => {
    const { x, y, width, height, pixelsPerTexel } = photo.front;
    const step = pixelsPerTexel * UNIT;
    return { width, height, step, yMin: (x - CX) * UNIT, yMax: (x - CX) * UNIT + width * step, zTop: (CY - y) * UNIT };
  })();

  // The photo's silhouette edge is lightened by flyaway strands against the white
  // background, so textures sample hair from this far inside it.
  const EDGE_INSET = 0.12;


  // Silhouette runs (y ranges) of one texel row.
  function rowRuns(front, row) {
    const runs = [];
    let start = -1;
    for (let x = 0; x <= front.width; x++) {
      const on = x < front.width && front.rgba[(row * front.width + x) * 4 + 3] >= 128;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start >= 3) runs.push([frontGrid.yMin + start * frontGrid.step, frontGrid.yMin + x * frontGrid.step]);
        start = -1;
      }
    }
    return runs;
  }

  function silhouette(front, z) {
    const designed = outlineAt?.(z);
    if (designed) return designed;
    const row = Math.round((frontGrid.zTop - z) / frontGrid.step - 0.5);
    const rows = [];
    for (let r = row - 2; r <= row + 2; r++) {
      const runs = rowRuns(front, Math.max(0, Math.min(front.height - 1, r)));
      if (runs.length) rows.push(runs);
    }
    if (!rows.length) return null;
    const average = values => values.reduce((a, b) => a + b, 0) / values.length;
    const own = rowRuns(front, Math.max(0, Math.min(front.height - 1, row)));
    const runs = own.length ? own : rows[0];
    const core = runs.reduce((best, run) => (Math.abs((run[0] + run[1]) / 2) < Math.abs((best[0] + best[1]) / 2) ? run : best));
    return {
      left: average(rows.map(r => r[0][0])),
      right: average(rows.map(r => r.at(-1)[1])),
      runs,
      core,
    };
  }

  const smooth = (a, b, t) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
  function table(zs, values) {
    return z => {
      if (z >= zs[0]) return values[0];
      for (let i = 1; i < zs.length; i++) if (z >= zs[i]) {
        const t = (zs[i - 1] - z) / (zs[i - 1] - zs[i]);
        return values[i - 1] + (values[i] - values[i - 1]) * (t * t * (3 - 2 * t));
      }
      return values.at(-1);
    };
  }

  const Z = profile.z ?? [3.67, 3.4, 3.0, 2.6, 2.2, 1.6, 1.0, 0.6, 0.0, -0.6, -1.2, -1.8, -2.4, -3.0, -3.6, -4.2, -4.9, -5.4, -6.0, -6.6];
  const frontDepth = table(Z, profile.front ?? [-0.3, 1.3, 2.2, 2.7, 3.0, 3.2, 3.3, 3.35, 3.2, 3.2, 3.25, 3.3, 3.35, 3.3, 3.2, 2.95, 2.4, 1.7, 1.45, 1.4]);
  const sideDepth = table(Z, profile.side ?? [-0.4, -0.4, -0.4, -0.4, -0.4, -0.45, -0.5, -0.5, -0.5, -0.5, -0.55, -0.6, -0.7, -0.8, -0.9, -1.0, -1.0, -1.0, -0.9, -0.8]);
  const backDepth = table(Z, profile.back ?? [-0.5, -1.5, -2.4, -3.0, -3.4, -3.7, -3.85, -3.9, -3.9, -3.85, -3.75, -3.6, -3.5, -3.45, -3.4, -3.35, -3.3, -3.2, -2.7, -2.2]);
  const sideGrid = {
    ...frontGrid,
    xMin: Math.min(...(profile.back ?? [-3.9])) * depthScale,
    xMax: (Math.max(...(profile.front ?? [3.35])) + 1.3) * depthScale,
  };
  const superellipse = (u, p, q) => Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(u)), p)), 1 / q);
  const gauss = (v, s) => Math.exp(-((v / s) ** 2));

  const L = photo.landmarks;
  const eyeY = (toLocal(L.eyes[1])[0] - toLocal(L.eyes[0])[0]) / 2;
  const noseTip = toLocal(L.noseTip);
  const browZ = toLocal([0, L.brows])[1];
  const mouthZ = (toLocal(L.mouth[0])[1] + toLocal(L.mouth[1])[1]) / 2;
  const mouthY = (toLocal(L.mouth[1])[0] - toLocal(L.mouth[0])[0]) / 2;
  const chinZ = toLocal([0, L.chin])[1];

  // Facial relief added to the front surface, faded out toward the hair.
  function relief(y, z) {
    const ay = Math.abs(y), ny = y - noseTip[0];
    const noseHeight = table([0.6, 0.0, -0.6, noseTip[1], noseTip[1] - 0.3, noseTip[1] - 0.6], [0, 0.22, 0.5, 0.92, 0.25, 0])(z);
    const noseWidth = table([0.6, noseTip[1], noseTip[1] - 0.6], [0.26, 0.4, 0.45])(z);
    let x = noseHeight * Math.exp(-(ny * ny) / (2 * noseWidth * noseWidth));
    x += 0.22 * gauss(Math.abs(ny) - 0.62, 0.2) * gauss(z - (noseTip[1] - 0.07), 0.22);
    x += 0.16 * gauss(z - browZ, 0.22) * (1 - smooth(1.9, 2.4, ay));
    x -= 0.25 * gauss(ay - eyeY, 0.38) * gauss(z + 0.02, 0.3);
    x += 0.18 * gauss(ay - 1.55, 0.55) * gauss(z + 1.0, 0.5);
    x += 0.1 * Math.exp(-((y / (mouthY * 0.9)) ** 4)) * gauss(z - (mouthZ - 0.2), 0.3);
    x -= 0.1 * gauss(ay - mouthY, 0.18) * gauss(z - mouthZ, 0.18);
    x += 0.35 * gauss(ay - 1.9, 0.5) * gauss(z + 3.0, 1.0);
    x += 0.2 * gauss(y, 1.4) * gauss(z - (chinZ + 0.45), 0.7);
    const face = 1 - smooth(0.85, 1.05, Math.hypot(y / 2.45, (z + 1.0) / (z > -1.0 ? 3.8 : 3.9)));
    return x * face;
  }

  function frontX(y, z, outline) {
    const xs = sideDepth(z), xf = frontDepth(z);
    const { runs, core } = outline;
    if (runs.length > 1) {
      const run = runs.find(r => y >= r[0] && y <= r[1]);
      if (!run) return xs + 0.2;
      const center = (run[0] + run[1]) / 2, half = (run[1] - run[0]) / 2;
      if (run !== core) return xs + (0.5 - xs) * superellipse((y - center) / half, 2, 2);
      return xs + (xf - xs) * superellipse((y - center) / half, 2.3, 2) + relief(y, z);
    }
    const u = y < 0 ? y / outline.left : y / outline.right;
    return xs + (xf - xs) * superellipse(u, 2.3, 2) + relief(y, z);
  }

  // Used when baking the side atlas: invert the surface to find the matching
  // front/back texel at the join, rather than stretching the photo's edge.
  function surfaceX(y, z, outline, back = false) {
    if (!back) return frontX(y, z, outline) * depthScale;
    const u = y < 0 ? y / outline.left : y / outline.right;
    return (sideDepth(z) - (sideDepth(z) - backDepth(z)) * superellipse(u, 2.2, 2.2)) * depthScale;
  }

  const RINGS = rings ?? [3.5, 3.2, 2.8, 2.35, 1.9, 1.45, 1.05, 0.7, 0.35, 0.0, -0.35, -0.7, -1.0, -1.3, -1.6, -1.95, -2.3, -2.65, -3.05, -3.5, -4.0, -4.5, -4.95, -5.35, -5.75, -6.15];
  const FRONT_SAMPLES = frontSamples, BACK_SAMPLES = backSamples;

  // Returns vertices with head-local positions, front/back UVs (in front-grid texels),
  // skinning weights toward the head (1) or chest (0), and triangles.
  function buildHead(front, { rings = RINGS, bottom = rings.at(-1) - 0.25 } = {}) {
    const vertices = [], triangles = [];
    const uv = (y, z, side) => [
      side === 'front' ? (y - frontGrid.yMin) / frontGrid.step : (frontGrid.yMax - y) / frontGrid.step,
      (frontGrid.zTop - z) / frontGrid.step,
    ];
    const weight = (y, z, frontFacing) => {
      if (skinWeight) return skinWeight(y, z, frontFacing);
      const beard = frontFacing && Math.abs(y) < 1.6;
      return beard ? 1 - 0.6 * smooth(-4.9, -6.4, z) : 1 - 0.65 * smooth(-2.8, -6.0, z);
    };
    const add = (position, side, frontFacing, uvY = position[1]) => {
      vertices.push({ position, uv: uv(uvY, position[2], side), side, weight: weight(position[1], position[2], frontFacing) });
      return vertices.length - 1;
    };
    const ringIndices = [];
    for (const z of rings) {
      const outline = silhouette(front, z);
      const xs = sideDepth(z), xb = backDepth(z);
      const fronts = [], backs = [];
      for (let k = 0; k < FRONT_SAMPLES; k++) {
        const v = -1 + (2 * k) / (FRONT_SAMPLES - 1), u = Math.sign(v) * Math.abs(v) ** 1.35;
        const y = u < 0 ? -u * outline.left : u * outline.right;
        // At the sides, look up the front texture just inside the photo's light edge,
        // where the back texture starts too, so the seam blends.
        const uvY = Math.max(outline.left + EDGE_INSET, Math.min(outline.right - EDGE_INSET, y));
        fronts.push(add([k === 0 || k === FRONT_SAMPLES - 1 ? xs : frontX(y, z, outline), y, z], 'front', true, uvY));
      }
      backs.push(add([...vertices[fronts.at(-1)].position], 'back', false));
      for (let j = 0; j < BACK_SAMPLES; j++) {
        const c = Math.cos((Math.PI * (j + 1)) / (BACK_SAMPLES + 1));
        const y = c >= 0 ? c * outline.right : -c * outline.left;
        backs.push(add([xs - (xs - xb) * superellipse(c, 2.2, 2.2), y, z], 'back', false));
      }
      backs.push(add([...vertices[fronts[0]].position], 'back', false));
      ringIndices.push({ fronts, backs });
    }
    const quad = (a, b, c, d) => {
      // Split along the shorter diagonal for better-shaped triangles.
      const pa = vertices[a].position, pb = vertices[b].position, pc = vertices[c].position, pd = vertices[d].position;
      if (Math.hypot(...sub(pa, pc)) <= Math.hypot(...sub(pb, pd))) triangles.push([a, b, c], [a, c, d]);
      else triangles.push([a, b, d], [b, c, d]);
    };
    for (let r = 0; r + 1 < ringIndices.length; r++) {
      for (const strip of ['fronts', 'backs']) {
        const upper = ringIndices[r][strip], lower = ringIndices[r + 1][strip];
        for (let k = 0; k + 1 < upper.length; k++) quad(upper[k], upper[k + 1], lower[k + 1], lower[k]);
      }
    }
    // Close the crown and the hidden bottom with poles.
    const cap = (ring, z, x, downward) => {
      const ys = ring.fronts.map(i => vertices[i].position[1]);
      const y = (Math.min(...ys) + Math.max(...ys)) / 2;
      for (const strip of ['fronts', 'backs']) {
        const pole = add([x, y, z], strip === 'fronts' ? 'front' : 'back', strip === 'fronts');
        const list = ring[strip];
        // Same winding as the strips, with one ring collapsed to the pole.
        for (let k = 0; k + 1 < list.length; k++) triangles.push(downward ? [list[k], list[k + 1], pole] : [list[k + 1], list[k], pole]);
      }
    };
    cap(ringIndices[0], crown, -0.35, false);
    cap(ringIndices.at(-1), bottom, -0.6, true);
    // Quake treats clockwise triangles as front faces: (b - a) x (c - a) must point inward.
    const axis = z => [-0.4, 0, z];
    let outward = 0;
    const live = triangles.filter(([a, b, c]) => {
      const [pa, pb, pc] = [a, b, c].map(i => vertices[i].position);
      const n = cross(sub(pb, pa), sub(pc, pa));
      if (Math.hypot(...n) < 1e-6) return false;
      const mid = centroid([pa, pb, pc]);
      if (dot(n, sub(mid, axis(mid[2]))) > 0) outward++;
      return true;
    });
    if (outward > live.length / 2) for (const t of live) [t[1], t[2]] = [t[2], t[1]];
    for (const vertex of vertices) vertex.position[0] *= depthScale;
    if (!sidePanels) return { vertices, triangles: live };

    // Each projection owns its UVs. Shared positions stay welded for lighting;
    // only vertices at an atlas join are duplicated. Side UVs run along depth,
    // so a cheek/ear texel can no longer smear across the whole side of a head.
    const mapped = [], remap = new Map();
    const trianglesWithPanels = live.map(triangle => {
      const mid = centroid(triangle.map(i => vertices[i].position));
      const outline = silhouette(front, Math.max(RINGS.at(-1), Math.min(RINGS[0], mid[2])));
      const width = mid[1] < 0 ? -outline.left : outline.right;
      const panel = mid[2] >= sideBottom && Math.abs(mid[1]) / width > 0.72
        ? (mid[1] < 0 ? 'left' : 'right') : vertices[triangle[0]].side;
      return triangle.map(i => {
        const key = `${i}/${panel}`;
        if (remap.has(key)) return remap.get(key);
        const vertex = vertices[i];
        const uv = panel === 'left' || panel === 'right' ? [
          (vertex.position[0] - sideGrid.xMin) / (sideGrid.xMax - sideGrid.xMin) * sideGrid.width,
          (sideGrid.zTop - vertex.position[2]) / sideGrid.step,
        ] : vertex.uv;
        remap.set(key, mapped.length);
        mapped.push({ ...vertex, side: panel, uv });
        return mapped.length - 1;
      });
    });
    return { vertices: mapped, triangles: trianglesWithPanels };
  }

  return { photo, toLocal, frontGrid, sideGrid, surfaceX, EDGE_INSET, loadFront, silhouette, RINGS, buildHead };
}
