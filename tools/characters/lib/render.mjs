// Software rasterizer for reviewing models without a GPU: textured, lit, z-buffered.
import { sub, cross, dot, normalize, vertexNormals } from './math.mjs';

export function createImage(width, height, background = [24, 22, 20, 255]) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set(background, i * 4);
  return { width, height, rgba, depth: new Float32Array(width * height).fill(Infinity) };
}

// Camera looking from `eye` toward `target`, Quake axes (z up).
export function camera({ eye, target, up = [0, 0, 1], fov = 40, ortho = 0 }) {
  const forward = normalize(sub(target, eye));
  const right = normalize(cross(forward, up));
  const upward = cross(right, forward);
  return { eye, forward, right, up: upward, fov, ortho };
}

function project(cam, image, p) {
  const d = sub(p, cam.eye);
  const x = dot(d, cam.right), y = dot(d, cam.up), z = dot(d, cam.forward);
  const half = cam.ortho || Math.tan((cam.fov * Math.PI) / 360) * z;
  const aspect = image.width / image.height;
  return [
    (x / (half * aspect) * 0.5 + 0.5) * image.width,
    (0.5 - y / half * 0.5) * image.height,
    z,
  ];
}

// mesh: { positions, triangles: [{ v: [a,b,c], uv: [[s,t] x3] }], texture: { width, height, rgba } }
// Triangles are front-facing when clockwise on screen, matching QuakeSpasm.
export function drawMesh(image, mesh, cam, { light = [0.4, -0.5, 0.75], ambient = 0.45, cull = true } = {}) {
  const lightDir = normalize(light);
  // Quake winding makes (b - a) x (c - a) point inward; flip for lighting.
  const normals = vertexNormals(mesh.positions, mesh.triangles.map(t => t.v)).map(n => n.map(v => -v));
  const screen = mesh.positions.map(p => project(cam, image, p));
  const { texture } = mesh;
  for (const tri of mesh.triangles) {
    const [a, b, c] = tri.v.map(i => screen[i]);
    if (a[2] <= 0.1 || b[2] <= 0.1 || c[2] <= 0.1) continue;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (!area || (cull && area < 0)) continue;
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(image.width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(image.height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const inv = [1 / a[2], 1 / b[2], 1 / c[2]];
    const n = tri.v.map(i => normals[i]);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const pw = [w0 * inv[0], w1 * inv[1], w2 * inv[2]], sum = pw[0] + pw[1] + pw[2];
      const depth = cam.ortho ? w0 * a[2] + w1 * b[2] + w2 * c[2] : 1 / sum;
      const index = y * image.width + x;
      if (depth >= image.depth[index]) continue;
      image.depth[index] = depth;
      const k = cam.ortho ? [w0, w1, w2] : pw.map(v => v / sum);
      const s = k[0] * tri.uv[0][0] + k[1] * tri.uv[1][0] + k[2] * tri.uv[2][0];
      const t = k[0] * tri.uv[0][1] + k[1] * tri.uv[1][1] + k[2] * tri.uv[2][1];
      const tx = Math.min(texture.width - 1, Math.max(0, Math.floor(s))), ty = Math.min(texture.height - 1, Math.max(0, Math.floor(t)));
      const normal = normalize([0, 1, 2].map(i => k[0] * n[0][i] + k[1] * n[1][i] + k[2] * n[2][i]));
      const shade = ambient + (1 - ambient) * Math.max(0, dot(normal, lightDir));
      const texel = (ty * texture.width + tx) * 4;
      for (let ch = 0; ch < 3; ch++) image.rgba[index * 4 + ch] = Math.min(255, texture.rgba[texel + ch] * shade);
      image.rgba[index * 4 + 3] = 255;
    }
  }
  return image;
}

// Box-filters an image down by an integer factor (used for anti-aliasing).
export function downsample(image, factor) {
  const width = image.width / factor, height = image.height / factor, rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let ch = 0; ch < 4; ch++) {
    let total = 0;
    for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) total += image.rgba[((y * factor + dy) * image.width + x * factor + dx) * 4 + ch];
    rgba[(y * width + x) * 4 + ch] = Math.round(total / (factor * factor));
  }
  return { width, height, rgba };
}

// Places equally sized images in a grid.
export function sheet(images, columns, gap = 4, background = [12, 11, 10, 255]) {
  const w = images[0].width, h = images[0].height, rows = Math.ceil(images.length / columns);
  const out = createImage(columns * w + (columns + 1) * gap, rows * h + (rows + 1) * gap, background);
  images.forEach((image, i) => {
    const ox = gap + (i % columns) * (w + gap), oy = gap + Math.floor(i / columns) * (h + gap);
    for (let y = 0; y < h; y++) out.rgba.set(image.rgba.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * out.width + ox) * 4);
  });
  return { width: out.width, height: out.height, rgba: out.rgba };
}
