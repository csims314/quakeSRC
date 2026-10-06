import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { createServer } from "node:http";
import { fork } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import {
  starterProject,
  newBrush,
  newEntity,
  brushFaces,
  cutOpening,
  exportMap,
  validateProject,
  dot,
  sub,
} from "../editor/domain.mjs";
import {
  readPak,
  readBspTextures,
  makeWad,
  gridTexture,
  createAssetLibrary,
} from "../editor/assets.mjs";
import {
  createEditorService,
  editorOptions,
  editorTransportURL,
} from "../editor/service.mjs";
import { serverConfig } from "../config.mjs";

const palette = Buffer.from(
  Array.from({ length: 768 }, (_, i) => Math.floor(i / 3)),
);
function pak(entries) {
  let offset = 12;
  const directory = Buffer.alloc(entries.length * 64);
  entries.forEach(([name, bytes], i) => {
    directory.write(name, i * 64, "ascii");
    directory.writeUInt32LE(offset, i * 64 + 56);
    directory.writeUInt32LE(bytes.length, i * 64 + 60);
    offset += bytes.length;
  });
  const header = Buffer.alloc(12);
  header.write("PACK");
  header.writeUInt32LE(offset, 4);
  header.writeUInt32LE(directory.length, 8);
  return Buffer.concat([
    header,
    ...entries.map(([, bytes]) => bytes),
    directory,
  ]);
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "quake-editor-test-"));
  await mkdir(path.join(root, "runtime", "id1"), { recursive: true });
  await writeFile(
    path.join(root, "runtime", "id1", "pak0.pak"),
    pak([["gfx/palette.lmp", palette]]),
  );
  return root;
}
async function cleanup(root) {
  const resolved = path.resolve(root);
  assert.ok(
    resolved.startsWith(
      path.resolve(os.tmpdir()) + path.sep + "quake-editor-test-",
    ),
  );
  await rm(resolved, { recursive: true, force: true });
}

test("rotated box and wedge surfaces enclose every vertex and have finite normals", () => {
  for (const shape of ["box", "wedge"]) {
    const b = newBrush(shape, [32, -64, 80], [128, 96, 64]);
    b.rotation = [15, 30, 45];
    const faces = brushFaces(b),
      vertices = faces.flatMap((f) => f.vertices);
    for (const face of faces) {
      assert.ok(Math.abs(Math.hypot(...face.normal) - 1) < 1e-9);
      for (const v of vertices)
        assert.ok(dot(sub(v, face.vertices[0]), face.normal) < 1e-7);
    }
  }
});
test("wall openings preserve a solid lintel and two jambs", () => {
  const pieces = cutOpening(newBrush("box", [0, 0, 128], [16, 1024, 256]));
  assert.equal(pieces.length, 3);
  assert.equal(pieces[2].position[2] - pieces[2].size[2] / 2, 128);
  assert.ok(
    pieces
      .slice(0, 2)
      .every((p) => Math.abs(p.position[1]) - p.size[1] / 2 === 64),
  );
  assert.throws(() => cutOpening(newBrush("wedge")), /unrotated wall/);
});
test("project roundtrip preserves image data, face alignment and stable target references", () => {
  const p = starterProject(),
    door = newEntity("func_door", [0, 0, 64]),
    button = newEntity("func_button", [64, 0, 64]);
  button.targetId = door.id;
  p.entities.push(door, button);
  p.brushes.push(
    newBrush("box", door.position, [16, 128, 128], "ed_grid", door.id),
    newBrush("box", button.position, [16, 24, 24], "ed_grid", button.id),
  );
  p.brushes[0].faces[0].shift = [12, -8];
  p.brushes[0].faces[0].rotation = 35;
  p.textures = [
    {
      name: "ed_test",
      width: 16,
      height: 16,
      pixels: Buffer.alloc(256, 40).toString("base64"),
      source: Buffer.from("original image bytes").toString("base64"),
    },
  ];
  const restored = JSON.parse(JSON.stringify(p));
  validateProject(restored);
  assert.deepEqual(restored, p);
  const map = exportMap(restored);
  assert.ok(map.includes(`"target" "e_${door.id}"`));
  assert.ok(map.includes(`"targetname" "e_${door.id}"`));
  assert.ok(map.includes('"mapversion" "220"'));
  assert.ok(map.includes('"sounds" "6"'), 'editor maps name a CD track so music plays');
});
test("invalid geometry, identifiers, properties and imported pixels are rejected", () => {
  let p = starterProject();
  p.brushes[0].size[0] = 0;
  assert.throws(() => validateProject(p), /coordinates/);
  p = starterProject();
  p.entities[0].classname = "toString";
  assert.throws(() => validateProject(p), /gameplay/);
  p = starterProject();
  p.entities[0].targetId = "missing";
  assert.throws(() => validateProject(p), /missing target/);
  p = starterProject();
  p.title = 'bad"\nmap';
  assert.throws(() => validateProject(p), /text/);
  p = starterProject();
  p.entities.find((e) => e.classname === "light").properties.light = "NaN";
  assert.throws(() => validateProject(p), /light property/);
  p = starterProject();
  p.textures = [
    {
      name: "ed_bad",
      width: 16,
      height: 16,
      pixels: Buffer.alloc(256, 255).toString("base64"),
    },
  ];
  assert.throws(() => validateProject(p), /texture pixels/);
});
test("PAK readers reject invalid bounds; WAD mip levels contain the expected pixels", () => {
  const bytes = pak([["gfx/palette.lmp", palette]]);
  assert.deepEqual(readPak(bytes).get("gfx/palette.lmp"), palette);
  const bad = Buffer.from(bytes);
  bad.writeUInt32LE(0xfffffff0, 4);
  assert.throws(() => readPak(bad), /offset/);
  const wad = makeWad([gridTexture(palette)]);
  assert.equal(wad.toString("ascii", 0, 4), "WAD2");
  const mip = wad.readUInt32LE(12 + 24);
  assert.equal(mip, 40);
  assert.equal(wad.readUInt32LE(12 + 28), 40 + 4096);
  assert.equal(wad.readUInt32LE(12 + 32), 40 + 4096 + 1024);
});
test("asset cache invalidates when installed game files change", async () => {
  const root = await fixture();
  try {
    const load = createAssetLibrary(root),
      first = await load();
    assert.equal(first.registered, false);
    assert.equal(await load(), first);
    await writeFile(
      path.join(root, "runtime", "id1", "pak1.pak"),
      pak([["unrelated", Buffer.from("new")]]),
    );
    const second = await load();
    assert.notEqual(second, first);
    assert.equal(second.fingerprint.length, 2);
  } finally {
    await cleanup(root);
  }
});
test("LAN configuration requires trusted TLS and a distinct game port", () => {
  const options = serverConfig({});
  assert.throws(
    () => editorOptions(options, { QUAKE_EDITOR_LAN: "1" }),
    /HTTPS/,
  );
  assert.throws(
    () => editorOptions(options, { QUAKE_EDITOR_MULTIPLAYER_PORT: "4433" }),
    /port/,
  );
  assert.equal(
    editorOptions({ ...options, production: true }, {}).enabled,
    false,
  );
  assert.equal(
    editorTransportURL(options, {
      lan: true,
      origin: "https://192.168.1.50:3000",
      port: 4434,
    }).href,
    "https://192.168.1.50:4434/quake",
  );
  assert.equal(
    editorTransportURL(options, {
      lan: false,
      origin: options.publicOrigin,
      port: 4434,
    }).href,
    "https://127.0.0.1:4434/quake",
  );
});

test("build API compiles textured ramps and linked objects, reports leaks, and protects requests", async (t) => {
  const compilerRoot = path.resolve("tools/ericw-tools");
  try {
    await access(
      path.join(
        compilerRoot,
        "qbsp" + (process.platform === "win32" ? ".exe" : ""),
      ),
    );
  } catch {
    t.skip("Run npm run setup:editor to install native map tools");
    return;
  }
  const root = await fixture(),
    options = serverConfig({});
  const service = createEditorService(root, options, {
    enabled: true,
    lan: false,
    port: 4434,
    origin: "http://127.0.0.1",
    compilerRoot,
  });
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    if (
      !(await service.handler(req, res, new URL(req.url, "http://localhost")))
    )
      res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  options.publicOrigin = origin;
  options.origins = new Set([origin]);
  const config = await (await fetch(`${origin}/api/editor/config`)).json();
  const request = (url, method, data, token = config.token) =>
    fetch(origin + url, {
      method,
      headers: { "Content-Type": "application/json", "X-Editor-Token": token },
      body: data ? JSON.stringify(data) : undefined,
    });
  const wait = async (id) => {
    for (let i = 0; i < 200; i++) {
      const j = await (await fetch(`${origin}/api/editor/builds/${id}`)).json();
      if (j.status !== "building") return j;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("Build did not finish");
  };
  try {
    assert.equal(config.compiler, true);
    assert.equal(config.registered, false);
    assert.equal(config.canPlay, true, "Shareware data can run custom playtests");
    assert.equal(
      (
        await request(
          "/api/editor/builds",
          "POST",
          { project: starterProject() },
          "wrong",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/editor/config`, {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    const p = starterProject();
    p.brushes.push(newBrush("wedge", [128, 0, 32], [128, 128, 64]));
    const door = newEntity("func_door", [0, 0, 64]),
      button = newEntity("func_button", [-48, 0, 48]);
    button.targetId = door.id;
    p.entities.push(door, button);
    p.textures = [
      {
        name: "ed_test",
        width: 16,
        height: 16,
        pixels: Buffer.alloc(256, 40).toString("base64"),
      },
    ];
    p.brushes.push(
      newBrush("box", door.position, [16, 128, 128], "ed_test", door.id),
      newBrush("box", button.position, [16, 24, 24], "ed_grid", button.id),
    );
    const response = await request("/api/editor/builds", "POST", {
      project: p,
    });
    assert.equal(response.status, 202);
    const accepted = await response.json();
    const busy = await request("/api/editor/builds", "POST", { project: p });
    assert.equal(busy.status, 409);
    const built = await wait(accepted.id);
    assert.equal(built.status, "ready", built.logs?.join("\n"));
    const file = built.files.find((f) => f.name.endsWith(".bsp"));
    assert.ok(file);
    const bsp = Buffer.from(
      await (
        await fetch(
          `${origin}/api/editor/builds/${built.id}/files/${file.name}`,
        )
      ).arrayBuffer(),
    );
    assert.equal(bsp.readInt32LE(0), 29);
    const embedded = readBspTextures(bsp).find((t) => t.name === "ed_test");
    assert.deepEqual(embedded.pixels, Buffer.alloc(256, 40));
    const ent = bsp
      .subarray(bsp.readInt32LE(4), bsp.readInt32LE(4) + bsp.readInt32LE(8))
      .toString();
    assert.ok(ent.includes("func_door"));
    assert.ok(ent.includes(`e_${door.id}`));
    const source = unzipSync(
      new Uint8Array(
        await (
          await fetch(
            `${origin}/api/editor/builds/${built.id}/files/source.zip`,
          )
        ).arrayBuffer(),
      ),
    );
    assert.ok(source["textures.wad"]);
    assert.ok(Object.keys(source).some((n) => n.endsWith(".map")));
    assert.equal(
      (
        await fetch(
          `${origin}/api/editor/builds/${built.id}/files/not-in-manifest.bsp`,
        )
      ).status,
      404,
    );
    const leak = starterProject();
    leak.brushes.splice(1, 1);
    const leaked = await wait(
      (
        await (
          await request("/api/editor/builds", "POST", { project: leak })
        ).json()
      ).id,
    );
    assert.equal(leaked.status, "failed");
    assert.ok(leaked.leak.length > 0);
    assert.ok(leaked.logs.some((line) => /leak/i.test(line)));
    const invalid = starterProject();
    invalid.brushes[0].faces[0].texture = "missing";
    const missing = await wait(
      (
        await (
          await request("/api/editor/builds", "POST", { project: invalid })
        ).json()
      ).id,
    );
    assert.equal(missing.status, "failed");
    assert.match(missing.error, /Missing texture/);
    const cancel = await (
      await request("/api/editor/builds", "POST", { project: p })
    ).json();
    await request(`/api/editor/builds/${cancel.id}`, "DELETE");
    assert.equal((await wait(cancel.id)).status, "cancelled");
    assert.equal(
      (await fetch(`${origin}/api/editor/sessions/ended`)).status,
      410,
    );
    const oversized = await fetch(`${origin}/api/editor/builds`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Editor-Token": config.token,
      },
      body: JSON.stringify({ padding: "x".repeat(16 * 1024 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    const forbidden = {
        url: "/api/editor/config",
        method: "GET",
        headers: { host: new URL(origin).host },
        socket: { remoteAddress: "192.168.1.60" },
      },
      blocked = {
        writeHead(status) {
          this.status = status;
          return this;
        },
        end() {},
      };
    await service.handler(forbidden, blocked, new URL(forbidden.url, origin));
    assert.equal(blocked.status, 403);
    service.settings.buildTimeoutMs = 1;
    const timed = await wait(
      (
        await (
          await request("/api/editor/builds", "POST", { project: p })
        ).json()
      ).id,
    );
    assert.equal(timed.status, "cancelled");
    assert.match(timed.error, /time limit/);
    const disabled = createEditorService(root, options, {
      enabled: false,
      lan: false,
      port: 4434,
      origin,
    });
    const req = {
        url: "/api/editor/config",
        method: "GET",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      },
      res = {
        writeHead(status) {
          this.status = status;
          return this;
        },
        end() {},
      };
    await disabled.handler(req, res, new URL(req.url, origin));
    assert.equal(res.status, 404);
    await rm(path.join(root, "runtime/id1/pak0.pak"));
    const unavailable = await (await fetch(`${origin}/api/editor/config`)).json();
    assert.equal(unavailable.canPlay, false);
    const coop = await request("/api/editor/sessions", "POST", { buildId: built.id });
    assert.equal(coop.status, 400);
    assert.match((await coop.json()).error, /pak0\.pak/);
  } finally {
    await service.stop();
    await new Promise((resolve) => server.close(resolve));
    await cleanup(root);
  }
});

test("isolated playtest worker boots stock gameplay and frees its process on stop", async (t) => {
  const gameRoot = path.resolve(".");
  try {
    await access(path.join(gameRoot, "web/dist/engine/quakespasm.cjs"));
    await access(path.join(gameRoot, "runtime/id1/pak0.pak"));
  } catch {
    t.skip("Browser engine and local game data are required");
    return;
  }
  const root = await fixture(),
    port = Number(process.env.QUAKE_EDITOR_WORKER_TEST_PORT || 4498);
  const child = fork(path.join(gameRoot, "web/editor/session-worker.mjs"), [], {
    cwd: gameRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(output || "Worker startup timed out")),
        20000,
      );
      child.on("message", (m) => {
        if (m.type === "ready") {
          clearTimeout(timer);
          resolve(m.config);
        }
        if (m.type === "error") {
          clearTimeout(timer);
          reject(new Error(m.error));
        }
      });
      child.once("error", reject);
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(output));
      });
      child.send({
        type: "start",
        root: gameRoot,
        build: { directory: root, map: "e1m1", files: [] },
        options: {
          ...serverConfig({
            QUAKE_MULTIPLAYER_PORT: String(port),
            QUAKE_MULTIPLAYER_URL: `https://127.0.0.1:${port}/quake`,
          }),
          origins: ["http://127.0.0.1:3000"],
          certificateDirectory: path.join(root, "certificates"),
        },
        skill: 1,
      });
    });
    assert.equal(ready.available, true);
    assert.equal(ready.mode, "coop");
    assert.equal(ready.map, "e1m1");
    assert.equal(ready.maxPlayers, 8);
    assert.match(ready.certificateHash, /^[a-f0-9]{64}$/);
    const exited = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Worker did not stop")),
        5000,
      );
      child.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    child.send({ type: "stop" });
    assert.equal(await exited, 0);
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    }
    await cleanup(root);
  }
});
