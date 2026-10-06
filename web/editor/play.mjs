import { createQuakeTransport, connectQuake } from "../dist/network.js";
import { createMusicPlayer } from "../dist/music.js";
const $ = (id) => document.getElementById(id),
  query = new URLSearchParams(location.search);
const sessionId = query.get("session"),
  buildId = query.get("build");
let manifest,
  config,
  engine,
  ready = false,
  started = false;
const logs = [],
  transport = createQuakeTransport((event) => {
    if (event.state === "closed")
      $("status").textContent = `Disconnected: ${event.reason}`;
  });
const digest = async (bytes) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
async function get(url) {
  const response = await fetch(url);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
function fail(e) {
  $("message").textContent = e.message || String(e);
  $("cover").hidden = false;
  $("capture").hidden = true;
  $("start").disabled = started;
  window.__quakeErrors.push(e.message || String(e));
}
function command(text) {
  if (engine && ready) engine.ccall("Web_Command", null, ["string"], [text]);
}
window.__quakeErrors = [];
function log(line) {
  logs.push(String(line));
  if (logs.length > 120) logs.shift();
  $("log").textContent = logs.slice(-12).join("\n");
  if (String(line).includes("Quake Initialized")) {
    ready = true;
    setTimeout(async () => {
      try {
        command(
          `stopdemo\n${sessionId ? "disconnect" : `skill ${query.get("skill") || 1}\nmap ${manifest.map}`}`,
        );
        if (sessionId) {
          await connectQuake(transport, manifest.connection);
          command("connect webtransport");
        }
        $("cover").hidden = true;
        $("capture").hidden = false;
        $("status").textContent =
          `${sessionId ? "CO-OP" : "SOLO"} · ${manifest.map}`;
      } catch (e) {
        fail(e);
      }
    }, 0);
  }
}
async function files() {
  const selected = [...$("paks").files],
    result = [];
  for (const expected of manifest.gameFingerprint || config.gameFingerprint) {
    let bytes;
    if (selected.length) {
      const file = selected.find((f) => f.name.toLowerCase() === expected.name);
      if (!file) throw new Error(`Select ${expected.name} too`);
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const response = await fetch(`/assets/${expected.name}`);
      if (!response.ok)
        throw new Error("Select the Quake PAK files used by the host");
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if ((await digest(bytes)) !== expected.sha256)
      throw new Error(
        `${expected.name} differs from the host's game files. Use matching game data.`,
      );
    result.push({ name: expected.name, bytes });
  }
  return result;
}
async function start() {
  if (started) return;
  $("start").disabled = true;
  try {
    const paks = await files();
    const mapFiles = [];
    for (const f of manifest.files.filter((f) => /\.(bsp|lit)$/.test(f.name))) {
      const response = await fetch(
        `/api/editor/${sessionId ? "sessions" : "builds"}/${sessionId || buildId}/files/${f.name}`,
      );
      if (!response.ok) throw new Error("This build is no longer available");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if ((await digest(bytes)) !== f.sha256)
        throw new Error("Map download failed its integrity check");
      mapFiles.push({ name: f.name, bytes });
    }
    if (!mapFiles.some((f) => f.name.endsWith(".bsp")))
      throw new Error("Build has no playable map");
    started = true;
    // The same streamed soundtrack as the game page: the player's own files,
    // then runtime/id1/music on this server.
    const music = createMusicPlayer({ log });
    await music.load();
    engine = await createQuakeSpasm({
      canvas: $("game"),
      noInitialRun: true,
      quakeTransport: transport,
      quakeMusic: music,
      locateFile: (name) => `../engine/${name}`,
      print: log,
      printErr: log,
      onAbort: (reason) => fail(new Error(String(reason))),
    });
    engine.FS.mkdirTree("/quake/id1");
    engine.FS.mkdirTree("/test-user/id1/maps");
    for (const f of paks) engine.FS.writeFile(`/quake/id1/${f.name}`, f.bytes);
    for (const f of mapFiles)
      engine.FS.writeFile(`/test-user/id1/maps/${f.name}`, f.bytes);
    engine.FS.writeFile(
      "/test-user/id1/autoexec.cfg",
      "bind w +forward\nbind s +back\nbind a +moveleft\nbind d +moveright\nbind SPACE +jump\nbind MOUSE1 +attack\n+mlook\n",
    );
    window.quake = {
      command,
      state: () => JSON.parse(engine.ccall("Web_State", "string", [], [])),
      world: () => JSON.parse(engine.ccall("Web_WorldState", "string", [], [])),
      network: transport,
      music,
      logs,
      get ready() {
        return ready;
      },
    };
    const result = engine.callMain([
      "-basedir",
      "/quake",
      "-userdir",
      "/test-user",
      "-heapsize",
      "196608",
      "-window",
      "-width",
      "1280",
      "-height",
      "720",
      "-noipx",
      "-nopackedpixels",
    ]);
    if (result?.catch) result.catch(fail);
  } catch (e) {
    fail(e);
    if (!started) $("start").disabled = false;
  }
}
async function capture() {
  try {
    $("game").focus();
    await $("game").requestPointerLock();
  } catch (e) {
    $("status").textContent = e.message;
  }
}
$("start").onclick = start;
$("resume").onclick = capture;
$("game").onclick = () => {
  if (ready) capture();
};
$("game").oncontextmenu = (e) => e.preventDefault();
document.addEventListener("pointerlockchange", () => {
  $("capture").hidden = Boolean(document.pointerLockElement) || !ready;
});
window.addEventListener("pagehide", () => transport.closeAll());
window.addEventListener("error", (e) => window.__quakeErrors.push(e.message));
try {
  if (sessionId) manifest = await get(`/api/editor/sessions/${sessionId}`);
  else if (buildId) manifest = await get(`/api/editor/builds/${buildId}`);
  else throw new Error("Open a playtest from the editor or a co-op join link");
  if (manifest.status !== "ready")
    throw new Error(manifest.error || "Playtest is not ready");
  try {
    config = await get("/api/editor/config");
  } catch {
    config = null;
  }
  if (!sessionId) {
    if (!config?.canPlay)
      throw new Error(
        "Install Quake pak0.pak in runtime/id1 before playtesting custom maps",
      );
    if (
      manifest.gameFingerprint &&
      JSON.stringify(manifest.gameFingerprint) !==
        JSON.stringify(config.gameFingerprint)
    )
      throw new Error(
        "Game files changed. Rebuild the level before playtesting.",
      );
    manifest.gameFingerprint = config.gameFingerprint;
  }
  const localData = Boolean(config?.canPlay);
  $("files-label").hidden = localData;
  $("map-title").textContent = sessionId
    ? "Join the playtest."
    : "Play your level.";
  $("message").textContent = localData
    ? "Game files are available locally. Your normal saves stay separate."
    : "Select your Quake PAK files. They stay in this browser and must match the host's files.";
  $("start").disabled = false;
} catch (e) {
  fail(e);
}
