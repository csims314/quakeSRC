/* The Scene uses the same engine factory/assets as play.mjs. It never mounts
 * persistent saves, connects to a server, or mutates the authoring document. */
const canvas = document.getElementById("scene-canvas"),
  status = document.getElementById("status");
let engine,
  ready = false,
  loaded = null,
  busy = false,
  simulating = false,
  cameraLock = false,
  lastCamera;
const logs = [],
  errors = [],
  bytesCache = new Map();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digest = async (bytes) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
async function asset(url, expected) {
  if (bytesCache.has(expected)) return bytesCache.get(expected);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Scene asset unavailable: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await digest(bytes)) !== expected)
    throw new Error("Scene asset integrity check failed");
  bytesCache.set(expected, bytes);
  return bytes;
}
const command = (value) =>
  engine?.ccall("Web_Command", null, ["string"], [value]);
const state = () =>
  engine ? JSON.parse(engine.ccall("Web_State", "string", [], [])) : null;
function size() {
  if (!engine || !ready) return;
  const width = Math.max(64, Math.min(4096, innerWidth)),
    height = Math.max(64, Math.min(4096, innerHeight));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    engine.ccall(
      "Web_EditorViewport",
      null,
      ["number", "number"],
      [width, height],
    );
  }
}
async function wait(fn, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (errors.length) throw new Error(errors.at(-1));
    if (fn()) return;
    await delay(50);
  }
  throw new Error(`Scene ${label} timed out. ${logs.slice(-6).join(" ")}`);
}
async function load(build, config) {
  if (busy) throw new Error("Scene is loading");
  busy = true;
  status.textContent = "Loading game-rendered scene…";
  try {
    if (!engine) {
      engine = await createQuakeSpasm({
        canvas,
        noInitialRun: true,
        locateFile: (name) => `../engine/${name}`,
        print: (line) => {
          logs.push(String(line));
          if (logs.length > 120) logs.shift();
          if (String(line).includes("Quake Initialized")) ready = true;
        },
        printErr: (line) => logs.push(String(line)),
        onAbort: (reason) => errors.push(String(reason)),
      });
      if (!engine._Web_EditorMode)
        throw new Error(
          "Rebuild the engine with build-web.cmd to enable Scene rendering",
        );
      engine.FS.mkdirTree("/quake/id1");
      engine.FS.mkdirTree("/scene-user/id1/maps");
      for (const file of config.gameFingerprint)
        engine.FS.writeFile(
          `/quake/id1/${file.name}`,
          await asset(`/assets/${file.name}`, file.sha256),
        );
      bytesCache.clear(); // PAKs now live in the engine filesystem.
      engine.FS.writeFile(
        "/scene-user/id1/autoexec.cfg",
        "viewsize 120\nvolume 0\nbgmvolume 0\n",
      );
      engine.ccall("Web_EditorMode", null, ["number"], [1]);
      const result = engine.callMain([
        "-basedir",
        "/quake",
        "-userdir",
        "/scene-user",
        "-heapsize",
        "196608",
        "-window",
        "-width",
        String(Math.max(64, innerWidth)),
        "-height",
        String(Math.max(64, innerHeight)),
        "-noipx",
        "-nopackedpixels",
      ]);
      result?.catch?.((e) => errors.push(e.message));
      await wait(() => ready, "initialization");
    }
    for (const file of build.files.filter((f) => /\.(bsp|lit)$/.test(f.name)))
      engine.FS.writeFile(
        `/scene-user/id1/maps/${file.name}`,
        await asset(
          `/api/editor/builds/${build.id}/files/${file.name}`,
          file.sha256,
        ),
      );
    engine.ccall("Web_EditorSimulate", null, ["number"], [1]);
    const skill = Number(config.skill ?? loaded?.skill ?? 1);
    command(
      `stopdemo\ndisconnect\nskill ${skill}\nmap ${build.map}\nviewsize 120`,
    );
    await wait(
      () => state()?.map === build.map && state()?.signon === 4,
      "map load",
    );
    command("notarget 1\ngod 1");
    await delay(300); // Run actual spawn/drop-to-floor callbacks before freezing.
    engine.ccall("Web_EditorSimulate", null, ["number"], [0]);
    simulating = false;
    loaded = { ...build, skill };
    const files = build.files.filter((file) => /\.(bsp|lit)$/.test(file.name)),
      names = new Set(files.map((file) => file.name)),
      hashes = new Set(files.map((file) => file.sha256));
    for (const name of engine.FS.readdir("/scene-user/id1/maps"))
      if (name !== "." && name !== ".." && !names.has(name))
        engine.FS.unlink(`/scene-user/id1/maps/${name}`);
    for (const hash of bytesCache.keys())
      if (!hashes.has(hash)) bytesCache.delete(hash);
    size();
    status.textContent = "";
    return snapshot();
  } catch (e) {
    status.textContent = e.message;
    throw e;
  } finally {
    busy = false;
  }
}
function snapshot() {
  return {
    ready,
    busy,
    build: loaded?.id,
    revision: loaded?.revision,
    simulating,
    camera: lastCamera ? [...lastCamera] : null,
    state: state(),
    entities:
      engine && ready
        ? JSON.parse(engine.ccall("Web_EditorEntities", "string", [], []))
        : [],
    errors: [...errors],
    logs: [...logs],
  };
}
window.editorScene = {
  load,
  snapshot,
  camera(position, pitch, yaw, fov) {
    lastCamera = [...position, pitch, yaw, fov];
    if (ready && !cameraLock)
      engine.ccall(
        "Web_EditorCamera",
        null,
        Array(6).fill("number"),
        lastCamera,
      );
  },
  hide(id, hidden) {
    if (ready)
      engine.ccall(
        "Web_EditorHide",
        null,
        ["string", "number"],
        [id, Number(hidden)],
      );
  },
  async capture(camera) {
    if (!loaded || cameraLock) throw new Error("Scene preview is unavailable");
    cameraLock = true;
    try {
      engine.ccall("Web_EditorCamera", null, Array(6).fill("number"), camera);
      engine.ccall("Web_EditorSelect", null, ["string", "number"], ["", 0]);
      await delay(80);
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          delete engine.editorCaptureResolve;
          reject(new Error("Capture timed out"));
        }, 5000);
        engine.editorCaptureResolve = (png) => {
          clearTimeout(timer);
          resolve(png);
        };
      });
    } finally {
      cameraLock = false;
      if (lastCamera)
        engine.ccall(
          "Web_EditorCamera",
          null,
          Array(6).fill("number"),
          lastCamera,
        );
    }
  },
  select(id, overlays = true) {
    if (ready)
      engine.ccall(
        "Web_EditorSelect",
        null,
        ["string", "number"],
        [id || "", Number(overlays)],
      );
  },
  transform(id, position, yaw) {
    return (
      ready &&
      engine.ccall(
        "Web_EditorTransform",
        "number",
        ["string", ...Array(4).fill("number")],
        [id, ...position, yaw],
      )
    );
  },
  simulate(value) {
    if (!loaded) return;
    simulating = Boolean(value);
    engine.ccall("Web_EditorSimulate", null, ["number"], [Number(value)]);
  },
  activate(id) {
    const changed = engine.ccall(
      "Web_EditorActivate",
      "number",
      ["string"],
      [id],
    );
    if (changed) simulating = true;
    return changed;
  },
  reset() {
    return loaded ? load(loaded, { gameFingerprint: [] }) : Promise.resolve();
  },
  stop() {
    command("disconnect");
    loaded = null;
    simulating = false;
  },
};
addEventListener("resize", size);
addEventListener("pagehide", () => command("disconnect"));
addEventListener("error", (e) => errors.push(e.message));
