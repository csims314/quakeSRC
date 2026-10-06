// Helpers for swapping a part of a vertex-animated model for new geometry.
import { framePositions } from './mdl.mjs';
import { rigidFit, apply, centroid, vertexNormals, nearestLightNormal } from './math.mjs';

// Connected vertex groups, joined through shared triangle corners.
export function components(model) {
  const parent = model.stverts.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const t of model.triangles) for (const v of t.v.slice(1)) parent[find(v)] = find(t.v[0]);
  const groups = new Map();
  model.stverts.forEach((_, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  });
  return [...groups.values()];
}

export const allFramePositions = model => model.frames.map(frame => framePositions(model, frame));

// Rigid motion of a vertex set from the reference frame into every frame.
export function track(frames, reference, indices) {
  const from = indices.map(i => frames[reference][i]);
  return frames.map(positions => rigidFit(from, indices.map(i => positions[i])));
}

// Linear blend of two rigid motions per vertex (weight 1 follows `primary`).
export const blend = (primary, secondary, point, weight) => {
  const a = apply(primary, point), b = apply(secondary, point);
  return [0, 1, 2].map(k => a[k] * weight + b[k] * (1 - weight));
};

// Light normal indices for new geometry; seam duplicates share one smooth normal.
export function lightNormals(positions, triangles) {
  const key = p => p.map(v => v.toFixed(4)).join(',');
  const canonical = new Map(), welded = positions.map((p, i) => {
    const k = key(p);
    if (!canonical.has(k)) canonical.set(k, i);
    return canonical.get(k);
  });
  // Quake triangles are clockwise, so flip the computed normals outward.
  const normals = vertexNormals(positions, triangles.map(t => t.map(i => welded[i])));
  return welded.map(i => nearestLightNormal(normals[i].map(v => -v)));
}

export const groupCentroid = (positions, indices) => centroid(indices.map(i => positions[i]));
