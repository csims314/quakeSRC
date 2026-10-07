// A code-drawn slipgate emblem, rasterized for browser/Home Screen icons.
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodePng } from './characters/lib/png.mjs';
const output = new URL('../web/dist/icons/', import.meta.url);
mkdirSync(output, { recursive: true });
for (const size of [180, 192, 512]) {
  const rgba = new Uint8Array(size * size * 4), samples = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let coverage = 0;
    for (let dy = 0; dy < samples; dy++) for (let dx = 0; dx < samples; dx++) {
      const u = (x + (dx + 0.5) / samples) / size, v = (y + (dy + 0.5) / samples) / size;
      const radius = Math.hypot(u - 0.5, v - 0.43);
      const ring = Math.abs(radius - 0.29) < 0.035 && !(v > 0.66 && Math.abs(u - 0.5) < 0.13);
      const stem = Math.abs(u - 0.5) < 0.028 && v > 0.18 && v < 0.89;
      const prong = (Math.abs(u - 0.34) < 0.028 || Math.abs(u - 0.66) < 0.028) && v > 0.65 && v < 0.78;
      if (ring || stem || prong) coverage++;
    }
    const alpha = coverage / (samples * samples), i = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.round([17, 16, 14][c] * (1 - alpha) + [202, 140, 72][c] * alpha);
    rgba[i + 3] = 255;
  }
  writeFileSync(new URL('quake-' + size + '.png', output), encodePng(size, size, rgba));
}
console.log('Built Quake web-app icons.');
