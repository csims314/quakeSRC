import { mkdir, readFile, writeFile, access, rm } from "node:fs/promises";
import { spawn, fork } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import {
  createAssetLibrary,
  customTextures,
  makeWad,
  hash,
} from "./assets.mjs";
import { validateProject, exportMap } from "./domain.mjs";

export const isLoopback = (address) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
const MAX_BODY = 16 * 1024 * 1024;
export function editorOptions(options, env = process.env) {
  const lan = env.QUAKE_EDITOR_LAN === "1";
  const port = Number(env.QUAKE_EDITOR_MULTIPLAYER_PORT || 4434);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    port === options.multiplayerPort
  )
    throw new Error("Invalid editor multiplayer port");
  if (
    lan &&
    (!options.tlsCert ||
      !options.tlsKey ||
      !options.publicOrigin.startsWith("https:"))
  )
    throw new Error(
      "LAN editor requires HTTPS and QUAKE_TLS_CERT / QUAKE_TLS_KEY. See web/editor/README.md.",
    );
  return {
    enabled: !options.production,
    lan,
    port,
    host: lan ? "0.0.0.0" : "127.0.0.1",
    origin: options.publicOrigin,
  };
}
export function editorTransportURL(options, settings) {
  const url = new URL(settings.lan ? settings.origin : options.multiplayerUrl);
  url.protocol = "https:";
  url.port = String(settings.port);
  url.pathname = "/quake";
  url.search = "";
  url.hash = "";
  return url;
}
function json(res, status, value) {
  res
    .writeHead(status, { "Content-Type": "application/json" })
    .end(JSON.stringify(value));
}
async function body(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw Object.assign(new Error("Send application/json"), { status: 415 });
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    });
    req.once("error", reject);
    req.once("aborted", () => reject(new Error("Request interrupted")));
    req.once("end", () => {
      if (size > MAX_BODY)
        return reject(
          Object.assign(new Error("Project exceeds the 16 MiB limit"), {
            status: 413,
          }),
        );
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON request"));
      }
    });
  });
}
export function createEditorService(
  root,
  options,
  settings = editorOptions(options),
) {
  const load = createAssetLibrary(root),
    jobs = new Map();
  const token = randomBytes(32).toString("hex");
  const buildsRoot = path.join(root, "web", ".local", "editor", "builds");
  const compilerRoot =
    settings.compilerRoot ||
    process.env.QUAKE_EDITOR_COMPILER_DIR ||
    path.join(root, "tools", "ericw-tools");
  let activeJob = null,
    session = null,
    startingSession = false;
  const compiler = (n) =>
    path.join(compilerRoot, n + (process.platform === "win32" ? ".exe" : ""));
  async function availability() {
    try {
      await Promise.all(
        ["qbsp", "vis", "light"].map((n) => access(compiler(n))),
      );
      return true;
    } catch {
      return false;
    }
  }
  const publicJob = (j) => ({
    id: j.id,
    status: j.status,
    stage: j.stage,
    revision: j.project.revision,
    map: j.map,
    logs: j.logs,
    leak: j.leak,
    error: j.error,
    files: j.files,
    registered: j.registered,
    gameFingerprint: j.fingerprint,
  });
  const publicSession = (s) => ({
    id: s.id,
    buildId: s.build.id,
    map: s.build.map,
    revision: s.build.project.revision,
    status: s.status,
    error: s.error,
    gameFingerprint: s.build.fingerprint,
    files: s.build.files.filter((f) => /\.(bsp|lit)$/.test(f.name)),
    connection: s.connection,
    joinUrl: `${settings.origin}/editor/play.html?session=${s.id}`,
  });
  function requireJob(id) {
    const j = jobs.get(id);
    if (!j) throw Object.assign(new Error("Build not found"), { status: 404 });
    return j;
  }
  function requireSession(id) {
    if (!session || session.id !== id)
      throw Object.assign(new Error("This playtest has ended"), {
        status: 410,
      });
    return session;
  }
  async function cleanup(j) {
    const target = path.resolve(j.directory);
    if (!target.startsWith(path.resolve(buildsRoot) + path.sep))
      throw new Error("Invalid cleanup directory");
    await rm(target, { recursive: true, force: true });
  }
  function run(j, name, args) {
    return new Promise((resolve, reject) => {
      if (j.abort.signal.aborted) return reject(new Error("Build cancelled"));
      j.stage = name;
      j.logs.push(`> ${name} ${args.join(" ")}`);
      const child = spawn(compiler(name), args, {
        cwd: j.directory,
        windowsHide: true,
        signal: j.abort.signal,
      });
      const collect = (data) => {
        for (const line of data.toString().split(/\r?\n/)) {
          if (line) j.logs.push(line.slice(0, 2000));
        }
        if (j.logs.length > 1200) j.logs.splice(0, j.logs.length - 1200);
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                `${name} failed (${code ?? "cancelled"}). See build log.`,
              ),
            ),
      );
    });
  }
  async function compile(j, library) {
    const timer = setTimeout(() => {
      j.error = "Build exceeded its time limit";
      j.abort.abort();
    }, settings.buildTimeoutMs ?? 300000);
    try {
      await mkdir(j.directory, { recursive: true });
      const textures = new Map(library.textures);
      for (const t of customTextures(j.project)) textures.set(t.name, t);
      validateProject(j.project, {
        textures: new Set(textures.keys()),
        maps: library.maps,
      });
      const used = new Set(
        j.project.brushes.flatMap((b) => b.faces.map((f) => f.texture)),
      );
      // Quake requires complete animated texture sequences, including alternate frames.
      for (const name of [...used])
        if (/^\+[0-9a-j]/i.test(name))
          for (const candidate of textures.keys())
            if (
              /^\+[0-9a-j]/i.test(candidate) &&
              candidate.slice(2) === name.slice(2)
            )
              used.add(candidate);
      const wad = makeWad([...used].map((name) => textures.get(name))),
        map = exportMap(j.project);
      await writeFile(path.join(j.directory, `${j.map}.map`), map);
      await writeFile(path.join(j.directory, "textures.wad"), wad);
      const source = zipSync({
        [`${j.map}.map`]: strToU8(map),
        "textures.wad": new Uint8Array(wad),
        "README.txt": strToU8(
          "Compile with ericw-tools qbsp, vis and light. Textures retain their original licenses.\n",
        ),
      });
      await writeFile(path.join(j.directory, "source.zip"), source);
      j.files.push({
        name: "source.zip",
        sha256: hash(source),
        size: source.length,
      });
      await run(j, "qbsp", ["-leaktest", `${j.map}.map`]);
      await run(j, "vis", ["-fast", "-threads", "2", `${j.map}.bsp`]);
      await run(j, "light", ["-threads", "2", `${j.map}.bsp`]);
      for (const ext of ["bsp", "lit"]) {
        const name = `${j.map}.${ext}`;
        try {
          const bytes = await readFile(path.join(j.directory, name));
          j.files.push({ name, sha256: hash(bytes), size: bytes.length });
        } catch (e) {
          if (ext === "bsp" || e.code !== "ENOENT") throw e;
        }
      }
      j.status = "ready";
      j.stage = "complete";
    } catch (e) {
      j.error = j.error || e.message;
      j.status = j.abort.signal.aborted ? "cancelled" : "failed";
      for (const ext of ["pts", "lin"])
        try {
          const pts = await readFile(
            path.join(j.directory, `${j.map}.${ext}`),
            "utf8",
          );
          j.leak = pts
            .split(/\r?\n/)
            .map((l) => l.trim().split(/\s+/).map(Number))
            .filter((v) => v.length === 3 && v.every(Number.isFinite))
            .slice(0, 4096);
          if (j.leak.length) break;
        } catch {}
    } finally {
      clearTimeout(timer);
      activeJob = null;
    }
  }
  async function stopSession() {
    if (session?.child) {
      const child = session.child;
      await new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode) return resolve();
        const timeout = setTimeout(() => {
          child.kill();
          resolve();
        }, 3000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.send({ type: "stop" });
      });
    }
    session = null;
  }
  async function startSession(build, skill) {
    await stopSession();
    const library = await load();
    if (!library.available)
      throw new Error(
        "Install Quake pak0.pak in runtime/id1 before playtesting",
      );
    if (
      JSON.stringify(library.fingerprint) !== JSON.stringify(build.fingerprint)
    )
      throw new Error(
        "Game files changed. Rebuild the level before playtesting.",
      );
    if (
      build.project.entities.filter((e) => e.classname === "info_player_coop")
        .length < 7
    )
      throw new Error(
        "Add seven co-op starts for the eight-player test server",
      );
    const url = editorTransportURL(options, settings);
    const origins = [...options.origins];
    const s = { id: randomUUID(), build, status: "starting", connection: null };
    session = s;
    const child = fork(
      path.join(root, "web", "editor", "session-worker.mjs"),
      [],
      {
        cwd: root,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: process.env,
      },
    );
    s.child = child;
    let recent = "";
    const output = (data) => {
      recent = (recent + data.toString()).slice(-16000);
    };
    child.stdout.on("data", output);
    child.stderr.on("data", output);
    child.on("exit", () => {
      if (s.status !== "stopped") {
        s.status = "ended";
        s.error = s.error || "Playtest server stopped";
      }
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(
          new Error(
            `Playtest server startup timed out. ${recent.slice(-2000)}`,
          ),
        );
      }, 20000);
      child.on("message", (message) => {
        if (message.type === "ready") {
          s.connection = message.config;
          s.status = "ready";
          clearTimeout(timeout);
          resolve();
        }
        if (message.type === "error") {
          s.error = message.error;
          clearTimeout(timeout);
          child.kill();
          reject(new Error(message.error));
        }
        if (message.type === "state") {
          s.state = message.state;
          s.world = message.world;
          s.connection = message.connection;
        }
      });
      child.once("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        if (s.status !== "ready")
          reject(
            new Error(s.error || recent.slice(-2000) || "Test server failed"),
          );
      });
      child.send({
        type: "start",
        root,
        build: {
          directory: build.directory,
          map: build.map,
          files: build.files.filter((f) => /\.(bsp|lit)$/.test(f.name)),
        },
        options: {
          ...options,
          origins,
          multiplayerHost: settings.host,
          multiplayerPort: settings.port,
          multiplayerUrl: url.href,
          certificateHostname: url.hostname.replace(/^\[|\]$/g, ""),
          certificateDirectory: path.join(
            root,
            "web",
            ".local",
            "editor",
            "certificates",
          ),
        },
        skill,
      });
    });
    return s;
  }
  async function handler(req, res, url) {
    if (!url.pathname.startsWith("/api/editor/")) return false;
    try {
      if (!settings.enabled) {
        json(res, 404, { error: "Editor is disabled in production" });
        return true;
      }
      const local = isLoopback(req.socket.remoteAddress);
      const guest = url.pathname.match(
        /^\/api\/editor\/sessions\/([a-zA-Z0-9-]+)(?:\/files\/([a-zA-Z0-9_.-]+))?$/,
      );
      if (!local && !(settings.lan && req.method === "GET" && guest)) {
        json(res, 403, {
          error:
            "Authoring is available only on the host computer. Use the LAN join link to play.",
        });
        return true;
      }
      const origin = req.headers.origin;
      const requestOrigin = `${options.publicOrigin.startsWith("https:") ? "https" : "http"}://${req.headers.host}`;
      if (
        !options.origins.has(requestOrigin) ||
        (origin && !options.origins.has(origin))
      )
        throw Object.assign(new Error("Origin not allowed"), { status: 403 });
      if (
        !["GET", "HEAD"].includes(req.method) &&
        req.headers["x-editor-token"] !== token
      )
        throw Object.assign(new Error("Invalid editor request token"), {
          status: 403,
        });
      if (url.pathname === "/api/editor/config" && req.method === "GET") {
        const library = await load();
        json(res, 200, {
          token,
          editorVersion: 2,
          engineScene: true,
          compiler: await availability(),
          registered: library.registered,
          canPlay: library.available,
          gameAvailable: library.available,
          gameFingerprint: library.fingerprint,
          palette: Array.from(library.palette),
          maps: library.maps,
          lan: settings.lan,
          maxBody: MAX_BODY,
          maxPlayers: 8,
        });
      } else if (
        url.pathname === "/api/editor/textures" &&
        req.method === "GET"
      ) {
        const library = await load();
        json(
          res,
          200,
          [...library.textures.values()].map((t) => ({
            name: t.name,
            width: t.width,
            height: t.height,
          })),
        );
      } else if (
        url.pathname.startsWith("/api/editor/textures/") &&
        req.method === "GET"
      ) {
        const library = await load(),
          name = decodeURIComponent(
            url.pathname.slice("/api/editor/textures/".length),
          ),
          texture = library.textures.get(name);
        if (!texture)
          throw Object.assign(new Error("Texture not found"), { status: 404 });
        json(res, 200, {
          name,
          width: texture.width,
          height: texture.height,
          pixels: texture.pixels.toString("base64"),
        });
      } else if (
        url.pathname === "/api/editor/builds" &&
        req.method === "POST"
      ) {
        if (activeJob)
          throw Object.assign(new Error("A build is already running"), {
            status: 409,
          });
        const reservation = { abort: new AbortController() };
        activeJob = reservation;
        try {
          if (!(await availability()))
            throw new Error(
              "Run npm run setup:editor to install the map compiler",
            );
          const data = await body(req),
            library = await load();
          if (!library.available)
            throw new Error("Install Quake game files in runtime/id1");
          validateProject(data.project, { maps: library.maps });
          customTextures(data.project);
          const id = randomUUID(),
            j = {
              id,
              map: `ed_${id.replaceAll("-", "").slice(0, 20)}`,
              project: data.project,
              directory: path.join(buildsRoot, id),
              status: "building",
              stage: "preparing",
              logs: [],
              files: [],
              leak: [],
              abort: new AbortController(),
              fingerprint: library.fingerprint,
              registered: library.registered,
            };
          // Retain at most twelve builds; never remove an active playtest build.
          for (const old of [...jobs.values()])
            if (
              jobs.size >= 12 &&
              session?.build.id !== old.id &&
              old.status !== "building"
            ) {
              jobs.delete(old.id);
              await cleanup(old);
            }
          jobs.set(id, j);
          activeJob = j;
          void compile(j, library);
          json(res, 202, publicJob(j));
        } catch (e) {
          if (activeJob === reservation) activeJob = null;
          throw e;
        }
      } else if (
        url.pathname === "/api/editor/sessions" &&
        req.method === "POST"
      ) {
        const { buildId, skill = 1 } = await body(req),
          build = requireJob(buildId);
        if (build.status !== "ready")
          throw new Error("Compile the level successfully first");
        if (!Number.isInteger(skill) || skill < 0 || skill > 3)
          throw new Error("Invalid difficulty");
        if (startingSession)
          throw Object.assign(new Error("A test server is starting"), {
            status: 409,
          });
        startingSession = true;
        try {
          const s = await startSession(build, skill);
          json(res, 201, publicSession(s));
        } finally {
          startingSession = false;
        }
      } else {
        const match = url.pathname.match(
          /^\/api\/editor\/(builds|sessions)\/([a-zA-Z0-9-]+)(?:\/files\/([a-zA-Z0-9_.-]+))?$/,
        );
        if (!match) {
          json(res, 404, { error: "Unknown editor route" });
          return true;
        }
        const [, kind, id, file] = match,
          s = kind === "sessions" ? requireSession(id) : null,
          j = s ? s.build : requireJob(id);
        if (file && req.method === "GET") {
          const f = j.files.find(
            (f) => f.name === file && (!s || /\.(bsp|lit)$/.test(f.name)),
          );
          if (!f)
            throw Object.assign(new Error("Artifact not found"), {
              status: 404,
            });
          const bytes = await readFile(path.join(j.directory, f.name));
          res
            .writeHead(200, {
              "Content-Type": "application/octet-stream",
              "Content-Length": bytes.length,
              "Content-Disposition": `attachment; filename="${f.name}"`,
            })
            .end(bytes);
        } else if (!file && req.method === "GET")
          json(
            res,
            200,
            s
              ? {
                  ...publicSession(s),
                  ...(local ? { state: s.state, world: s.world } : {}),
                }
              : publicJob(j),
          );
        else if (!file && req.method === "DELETE") {
          if (s) {
            s.status = "stopped";
            await stopSession();
          } else if (j.status === "building") j.abort.abort();
          else {
            if (
              session?.build.id === j.id &&
              ["ready", "starting"].includes(session.status)
            )
              throw Object.assign(
                new Error("Stop the co-op session before removing its build"),
                { status: 409 },
              );
            jobs.delete(j.id);
            await cleanup(j);
          }
          json(res, 200, { ok: true });
        } else json(res, 405, { error: "Method not allowed" });
      }
    } catch (e) {
      json(res, e.status || 400, { error: e.message });
    }
    return true;
  }
  return {
    handler,
    settings,
    stop: async () => {
      activeJob?.abort.abort();
      await stopSession();
    },
  };
}
