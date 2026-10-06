// Small geometry helpers for fitting new parts onto vertex-animated models.
import { readFileSync } from 'node:fs';

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = a => Math.hypot(a[0], a[1], a[2]);
export const normalize = a => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const centroid = points => scale(points.reduce(add, [0, 0, 0]), 1 / points.length);

export const apply = ({ rotation: r, translation: t }, p) => [
  r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + t[0],
  r[3] * p[0] + r[4] * p[1] + r[5] * p[2] + t[1],
  r[6] * p[0] + r[7] * p[1] + r[8] * p[2] + t[2],
];

// Jacobi eigenvalue iteration for a small symmetric matrix (row-major, n×n).
function eigenSymmetric(matrix, n) {
  const a = matrix.slice(), v = Array.from({ length: n * n }, (_, i) => (i % (n + 1) ? 0 : 1));
  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p * n + q]) < 1e-30) continue;
      const theta = (a[q * n + q] - a[p * n + p]) / (2 * a[p * n + q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = a[k * n + p], akq = a[k * n + q];
        a[k * n + p] = c * akp - s * akq; a[k * n + q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = a[p * n + k], aqk = a[q * n + k];
        a[p * n + k] = c * apk - s * aqk; a[q * n + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = v[k * n + p], vkq = v[k * n + q];
        v[k * n + p] = c * vkp - s * vkq; v[k * n + q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: Array.from({ length: n }, (_, i) => a[i * n + i]), vectors: v };
}

// Least-squares rigid transform mapping points `from` onto `to` (Horn's quaternion method).
export function rigidFit(from, to) {
  const cf = centroid(from), ct = centroid(to);
  const s = new Array(9).fill(0);
  for (let i = 0; i < from.length; i++) {
    const a = sub(from[i], cf), b = sub(to[i], ct);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) s[r * 3 + c] += a[r] * b[c];
  }
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = s;
  const n = [
    xx + yy + zz, yz - zy, zx - xz, xy - yx,
    yz - zy, xx - yy - zz, xy + yx, zx + xz,
    zx - xz, xy + yx, -xx + yy - zz, yz + zy,
    xy - yx, zx + xz, yz + zy, -xx - yy + zz,
  ];
  const { values, vectors } = eigenSymmetric(n, 4);
  const best = values.indexOf(Math.max(...values));
  const [w, x, y, z] = [0, 1, 2, 3].map(r => vectors[r * 4 + best]);
  const rotation = [
    w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z,
  ];
  const rc = apply({ rotation, translation: [0, 0, 0] }, cf);
  return { rotation, translation: sub(ct, rc) };
}

// Area-weighted vertex normals for a triangle list.
export function vertexNormals(positions, triangles) {
  const normals = positions.map(() => [0, 0, 0]);
  for (const [a, b, c] of triangles) {
    const n = cross(sub(positions[b], positions[a]), sub(positions[c], positions[a]));
    for (const i of [a, b, c]) normals[i] = add(normals[i], n);
  }
  return normals.map(normalize);
}

let anorms;
// The engine's 162 precalculated light normals, read from its own source.
export function lightNormals() {
  if (!anorms) {
    const source = readFileSync(new URL('../../../source/Quake/anorms.h', import.meta.url), 'utf8');
    anorms = [...source.matchAll(/\{\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\}/g)].map(m => [+m[1], +m[2], +m[3]]);
    if (anorms.length !== 162) throw new Error('Unexpected anorms.h contents');
  }
  return anorms;
}

export function nearestLightNormal(normal) {
  let best = 0, bestDot = -Infinity;
  lightNormals().forEach((candidate, i) => { const d = dot(candidate, normal); if (d > bestDot) { bestDot = d; best = i; } });
  return best;
}
