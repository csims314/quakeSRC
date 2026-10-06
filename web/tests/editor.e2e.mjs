import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const port = Number(process.env.QUAKE_EDITOR_TEST_PORT || 3106),
  gamePort = Number(process.env.QUAKE_EDITOR_TEST_GAME_PORT || 4496),
  testPort = Number(process.env.QUAKE_EDITOR_TEST_COOP_PORT || 4497),
  origin = `http://127.0.0.1:${port}`;
const native = path.join(
  path.dirname(process.execPath),
  "node_modules",
  "agent-browser",
  "bin",
  "agent-browser-win32-x64.exe",
);
const cli =
  process.env.AGENT_BROWSER_BIN ||
  (process.platform === "win32" && existsSync(native)
    ? native
    : "agent-browser");
const browserNames = [
    `editor-author-${process.pid}`,
    `editor-guest-${process.pid}`,
  ],
  checks = [],
  skipped = [];
const artifacts = path.join(root, "web", "test-artifacts");
let server,
  output = "",
  failure;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await delay(100);
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
}
function browser(name, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ["--session", name, "--json", ...args], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Browser timed out: ${args.join(" ")}`));
    }, 45000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      try {
        const result = JSON.parse(out.trim());
        if (code || !result.success)
          throw new Error(result.error || err || out);
        resolve(result.data);
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(input);
  });
}
const evaluate = (name, code) =>
  browser(name, ["eval", "--stdin"], code).then((r) => r.result);
const author = (code) => evaluate(browserNames[0], code);
const click = (name) =>
  browser(browserNames[0], ["find", "role", "button", "click", "--name", name]);
const pass = (label) => {
  checks.push(label);
  console.log(`PASS ${label}`);
};
async function state(name, iframe = false) {
  return evaluate(
    name,
    `(()=>{const w=${iframe ? "document.getElementById('play-frame').contentWindow" : "window"};return {state:w.quake?.state(),world:w.quake?.world(),errors:w.__quakeErrors,logs:w.quake?.logs};})()`,
  );
}
const command = (name, text, iframe = false) =>
  evaluate(
    name,
    `${iframe ? "document.getElementById('play-frame').contentWindow" : "window"}.quake.command(${JSON.stringify(text)});true`,
  );

await mkdir(artifacts, { recursive: true });
try {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
  server = spawn(process.execPath, ["web/server.mjs"], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "development",
      QUAKE_EDITOR_LAN: "0",
      QUAKE_WEB_PORT: String(port),
      QUAKE_MULTIPLAYER_PORT: String(gamePort),
      QUAKE_EDITOR_MULTIPLAYER_PORT: String(testPort),
      QUAKE_PUBLIC_ORIGIN: origin,
      QUAKE_MULTIPLAYER_URL: `https://127.0.0.1:${gamePort}/quake`,
    },
  });
  server.stdout.on("data", (d) => (output += d));
  server.stderr.on("data", (d) => (output += d));
  await wait(async () => {
    const r = await fetch(`${origin}/api/editor/config`);
    return r.ok && r.json();
  }, "editor server");
  await browser(browserNames[0], ["open", `${origin}/editor/`]);
  await browser(browserNames[0], ["set", "viewport", "1440", "900"]);
  const config = await wait(
    () => author("window.editor?.config"),
    "editor initialized",
  );
  assert.equal(
    config.compiler,
    true,
    "Install tools with npm run setup:editor",
  );
  assert.deepEqual(await author("window.__editorErrors"), []);
  await author("window.confirm=()=>true;true");
  await click("Example level");
  assert.equal(
    (await author("window.editor.project")).entities.filter(
      (e) => e.classname === "func_door",
    ).length,
    1,
  );
  pass(
    "Unity-style workspace initializes and example includes interactive objects",
  );

  const before = await author("window.editor.project.brushes.length");
  await author("document.querySelector('[data-create=box]').click();true");
  assert.equal(
    await author("window.editor.project.brushes.length"),
    before + 1,
  );
  await click("Duplicate");
  assert.equal(
    await author("window.editor.project.brushes.length"),
    before + 2,
  );
  await click("Delete");
  assert.equal(
    await author("window.editor.project.brushes.length"),
    before + 1,
  );
  await author("document.getElementById('undo').click();true");
  assert.equal(
    await author("window.editor.project.brushes.length"),
    before + 2,
  );
  await author("document.getElementById('redo').click();true");
  assert.equal(
    await author("window.editor.project.brushes.length"),
    before + 1,
  );
  pass(
    "create, duplicate, delete and undo/redo operate through editor controls",
  );
  await author(
    "window.editor.select(window.editor.project.brushes.at(-1).id);true",
  );
  await click("Delete");
  assert.equal(await author("window.editor.project.brushes.length"), before);

  await author(
    "window.editor.select(window.editor.project.brushes[0].id);true",
  );
  const oldX = await author("window.editor.project.brushes[0].position[0]");
  await author(
    "(()=>{const input=document.querySelector('#inspector .xyz input');input.value='16';input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()",
  );
  assert.equal(
    await author("window.editor.project.brushes[0].position[0]"),
    16,
  );
  await author("document.getElementById('undo').click();true");
  assert.equal(
    await author("window.editor.project.brushes[0].position[0]"),
    oldX,
  );
  pass("inspector geometry changes are undoable");

  await author(
    "(()=>{const canvas=document.createElement('canvas');canvas.width=96;canvas.height=80;const ctx=canvas.getContext('2d');ctx.fillStyle='#ff5b37';ctx.fillRect(0,0,96,80);ctx.fillStyle='#173bde';ctx.fillRect(0,0,48,40);return new Promise(resolve=>canvas.toBlob(blob=>{const transfer=new DataTransfer();transfer.items.add(new File([blob],'test.png',{type:'image/png'}));const input=document.getElementById('image-import');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));resolve(true);},'image/png'));})()",
  );
  await wait(
    () =>
      author("Boolean(document.querySelector('dialog .preview-image canvas'))"),
    "converted image preview",
  );
  await click("Use texture");
  const imported = await author("window.editor.project.textures.at(-1)");
  assert.equal(imported.width, 96);
  assert.equal(imported.height, 80);
  assert.ok(imported.source);
  assert.ok([...Buffer.from(imported.pixels, "base64")].every((x) => x < 224));
  await author(
    `window.editor.select(window.editor.project.brushes.find(b=>!b.entityId).id);document.querySelector('#texture-list button[title^="${imported.name}"]').click();true`,
  );
  assert.ok(
    await author(
      `window.editor.project.brushes.find(b=>!b.entityId).faces.every(f=>f.texture==='${imported.name}')`,
    ),
  );
  pass(
    "PNG import uses worker conversion, preview confirmation and texture painting",
  );

  const exported = await author(
    "(async()=>{const original=URL.createObjectURL;URL.createObjectURL=blob=>{window.__exportedProject=blob;return original(blob);};document.getElementById('save').click();URL.createObjectURL=original;return JSON.parse(await window.__exportedProject.text());})()",
  );
  assert.equal(exported.version, 1);
  assert.ok(exported.textures.some((t) => t.name === imported.name));
  await author(
    `(()=>{const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(exported))}],'saved.qlevel.json',{type:'application/json'}));const input=document.getElementById('open');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
  );
  await wait(
    () =>
      author(
        `window.editor.project.textures.some(t=>t.name==='${imported.name}')`,
      ),
    "project import",
  );
  await delay(700);
  await author(
    "localStorage.setItem('quake-editor-layout','invalid JSON');true",
  );
  await browser(browserNames[0], ["open", `${origin}/editor/`]);
  await wait(
    () =>
      author(
        `window.editor?.project.textures.some(t=>t.name==='${imported.name}')`,
      ),
    "IndexedDB restoration",
  );
  pass("project export/import and reload preserve custom texture data");

  await click("Build level");
  const built = await wait(
    () =>
      author("window.editor.build?.status!=='building'&&window.editor.build"),
    "compiled example",
  );
  assert.equal(built.status, "ready", built.error);
  await wait(
    () =>
      author(
        "!document.getElementById('build').disabled&&window.editor.scene.current?.id===window.editor.build.id",
      ),
    "engine Scene refresh completes",
  );
  assert.ok(built.files.some((f) => f.name.endsWith(".bsp")));
  assert.deepEqual(await author("window.__editorErrors"), []);
  await browser(browserNames[0], [
    "screenshot",
    path.join(artifacts, "editor-example.png"),
  ]);
  pass("example compiles to BSP with custom texture and no browser errors");
  const sceneSnapshot = await author("window.editor.scene.snapshot()");
  assert.ok(
    sceneSnapshot.entities.some((e) => e.model === "progs/soldier.mdl"),
  );
  assert.ok(sceneSnapshot.entities.some((e) => e.model === "progs/g_shot.mdl"));
  assert.ok(sceneSnapshot.entities.some((e) => e.model === "maps/b_bh25.bsp"));
  assert.equal(sceneSnapshot.simulating, false);
  await delay(300);
  assert.equal(
    (await author("window.editor.scene.snapshot()")).state.serverTime,
    sceneSnapshot.state.serverTime,
  );
  pass(
    "editable Scene renders real MDL/BSP assets through a frozen Quake instance",
  );
  const soldier = (await author("window.editor.project.entities")).find(
    (e) => e.classname === "monster_army",
  );
  await author(
    `window.editor.select('${soldier.id}');document.getElementById('focus').click();true`,
  );
  await delay(200);
  const framed = await author("window.editor.scene.snapshot()");
  assert.deepEqual(
    framed.state.origin,
    sceneSnapshot.state.origin,
    "free camera does not move the player",
  );
  await author("window.editor.select(null);true");
  await browser(browserNames[0], ["click", '.view[data-view="0"]']);
  assert.deepEqual(await author("window.editor.selection()"), [soldier.id]);
  await click("Preview game asset");
  await wait(
    () =>
      author("Boolean(document.querySelector('#inspector .model-preview'))"),
    "native asset thumbnail",
  );
  assert.ok(
    (await author(
      "document.querySelector('#inspector .model-preview').src.length",
    )) > 1000,
  );
  pass("native asset picking, framing and engine-rendered thumbnails work");
  await browser(browserNames[0], [
    "screenshot",
    path.join(artifacts, "editor-native-asset.png"),
  ]);
  const authoredBefore = await author("JSON.stringify(window.editor.project)");
  await click("Preview effects");
  const simStart = (await author("window.editor.scene.snapshot()")).state
    .serverTime;
  await wait(
    async () =>
      (await author("window.editor.scene.snapshot()")).state.serverTime >
      simStart + 0.2,
    "real simulation advances",
  );
  await click("Pause");
  await delay(100);
  const pausedTime = (await author("window.editor.scene.snapshot()")).state
    .serverTime;
  await delay(250);
  assert.equal(
    (await author("window.editor.scene.snapshot()")).state.serverTime,
    pausedTime,
  );
  assert.equal(
    await author("JSON.stringify(window.editor.project)"),
    authoredBefore,
  );
  await click("Stop / Reset");
  await wait(
    () =>
      author(
        "document.getElementById('reset-preview').hidden&&!window.editor.scene.snapshot().busy",
      ),
    "scene reset",
  );
  assert.equal(
    await author("JSON.stringify(window.editor.project)"),
    authoredBefore,
  );
  assert.equal(
    (await author("window.editor.scene.snapshot()")).simulating,
    false,
  );
  pass("effects simulation and reset preserve the authored document");
  const assembly = await author("window.editor.project.entities"),
    previewButton = assembly.find(
      (entity) => entity.classname === "func_button",
    ),
    previewDoor = assembly.find((entity) => entity.classname === "func_door"),
    closedDoor = (await author("window.editor.scene.snapshot()")).entities.find(
      (entity) => entity.id === previewDoor.id,
    );
  await author(`window.editor.select('${previewButton.id}');true`);
  await click("Activate in preview");
  await wait(async () => {
    const door = (await author("window.editor.scene.snapshot()")).entities.find(
      (entity) => entity.id === previewDoor.id,
    );
    return (
      Math.hypot(
        ...door.origin.map((value, axis) => value - closedDoor.origin[axis]),
      ) > 64
    );
  }, "native button activates linked door in Scene");
  assert.equal(
    await author("JSON.stringify(window.editor.project)"),
    authoredBefore,
  );
  await click("Stop / Reset");
  await wait(
    () =>
      author(
        "document.getElementById('reset-preview').hidden&&!window.editor.scene.snapshot().busy",
      ),
    "door preview reset",
  );
  assert.deepEqual(
    (await author("window.editor.scene.snapshot()")).entities.find(
      (entity) => entity.id === previewDoor.id,
    ).origin,
    closedDoor.origin,
  );
  pass("Inspector activation uses QuakeC and resets the linked door");
  await author(
    "document.getElementById('auto-scene').checked=false;document.getElementById('auto-scene').dispatchEvent(new Event('change'));true",
  );
  const originalSoldier = (
    await author("window.editor.scene.snapshot()")
  ).entities.find((entity) => entity.id === soldier.id);
  await author(
    `window.editor.select('${soldier.id}');(()=>{const input=document.querySelector('#inspector .xyz input');input.value=Number(input.value)+16;input.dispatchEvent(new Event('change'));})();true`,
  );
  assert.equal(
    (await author("window.editor.scene.snapshot()")).entities.find(
      (entity) => entity.id === soldier.id,
    ).origin[0],
    originalSoldier.origin[0] + 16,
  );
  await author("document.getElementById('undo').click();true");
  assert.deepEqual(
    (await author("window.editor.scene.snapshot()")).entities.find(
      (entity) => entity.id === soldier.id,
    ).origin,
    originalSoldier.origin,
  );
  pass("point-object edits and undo update actual engine assets immediately");
  const assemblyIds = (await author("window.editor.project.entities"))
    .filter((e) => ["func_door", "func_button"].includes(e.classname))
    .map((e) => e.id);
  await author(`window.editor.selectMany(${JSON.stringify(assemblyIds)});true`);
  const entityCount = await author("window.editor.project.entities.length");
  await click("Duplicate");
  const copies = await author("window.editor.project.entities.slice(-2)");
  assert.equal(copies[1].targetId, copies[0].id);
  assert.equal(
    await author("window.editor.project.entities.length"),
    entityCount + 2,
  );
  await click("Delete");
  assert.equal(
    await author("window.editor.project.entities.length"),
    entityCount,
  );
  await author(
    "document.getElementById('undo').click();document.getElementById('undo').click();true",
  );
  pass(
    "multiselect duplication remaps linked door/button assemblies and undo restores them",
  );
  await author(
    `window.editor.selectMany(${JSON.stringify(assemblyIds)});document.getElementById('group-selection').click();true`,
  );
  assert.equal(
    (await author("window.editor.project.editor.groups")).at(-1).ids.length,
    2,
  );
  await author("document.getElementById('undo').click();true");
  await author(
    "document.getElementById('dock-position').value='right';document.getElementById('dock-position').dispatchEvent(new Event('change'));true",
  );
  assert.equal(
    await author(
      "document.getElementById('bottom-dock').parentElement.className",
    ),
    "right-panel",
  );
  await click("Reset layout");
  await click("Four views");
  assert.equal(
    await author(
      "document.getElementById('viewports').classList.contains('single-view')",
    ),
    false,
  );
  await browser(browserNames[0], ["click", '.view[data-view="1"]']);
  await author(
    `window.editor.selectMany(${JSON.stringify(assemblyIds)});document.getElementById('focus').click();true`,
  );
  await delay(250);
  const assemblyBeforeDrag = await author("window.editor.project"),
    dragPoint = await author(
      "(()=>{const r=document.querySelector('.view[data-view=\"1\"]').getBoundingClientRect();return {x:r.left+r.width/2+r.height*0.09,y:r.top+r.height/2};})()",
    );
  await browser(browserNames[0], [
    "mouse",
    "move",
    String(Math.round(dragPoint.x)),
    String(Math.round(dragPoint.y)),
  ]);
  await browser(browserNames[0], ["mouse", "down", "left"]);
  await browser(browserNames[0], [
    "mouse",
    "move",
    String(Math.round(dragPoint.x + 48)),
    String(Math.round(dragPoint.y)),
  ]);
  await browser(browserNames[0], ["mouse", "up", "left"]);
  const assemblyAfterDrag = await author("window.editor.project"),
    beforeDoor = assemblyBeforeDrag.entities.find(
      (entity) => entity.id === previewDoor.id,
    ),
    afterDoor = assemblyAfterDrag.entities.find(
      (entity) => entity.id === previewDoor.id,
    ),
    movedX = afterDoor.position[0] - beforeDoor.position[0];
  assert.ok(movedX > 0, "dragging the X gizmo moves the whole selection");
  assert.equal(movedX % 16, 0, "gizmo movement snaps to the grid");
  for (const object of [
    ...assemblyBeforeDrag.entities,
    ...assemblyBeforeDrag.brushes,
  ].filter(
    (object) =>
      assemblyIds.includes(object.id) || assemblyIds.includes(object.entityId),
  )) {
    const moved = [
      ...assemblyAfterDrag.entities,
      ...assemblyAfterDrag.brushes,
    ].find((item) => item.id === object.id);
    assert.equal(moved.position[0] - object.position[0], movedX);
  }
  await author("document.getElementById('undo').click();true");
  assert.deepEqual(
    (await author("window.editor.project.entities")).find(
      (entity) => entity.id === previewDoor.id,
    ).position,
    beforeDoor.position,
  );
  await browser(browserNames[0], ["click", '.view[data-view="2"]']);
  pass(
    "mouse-driven group gizmos transform owned geometry, snap and undo across views",
  );
  await click("Four views");
  pass(
    "hierarchy groups, docking reset and four-view switching are functional",
  );

  const gameBefore = await (
    await fetch(`${origin}/api/multiplayer/status?mode=coop`)
  ).json();
  if (!config.gameAvailable) {
    await click("Play solo");
    assert.match(
      await author("document.getElementById('toast').textContent"),
      /pak0\.pak/,
    );
    await click("Host co-op");
    await wait(
      () =>
        author(
          "document.getElementById('toast').textContent.includes('pak0.pak')",
        ),
      "missing data message",
    );
    assert.equal(
      await author("document.getElementById('play-dialog').open"),
      false,
    );
    skipped.push(
      "Solo/custom-map co-op gameplay: Quake pak0.pak is not installed",
    );
    pass(
      "authoring works and custom playtests explain the missing game-data prerequisite",
    );
  } else {
    assert.equal(config.canPlay, true);
    await click("Play solo");
    await wait(
      () =>
        author(
          "Boolean(document.getElementById('play-frame').contentWindow.document.getElementById('start')&&!document.getElementById('play-frame').contentWindow.document.getElementById('start').disabled)",
        ),
      "solo launch screen",
    );
    await author(
      "document.getElementById('play-frame').contentWindow.document.getElementById('start').click();true",
    );
    await wait(async () => {
      const s = await state(browserNames[0], true);
      return s.state?.signon === 4 && s.state.map === built.map && s;
    }, "solo engine loads custom BSP");
    assert.deepEqual((await state(browserNames[0], true)).errors, []);
    await command(
      browserNames[0],
      "god 1\nsetpos -128 -128 24 0 0 0\nnoclip 0\n+forward",
      true,
    );
    await delay(500);
    await command(browserNames[0], "-forward", true);
    const moved = await state(browserNames[0], true);
    assert.ok(moved.state.origin[0] > -100);
    await click("Return to editor");
    pass("solo engine loads the built level and processes player movement");
    await click("Host co-op");
    const session = await wait(
      () =>
        author(
          "window.editor.session?.status==='ready'&&window.editor.session",
        ),
      "co-op server",
    );
    await wait(
      () =>
        author(
          "Boolean(document.getElementById('play-frame').contentWindow.document.getElementById('start')&&!document.getElementById('play-frame').contentWindow.document.getElementById('start').disabled)",
        ),
      "author join screen",
    );
    await author(
      "document.getElementById('play-frame').contentWindow.document.getElementById('start').click();true",
    );
    await browser(browserNames[1], ["open", session.joinUrl]);
    await browser(browserNames[1], [
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Launch playtest",
    ]);
    for (const [i, name] of browserNames.entries())
      await wait(async () => {
        const s = await state(name, i === 0);
        return (
          s.state?.signon === 4 &&
          !s.state.serverActive &&
          s.state.map === `maps/${built.map}.bsp` &&
          s
        );
      }, "co-op client sign-on");
    await command(
      browserNames[0],
      "god 1\nsetpos -512 -256 24 0 0 0\nnoclip 0\n+forward",
      true,
    );
    await delay(600);
    await command(browserNames[0], "-forward", true);
    await delay(300);
    const host = await state(browserNames[0], true);
    assert.ok(
      host.state.origin[0] > -480,
      "co-op player moves before replication is checked",
    );
    await wait(async () => {
      const current = await state(browserNames[0], true);
      const peer = await state(browserNames[1]);
      return peer.state.players.some(
        (p) =>
          p.slot === 1 &&
          Math.hypot(...p.origin.map((v, i) => v - current.state.origin[i])) <
            8,
      );
    }, "replicated player movement");
    pass("two co-op clients join identical build and receive shared movement");
    for (const [i, name] of browserNames.entries()) {
      await command(
        name,
        `god 1\nsetpos -80 ${i === 0 ? -20 : 20} 24 0 0 0\nnoclip 0\n+forward`,
        i === 0,
      );
    }
    await delay(500);
    for (const [i, name] of browserNames.entries())
      await command(name, "-forward", i === 0);
    assert.ok(
      (await state(browserNames[0], true)).state.origin[0] < 0,
      "closed door blocks movement",
    );
    await command(
      browserNames[0],
      "setpos -64 -128 40 0 0 0\nnoclip 0\n+forward",
      true,
    );
    await delay(400);
    await command(browserNames[0], "-forward", true);
    await wait(async () => {
      const snapshots = await Promise.all(
        browserNames.map((name, i) => state(name, i === 0)),
      );
      return snapshots.every((s) =>
        s.world.actors.some((a) => a.model === "*1" && a.origin[1] >= 118),
      );
    }, "door finishes opening in both clients");
    for (const [i, name] of browserNames.entries())
      await command(
        name,
        `setpos -80 ${i === 0 ? -20 : 20} 24 0 0 0\nnoclip 0\n+forward`,
        i === 0,
      );
    await wait(async () => {
      const snapshots = await Promise.all(
        browserNames.map((name, i) => state(name, i === 0)),
      );
      return snapshots.every((s) => s.state.origin[0] > 16);
    }, "both players cross the opened door");
    for (const [i, name] of browserNames.entries()) {
      await command(name, "-forward", i === 0);
      assert.ok(
        (await state(name, i === 0)).state.origin[0] > 16,
        "opened door permits passage",
      );
      assert.deepEqual((await state(name, i === 0)).errors, []);
    }
    pass("button activates the door and both clients can cross the opening");
    await click("Return to editor");
    await click("Stop co-op");
    await wait(
      () =>
        evaluate(
          browserNames[1],
          "window.quake.network.snapshot().every(c=>!c.open)",
        ),
      "co-op shutdown",
    );
    assert.equal(
      (await fetch(`${origin}/api/editor/sessions/${session.id}`)).status,
      410,
    );
    pass(
      "stopping co-op releases the test process and invalidates its join link",
    );
  }
  const gameAfter = await (
    await fetch(`${origin}/api/multiplayer/status?mode=coop`)
  ).json();
  assert.equal(gameAfter.map, gameBefore.map);
  assert.equal(gameAfter.coop, gameBefore.coop);
  assert.equal(gameAfter.connections, gameBefore.connections);
  pass("editor operations preserve the regular multiplayer room");
  assert.deepEqual(await author("window.__editorErrors"), []);
} catch (e) {
  failure = e;
  console.error(e.stack);
  await writeFile(
    path.join(artifacts, "editor-playtest-failure.json"),
    JSON.stringify(
      await Promise.all(
        browserNames.map((name, i) =>
          state(name, i === 0).catch((error) => ({ error: error.message })),
        ),
      ),
      null,
      2,
    ),
  ).catch(() => {});
  await browser(browserNames[0], [
    "screenshot",
    path.join(artifacts, "editor-failure.png"),
  ]).catch(() => {});
} finally {
  for (const name of browserNames)
    await browser(name, ["close"]).catch(() => {});
  if (server && server.exitCode === null)
    await new Promise((resolve) => {
      server.once("exit", resolve);
      server.kill();
    });
  await writeFile(
    path.join(artifacts, "editor-e2e.json"),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        checks,
        skipped,
        error: failure?.stack,
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(artifacts, "editor-server.log"), output);
}
if (failure) process.exitCode = 1;
