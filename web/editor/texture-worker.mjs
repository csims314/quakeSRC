self.onmessage = ({ data: { rgba, palette, width, height } }) => {
  try {
    const pixels = new Uint8Array(width * height),
      cache = new Map();
    for (let i = 0; i < pixels.length; i++) {
      const offset = i * 4,
        key = (rgba[offset] << 16) | (rgba[offset + 1] << 8) | rgba[offset + 2];
      let color = cache.get(key);
      if (color === undefined) {
        let best = Infinity;
        color = 0;
        for (let c = 0; c < 224; c++) {
          const d =
            (rgba[offset] - palette[c * 3]) ** 2 +
            (rgba[offset + 1] - palette[c * 3 + 1]) ** 2 +
            (rgba[offset + 2] - palette[c * 3 + 2]) ** 2;
          if (d < best) {
            best = d;
            color = c;
          }
        }
        if (cache.size < 65536) cache.set(key, color);
      }
      pixels[i] = color;
    }
    self.postMessage({ pixels }, [pixels.buffer]);
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
