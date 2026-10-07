import assert from 'node:assert/strict';
import { cross, dot, sub, normalize } from '../../tools/characters/lib/math.mjs';

export function meshEdges(positions, triangles) {
  const key = p => p.map(v => v.toFixed(4)).join(',');
  const edges = new Map();
  for (const triangle of triangles) for (let k = 0; k < 3; k++) {
    const [a, b] = [key(positions[triangle[k]]), key(positions[triangle[(k + 1) % 3]])];
    const pair = [a, b].sort().join('/');
    if (!edges.has(pair)) edges.set(pair, { count: 0, winding: 0, vertices: [triangle[k], triangle[(k + 1) % 3]] });
    const edge = edges.get(pair);
    edge.count++; edge.winding += a < b ? 1 : -1;
  }
  return [...edges.values()];
}

export function assertClosed(positions, triangles, label) {
  const edges = meshEdges(positions, triangles);
  assert.ok(edges.length > 20, `${label} must contain a surface`);
  assert.ok(edges.every(edge => edge.count === 2 && edge.winding === 0), `${label} must be closed with consistent face winding`);
}

// A ray exits a closed solid an odd number of times from an interior point.
// Merge coincident hits at triangle/atlas seams; inspect actual shipped fine
// positions, including the independently animated head and armor surfaces.
export function insideMesh(point, positions, triangles) {
  const direction = normalize([1, 0.137, 0.061]), hits = [];
  for (const triangle of triangles) {
    const [a, b, c] = triangle.map(i => positions[i]), e1 = sub(b, a), e2 = sub(c, a);
    const h = cross(direction, e2), det = dot(e1, h);
    if (Math.abs(det) < 1e-9) continue;
    const s = sub(point, a), u = dot(s, h) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1), v = dot(direction, q) / det;
    if (v < 0 || u + v > 1) continue;
    const distance = dot(e2, q) / det;
    if (distance > 1e-5) hits.push(distance);
  }
  hits.sort((a, b) => a - b);
  return hits.filter((t, i) => !i || t - hits[i - 1] > 1e-4).length % 2 === 1;
}
