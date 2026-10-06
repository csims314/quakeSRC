export class EngineScene {
  constructor(frame, onStatus) {
    this.frame = frame;
    this.onStatus = onStatus;
    this.current = null;
    this.busy = false;
    this.entities = [];
    this.lastSnapshot = 0;
  }
  get api() {
    return this.frame.contentWindow?.editorScene;
  }
  async load(build, config, project) {
    this.busy = true;
    this.onStatus("Loading engine scene");
    try {
      const fingerprint = JSON.stringify(
        build.gameFingerprint || config.gameFingerprint,
      );
      if (this.fingerprint && this.fingerprint !== fingerprint) {
        await new Promise((resolve) => {
          this.frame.addEventListener("load", resolve, { once: true });
          this.frame.src = `scene.html?assets=${Date.now()}`;
        });
        this.current = null;
      }
      const deadline = Date.now() + 10000;
      while (!this.api) {
        if (Date.now() > deadline)
          throw new Error("Scene adapter did not start");
        await new Promise((r) => setTimeout(r, 50));
      }
      const snapshot = await this.api.load(build, {
        ...config,
        gameFingerprint: build.gameFingerprint || config.gameFingerprint,
      });
      this.fingerprint = fingerprint;
      this.current = { id: build.id, revision: build.revision };
      this.entities = snapshot.entities;
      this.authored = new Map(
        (project?.entities || []).map((e) => [e.id, [...e.position]]),
      );
      this.spawned = new Map(
        snapshot.entities.map((e) => [e.id, [...e.origin]]),
      );
      this.onStatus(`Compiled revision ${build.revision}`);
      return snapshot;
    } finally {
      this.busy = false;
    }
  }
  camera(camera) {
    if (!this.api) return;
    const d = camera.getWorldDirection(camera.position.clone());
    this.api.camera(
      camera.position.toArray(),
      (-Math.atan2(d.z, Math.hypot(d.x, d.y)) * 180) / Math.PI,
      (Math.atan2(d.y, d.x) * 180) / Math.PI,
      camera.fov,
    );
  }
  snapshot() {
    return this.api?.snapshot();
  }
  refreshEntities() {
    if (performance.now() - this.lastSnapshot > 150 && this.current) {
      this.lastSnapshot = performance.now();
      this.entities = this.api?.snapshot().entities || [];
    }
  }
  select(id, overlays) {
    this.api?.select(id, overlays);
  }
  hide(id, hidden) {
    this.api?.hide(id, hidden);
  }
  async thumbnail(native) {
    const center = native.origin.map(
        (v, i) => v + (native.mins[i] + native.maxs[i]) / 2,
      ),
      radius = Math.max(
        24,
        ...native.maxs.map((v, i) => (v - native.mins[i]) / 2),
      );
    const position = center.map((v, i) => v + [1.5, -2, 1][i] * radius),
      direction = center.map((v, i) => v - position[i]);
    return this.api.capture([
      ...position,
      (-Math.atan2(direction[2], Math.hypot(direction[0], direction[1])) *
        180) /
        Math.PI,
      (Math.atan2(direction[1], direction[0]) * 180) / Math.PI,
      40,
    ]);
  }
  preview(entity) {
    const authored = this.authored?.get(entity.id),
      spawned = this.spawned?.get(entity.id);
    const position = entity.position.map(
      (v, i) => v + (authored && spawned ? spawned[i] - authored[i] : 0),
    );
    this.api?.transform(
      entity.id,
      position,
      Number(entity.properties.angle || 0),
    );
  }
  simulate(value) {
    this.api?.simulate(value);
  }
  activate(id) {
    return this.api?.activate(id);
  }
  reset() {
    return this.api?.reset();
  }
}
