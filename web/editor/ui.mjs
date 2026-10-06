import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { zipSync, strToU8 } from "fflate";
import { EngineScene } from "./engine-scene.mjs";
import { createWorkspace } from "./workspace.mjs";
import {
  metadata,
  sceneObjects,
  displayName,
  groupSelection,
  duplicateObjects,
  removeObjects,
  translateObjects,
  templateFromSelection,
  insertTemplate,
} from "./document.mjs";
import { createProjectBrowser } from "./project-browser.mjs";
import {
  TYPES,
  starterProject,
  newBrush,
  newEntity,
  roomBrushes,
  cutOpening,
  brushFaces,
  validateProject,
  clone,
  uid,
  snap,
} from "./domain.mjs";

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
const $ = (id) => document.getElementById(id),
  host = $("viewports");
let fourViews = false,
  showOverlays = true,
  sceneBuildTimer,
  sceneProject = null;
let selectedIds = new Set(),
  selectedGroup = null,
  dragMatrix;
const collapsedGroups = new Set();
let projectBrowser,
  sceneSource = null,
  compiledSource = null;
let flyActive = false,
  flyPointer,
  flyTime = performance.now();
const flyKeys = new Set();
const engineScene = new EngineScene($("scene-frame"), (text) => {
  $("scene-revision").textContent = text;
});
const workspace = createWorkspace();
function switchTab(type) {
  workspace.tab(type);
  requestAnimationFrame(resize);
}
let project = starterProject(),
  config = null,
  selectedId = null,
  selectedFace = null,
  faceMode = false,
  currentTexture = "ed_grid";
let build = null,
  session = null,
  building = false,
  grid = 16,
  activeView = 0,
  history = [],
  future = [],
  autosaveTimer,
  db;
const textures = new Map(),
  materialCache = new Map(),
  objectGroups = new Map();
let textureCatalogue = [],
  cursor = [0, 0, 64],
  dragSnapshot = null;
let cutaway = false,
  textureLimit = 150;
const toast = (message) => {
  const element = $("toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(element.timer);
  element.timer = setTimeout(() => (element.hidden = true), 5000);
};
const error = (e) => {
  console.error(e);
  toast(e.message || String(e));
};
const b64 = (bytes) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Editor-Token": config?.token || "",
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
function download(name, data, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function remember(snapshot = project) {
  history.push(clone(snapshot));
  if (history.length > 64) history.shift();
  future = [];
}
function change(fn) {
  if (!$("reset-preview").hidden) {
    toast("Stop / Reset preview to edit the level");
    return;
  }
  remember();
  fn();
  project.revision++;
  changed();
}
function changed() {
  if (engineScene.current && !engineScene.busy && $("reset-preview").hidden) {
    const ids = new Set(project.entities.map((entity) => entity.id));
    for (const entity of engineScene.entities)
      engineScene.hide(
        entity.id,
        !ids.has(entity.id) || metadata(project).hidden.includes(entity.id),
      );
    for (const entity of project.entities)
      if (!TYPES[entity.classname].brush) engineScene.preview(entity);
    engineScene.entities = engineScene.snapshot()?.entities || [];
  }
  refresh();
  queueSceneBuild();
  clearTimeout(autosaveTimer);
  $("save-status").textContent = "Saving…";
  autosaveTimer = setTimeout(saveLocal, 500);
}
async function saveLocal() {
  if (!db) return;
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("projects", "readwrite");
      transaction.objectStore("projects").put(project, "last");
      transaction.objectStore("projects").put(project, `project:${project.id}`);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    $("save-status").textContent = "Saved in this browser";
    renderAssets();
  } catch (e) {
    $("save-status").textContent = "Export a backup";
    error(e);
  }
}
async function openStorage() {
  db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("quake-workshop", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("projects");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const saved = await new Promise((resolve, reject) => {
    const request = db
      .transaction("projects")
      .objectStore("projects")
      .get("last");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (saved) {
    validateProject(saved, { requireSpawn: false });
    project = saved;
  }
}
function selection() {
  if (!selectedId) return {};
  const entity = project.entities.find((e) => e.id === selectedId),
    brush =
      project.brushes.find((b) => b.id === selectedId) ||
      project.brushes.find((b) => b.entityId === selectedId);
  return { entity, brush, object: entity || brush };
}
function label(obj) {
  return obj ? displayName(project, obj) : "Object";
}
function select(id, face = null, additive = false) {
  const data = metadata(project);
  selectedGroup = null;
  if (!additive) selectedIds.clear();
  if (id) {
    if (additive && selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
  }
  if (!selectedIds.has(id)) id = [...selectedIds].at(-1) || null;
  selectedId = id;
  selectedFace = face;
  engineScene.select(id, showOverlays);
  refreshSelection();
  renderInspector();
  renderList();
}
function selectMany(ids, group = null) {
  selectedIds = new Set(ids);
  selectedId = [...selectedIds][0] || null;
  selectedFace = null;
  selectedGroup = group;
  refreshSelection();
  renderInspector();
  renderList();
  engineScene.select(selectedId, showOverlays);
}

const renderer = new THREE.WebGLRenderer({
  canvas: $("viewport-canvas"),
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setScissorTest(true);
renderer.setClearColor("#151d23", 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(),
  world = new THREE.Group();
const selectionPivot = new THREE.Group();
selectionPivot.userData.pivot = true;
scene.add(world);
const gridHelper = new THREE.GridHelper(4096, 256, 0x486058, 0x2b373c);
gridHelper.rotation.x = Math.PI / 2;
gridHelper.position.z = -0.2;
scene.add(gridHelper);
const axis = new THREE.AxesHelper(256);
scene.add(axis);
const cameras = [
  new THREE.PerspectiveCamera(55, 1, 1, 30000),
  ...Array.from(
    { length: 3 },
    () => new THREE.OrthographicCamera(-800, 800, 600, -600, 1, 30000),
  ),
];
cameras[0].position.set(1200, -1500, 1200);
cameras[0].lookAt(0, 0, 64);
cameras[1].position.set(0, 0, 8000);
cameras[1].up.set(0, 1, 0);
cameras[1].lookAt(0, 0, 0);
cameras[2].position.set(0, -8000, 128);
cameras[2].lookAt(0, 0, 128);
cameras[3].position.set(8000, 0, 128);
cameras[3].lookAt(0, 0, 128);
const views = [...document.querySelectorAll(".view")];
const controls = cameras.map((camera, i) => {
  const control = new OrbitControls(camera, views[i]);
  control.target.set(0, 0, i === 1 ? 0 : 128);
  control.enableRotate = i === 0;
  control.enableDamping = true;
  control.minDistance = 48;
  control.maxDistance = 12000;
  control.maxZoom = 16;
  control.minZoom = 0.1;
  control.update();
  return control;
});
const transform = new TransformControls(cameras[0], views[0]),
  gizmo = transform.getHelper();
scene.add(gizmo);
transform.setTranslationSnap(grid);
transform.setRotationSnap(Math.PI / 12);
transform.setScaleSnap(0.125);
transform.addEventListener("dragging-changed", (event) =>
  controls.forEach((c) => (c.enabled = !event.value)),
);
transform.addEventListener("mouseDown", () => {
  dragSnapshot = clone(project);
  transform.object?.updateMatrixWorld(true);
  dragMatrix = transform.object?.matrixWorld.clone();
});
transform.addEventListener("mouseUp", () => {
  const { brush, entity, object } = selection();
  if (!object || !dragSnapshot) return;
  const group = objectGroups.get(selectedId),
    before = clone(dragSnapshot);
  if (selectedIds.size > 1 || (entity && TYPES[entity.classname].brush)) {
    transform.object.updateMatrixWorld(true);
    const delta = transform.object.matrixWorld
      .clone()
      .multiply(dragMatrix.clone().invert());
    const q = new THREE.Quaternion(),
      s = new THREE.Vector3(),
      p = new THREE.Vector3();
    delta.decompose(p, q, s);
    const factor = transform.mode === "scale" ? Math.max(s.x, s.y, s.z) : 1;
    if (transform.mode === "scale") {
      const center = new THREE.Vector3().setFromMatrixPosition(dragMatrix);
      delta
        .makeTranslation(...center.toArray())
        .multiply(new THREE.Matrix4().makeScale(factor, factor, factor))
        .multiply(
          new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z),
        );
    }
    for (const obj of [...project.entities, ...project.brushes]) {
      if (!selectedIds.has(obj.id) && !selectedIds.has(obj.entityId)) continue;
      const previous = [...before.entities, ...before.brushes].find(
        (o) => o.id === obj.id,
      );
      obj.position = new THREE.Vector3(...previous.position)
        .applyMatrix4(delta)
        .toArray()
        .map((v) => snap(v, grid));
      if (obj.rotation) {
        const original = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            ...previous.rotation.map((v) => (v * Math.PI) / 180),
            "ZYX",
          ),
        );
        const euler = new THREE.Euler().setFromQuaternion(
          q.clone().multiply(original),
          "ZYX",
        );
        obj.rotation = [euler.x, euler.y, euler.z].map((v) =>
          snap((v * 180) / Math.PI, 15),
        );
        obj.size = previous.size.map((v) =>
          Math.max(grid, snap(v * factor, grid)),
        );
      } else if (transform.mode === "rotate")
        obj.properties.angle = String(
          snap(
            Number(previous.properties.angle || 0) +
              (new THREE.Euler().setFromQuaternion(q, "ZYX").z * 180) / Math.PI,
            15,
          ),
        );
    }
    remember(before);
    project.revision++;
    dragSnapshot = null;
    changed();
    return;
  }
  if (brush) {
    brush.position = group.position.toArray().map((v) => snap(v, grid));
    brush.rotation = [group.rotation.x, group.rotation.y, group.rotation.z].map(
      (v) => snap((v * 180) / Math.PI, 15),
    );
    brush.size = brush.size.map((v, i) =>
      Math.max(grid, snap(v * group.scale.toArray()[i], grid)),
    );
    if (entity) entity.position = [...brush.position];
  } else {
    entity.position = group.position.toArray().map((v) => snap(v, grid));
    if (transform.mode === "rotate")
      entity.properties.angle = String(
        snap((group.rotation.z * 180) / Math.PI, 15),
      );
  }
  remember(before);
  project.revision++;
  dragSnapshot = null;
  changed();
});
transform.addEventListener("objectChange", () => {
  if (!dragSnapshot) return;
  if (transform.mode === "scale")
    transform.object.scale.set(
      ...transform.object.scale.toArray().map((v) => Math.max(0.125, v)),
    );
  for (const id of selectedIds) {
    const entity = project.entities.find((e) => e.id === id),
      group = objectGroups.get(id);
    if (entity && !TYPES[entity.classname].brush && group) {
      const preview = clone(entity);
      preview.position = group.getWorldPosition(new THREE.Vector3()).toArray();
      engineScene.preview(preview);
    }
  }
});
const raycaster = new THREE.Raycaster(),
  pointer = new THREE.Vector2();
let pointerStart;
views.forEach((view, i) => {
  view.addEventListener(
    "pointerdown",
    (event) => {
      activeView = i;
      views.forEach((v, n) => v.classList.toggle("active", n === i));
      if (transform.camera !== cameras[i]) {
        transform.camera = cameras[i];
        transform.connect(view);
      }
      pointerStart = [event.clientX, event.clientY];
    },
    { capture: true },
  );
  view.addEventListener("pointerup", (event) => {
    if (
      event.button !== 0 ||
      transform.dragging ||
      !pointerStart ||
      Math.hypot(
        event.clientX - pointerStart[0],
        event.clientY - pointerStart[1],
      ) > 4
    )
      return;
    const r = view.getBoundingClientRect();
    pointer.set(
      ((event.clientX - r.left) / r.width) * 2 - 1,
      (-(event.clientY - r.top) / r.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, cameras[i]);
    const nativeIds = new Set(engineScene.entities.map((e) => e.id));
    const hits = raycaster
      .intersectObjects(world.children, true)
      .filter((h) => {
        const id = h.object.userData.id;
        if (
          !id ||
          metadata(project).locked.includes(id) ||
          metadata(project).hidden.includes(id)
        )
          return false;
        const entity = project.entities.find((e) => e.id === id);
        if (
          i === 0 &&
          entity &&
          !TYPES[entity.classname].brush &&
          nativeIds.has(id)
        )
          return false;
        const brush = project.brushes.find((b) => (b.entityId || b.id) === id);
        return i === 0 || !brush || !hiddenInCutaway(brush);
      });
    if (i === 0)
      for (const entity of engineScene.entities) {
        if (
          metadata(project).hidden.includes(entity.id) ||
          metadata(project).locked.includes(entity.id)
        )
          continue;
        const box = new THREE.Box3(
            new THREE.Vector3(...entity.mins).add(
              new THREE.Vector3(...entity.origin),
            ),
            new THREE.Vector3(...entity.maxs).add(
              new THREE.Vector3(...entity.origin),
            ),
          ),
          point = raycaster.ray.intersectBox(box, new THREE.Vector3());
        if (point)
          hits.push({
            object: { userData: { id: entity.id } },
            point,
            distance: raycaster.ray.origin.distanceTo(point),
          });
      }
    hits.sort((a, b) => a.distance - b.distance);
    if (i !== 0)
      hits.sort(
        (a, b) =>
          Number(
            Boolean(
              project.entities.find(
                (e) =>
                  e.id === b.object.userData.id && !TYPES[e.classname].brush,
              ),
            ),
          ) -
          Number(
            Boolean(
              project.entities.find(
                (e) =>
                  e.id === a.object.userData.id && !TYPES[e.classname].brush,
              ),
            ),
          ),
      );
    const unique = [
      ...new Map(hits.map((h) => [h.object.userData.id, h])).values(),
    ];
    const hit = event.altKey
      ? unique[
          (unique.findIndex((h) => h.object.userData.id === selectedId) + 1) %
            unique.length
        ]
      : hits[0];
    if (hit) {
      select(
        hit.object.userData.id,
        faceMode ? hit.object.userData.face : null,
        event.shiftKey || event.ctrlKey || event.metaKey,
      );
      cursor = hit.point.toArray().map((v) => snap(v, grid));
    } else {
      const normal =
        i === 2
          ? new THREE.Vector3(0, 1, 0)
          : i === 3
            ? new THREE.Vector3(1, 0, 0)
            : new THREE.Vector3(0, 0, 1);
      const result = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(new THREE.Plane(normal, 0), result))
        cursor = result.toArray().map((v) => snap(v, grid));
      select(null);
    }
  });
  view.addEventListener("contextmenu", (e) => e.preventDefault());
});
function resize() {
  const w = host.clientWidth,
    h = host.clientHeight;
  renderer.setSize(w, h, false);
  cameras.forEach((camera, i) => {
    const aspect = w / h;
    if (i === 0) {
      camera.aspect = aspect;
    } else {
      camera.left = -700 * aspect;
      camera.right = 700 * aspect;
      camera.top = 700;
      camera.bottom = -700;
    }
    camera.updateProjectionMatrix();
  });
}
new ResizeObserver(() => requestAnimationFrame(resize)).observe(host);
function hiddenInCutaway(b) {
  return (
    cutaway &&
    !b.entityId &&
    ((b.size[2] <= 32 && b.position[2] > 128) ||
      (b.size[2] > 64 &&
        ((b.size[0] <= 32 && b.position[0] * cameras[0].position.x > 0) ||
          (b.size[1] <= 32 && b.position[1] * cameras[0].position.y > 0))))
  );
}
function frame() {
  requestAnimationFrame(frame);
  const w = host.clientWidth,
    h = host.clientHeight;
  controls.forEach((c) => c.update());
  const now = performance.now(),
    dt = Math.min(0.05, (now - flyTime) / 1000);
  flyTime = now;
  if (flyActive) {
    const d = cameras[0].getWorldDirection(new THREE.Vector3()),
      right = new THREE.Vector3()
        .crossVectors(d, new THREE.Vector3(0, 0, 1))
        .normalize(),
      move = new THREE.Vector3();
    if (flyKeys.has("KeyW")) move.add(d);
    if (flyKeys.has("KeyS")) move.sub(d);
    if (flyKeys.has("KeyD")) move.add(right);
    if (flyKeys.has("KeyA")) move.sub(right);
    if (flyKeys.has("KeyE")) move.z++;
    if (flyKeys.has("KeyQ")) move.z--;
    if (move.lengthSq()) {
      move
        .normalize()
        .multiplyScalar(
          dt *
            (flyKeys.has("ShiftLeft") || flyKeys.has("ShiftRight") ? 768 : 256),
        );
      cameras[0].position.add(move);
      controls[0].target.add(move);
    }
  }
  engineScene.camera(cameras[0]);
  engineScene.refreshEntities();
  transform.enabled = $("reset-preview").hidden && showOverlays;
  gridHelper.visible = fourViews && showOverlays;
  axis.visible = showOverlays;
  for (let i = 0; i < (fourViews ? 4 : 1); i++) {
    world.traverse((obj) => {
      if (obj.isMesh) obj.visible = false; // Real assets/geometry are rendered only by Quake.
      if (obj.isLine || obj.isLineSegments) {
        const id = obj.parent.userData.id;
        const entity = project.entities.find((e) => e.id === id);
        const brush = project.brushes.find((b) => b.id === id);
        const nativePoint =
          i === 0 &&
          entity &&
          !TYPES[entity.classname].brush &&
          engineScene.entities.some((e) => e.id === id);
        obj.visible =
          !(nativePoint && selectedIds.size <= 1) &&
          !(i > 0 && brush && hiddenInCutaway(brush)) &&
          !metadata(project).hidden.includes(id) &&
          showOverlays &&
          (i > 0 ||
            selectedIds.has(id) ||
            (entity &&
              (entity.classname.startsWith("info_") ||
                entity.classname === "light" ||
                entity.classname.startsWith("trigger_"))) ||
            !id);
      }
    });
    const x = fourViews ? ((i % 2) * w) / 2 : 0,
      y = fourViews && i < 2 ? h / 2 : 0;
    renderer.setViewport(x, y, fourViews ? w / 2 : w, fourViews ? h / 2 : h);
    renderer.setScissor(x, y, fourViews ? w / 2 : w, fourViews ? h / 2 : h);
    renderer.setClearColor("#151d23", i === 0 ? 0 : 1);
    gizmo.visible =
      $("reset-preview").hidden &&
      showOverlays &&
      i === activeView &&
      Boolean(selectedId);
    renderer.render(scene, cameras[i]);
  }
}
frame();
function disposeWorld() {
  transform.detach();
  for (const child of [...selectionPivot.children]) world.attach(child);
  selectionPivot.clear();
  const cached = new Set(materialCache.values());
  world.traverse((obj) => {
    obj.geometry?.dispose();
    if (obj.material && !cached.has(obj.material)) obj.material.dispose();
  });
  world.clear();
  objectGroups.clear();
}
function rgbaCanvas(texture) {
  const canvas = document.createElement("canvas");
  canvas.width = texture.width;
  canvas.height = texture.height;
  const ctx = canvas.getContext("2d"),
    data = ctx.createImageData(canvas.width, canvas.height),
    pixels =
      typeof texture.pixels === "string"
        ? unb64(texture.pixels)
        : texture.pixels,
    palette =
      config?.palette ||
      Array.from({ length: 768 }, (_, i) => Math.floor(i / 3));
  for (let i = 0; i < pixels.length; i++) {
    data.data[i * 4] = palette[pixels[i] * 3];
    data.data[i * 4 + 1] = palette[pixels[i] * 3 + 1];
    data.data[i * 4 + 2] = palette[pixels[i] * 3 + 2];
    data.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}
async function fetchTexture(name) {
  if (textures.has(name)) return textures.get(name);
  const custom = project.textures.find((t) => t.name === name),
    t =
      custom || (await api(`/api/editor/textures/${encodeURIComponent(name)}`));
  textures.set(name, t);
  return t;
}
function material(name, trigger = false) {
  const key = name + (trigger ? "trigger" : "");
  if (materialCache.has(key)) return materialCache.get(key);
  const m = new THREE.MeshBasicMaterial({
    color: trigger ? 0xe8a365 : 0xffffff,
    transparent: trigger,
    opacity: trigger ? 0.2 : 1,
    side: THREE.DoubleSide,
  });
  materialCache.set(key, m);
  // Invisible picking geometry; Quake owns all textured/illuminated rendering.
  return m;
}
function rebuildScene() {
  disposeWorld();
  for (const b of project.brushes) {
    const id = b.entityId || b.id,
      owner = project.entities.find((e) => e.id === b.entityId);
    let group = objectGroups.get(id),
      parent;
    if (!group) {
      group = new THREE.Group();
      group.position.fromArray(owner ? owner.position : b.position);
      group.userData.id = id;
      objectGroups.set(id, group);
      world.add(group);
    }
    if (owner) {
      parent = new THREE.Group();
      parent.position.fromArray(
        b.position.map((v, i) => v - owner.position[i]),
      );
      parent.userData.id = id;
      group.add(parent);
    } else parent = group;
    parent.rotation.set(...b.rotation.map((v) => (v * Math.PI) / 180), "ZYX");
    const localFaces = brushFaces({
        ...b,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
      entity = project.entities.find((e) => e.id === b.entityId);
    localFaces.forEach((f, index) => {
      const positions = [],
        normals = [],
        surface = b.faces[index];
      for (let triangle = 1; triangle < f.vertices.length - 1; triangle++)
        for (const vertexIndex of [0, triangle, triangle + 1]) {
          positions.push(...f.vertices[vertexIndex]);
          normals.push(...f.normal);
        }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(normals, 3),
      );
      const mesh = new THREE.Mesh(
        geometry,
        material(surface.texture, entity?.classname.startsWith("trigger_")),
      );
      mesh.userData = { id, face: index };
      parent.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({
          color: id === selectedId ? 0x8bdfb9 : 0x48535a,
          transparent: true,
          opacity: 0.8,
        }),
      );
      parent.add(edges);
    });
  }
  for (const e of project.entities) {
    if (TYPES[e.classname].brush) continue;
    const group = new THREE.Group();
    group.userData.id = e.id;
    group.position.fromArray(e.position);
    group.rotation.z = (Number(e.properties.angle || 0) * Math.PI) / 180;
    const native = engineScene.entities.find((a) => a.id === e.id);
    const geometry =
        e.classname === "light"
          ? new THREE.OctahedronGeometry(12)
          : new THREE.BoxGeometry(
              ...(native
                ? native.maxs.map((v, i) => Math.max(1, v - native.mins[i]))
                : [24, 24, e.classname.startsWith("info_") ? 48 : 32]),
            ),
      mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: TYPES[e.classname].color,
          transparent: true,
          opacity: 0.8,
        }),
      );
    mesh.userData.id = e.id;
    if (native) {
      const center = native.maxs.map(
        (v, i) => (v + native.mins[i]) / 2 + native.origin[i] - e.position[i],
      );
      geometry.translate(...center);
    }
    group.add(mesh);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: e.id === selectedId ? 0xffffff : TYPES[e.classname].color,
      }),
    );
    group.add(edges);
    if (e.classname.startsWith("info_")) {
      const arrow = new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(),
        50,
        0x67d7ae,
        12,
        8,
      );
      group.add(arrow);
    }
    world.add(group);
    objectGroups.set(e.id, group);
  }
  for (const e of project.entities) {
    if (!e.targetId) continue;
    const target = project.entities.find((t) => t.id === e.targetId);
    if (target) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...e.position),
        new THREE.Vector3(...target.position),
      ]);
      world.add(
        new THREE.Line(
          geometry,
          new THREE.LineDashedMaterial({
            color: 0xbca3ff,
            dashSize: 8,
            gapSize: 8,
          }),
        ),
      );
      world.children.at(-1).computeLineDistances();
    }
  }
  if (build?.leak?.length) {
    const geometry = new THREE.BufferGeometry().setFromPoints(
      build.leak.map((p) => new THREE.Vector3(...p)),
    );
    world.add(
      new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: 0xff6655 }),
      ),
    );
  }
  refreshSelection();
}
function refreshSelection() {
  if (selectedId && !selectedIds.has(selectedId)) {
    selectedIds = new Set([selectedId]);
    selectedGroup = null;
  }
  if (!selectedId) selectedIds.clear();
  for (const child of [...selectionPivot.children]) world.attach(child);
  selectionPivot.clear();
  world.remove(selectionPivot);
  let group = objectGroups.get(selectedId);
  const pointOnly =
    selectedIds.size > 0 &&
    [...selectedIds].every((id) => {
      const entity = project.entities.find((item) => item.id === id);
      return entity && !TYPES[entity.classname].brush;
    });
  transform.showX = transform.showY = !(
    pointOnly && transform.mode === "rotate"
  );
  transform.showZ = true;
  if (selectedIds.size > 1) {
    const groups = [...selectedIds]
      .map((id) => objectGroups.get(id))
      .filter(Boolean);
    if (groups.length) {
      selectionPivot.position.copy(
        $("pivot-mode").value === "active"
          ? objectGroups.get(selectedId).position
          : groups
              .reduce((sum, g) => sum.add(g.position), new THREE.Vector3())
              .multiplyScalar(1 / groups.length),
      );
      selectionPivot.rotation.set(0, 0, 0);
      selectionPivot.scale.set(1, 1, 1);
      world.add(selectionPivot);
      groups.forEach((g) => selectionPivot.attach(g));
      group = selectionPivot;
    }
  }
  if (group) {
    if (
      (pointOnly && selectedIds.size === 1 && transform.mode === "scale") ||
      [...selectedIds].some((id) => metadata(project).locked.includes(id))
    )
      transform.detach();
    else transform.attach(group);
    $("selection-status").textContent =
      selectedIds.size > 1
        ? `${selectedIds.size} objects selected`
        : `${label(selection().object)}${selectedFace !== null ? ` · Face ${selectedFace + 1}` : ""}`;
  } else {
    transform.detach();
    $("selection-status").textContent = "Nothing selected";
  }
}
function renderList() {
  const list = $("scene-list");
  list.replaceChildren();
  const objects = sceneObjects(project),
    data = metadata(project),
    search = $("hierarchy-search").value.toLowerCase();
  $("object-count").textContent = objects.length;
  function row(obj, parent = list) {
    if (
      search &&
      !`${label(obj)} ${obj.classname || obj.shape}`
        .toLowerCase()
        .includes(search)
    )
      return;
    const button = document.createElement("button"),
      dot = document.createElement("span"),
      name = document.createElement("span");
    dot.className = "dot";
    dot.style.background = obj.classname
      ? TYPES[obj.classname].color
      : "#94a4ae";
    name.textContent = label(obj);
    button.append(dot, name);
    button.dataset.objectId = obj.id;
    button.draggable = true;
    button.classList.toggle("active", selectedIds.has(obj.id));
    button.classList.toggle("locked", data.locked.includes(obj.id));
    button.classList.toggle("dim", data.hidden.includes(obj.id));
    button.onclick = (event) =>
      select(obj.id, null, event.shiftKey || event.ctrlKey || event.metaKey);
    button.ondblclick = () => {
      $("object-name")?.focus();
    };
    button.ondragstart = (e) =>
      e.dataTransfer.setData("application/x-editor-object", obj.id);
    button.oncontextmenu = (e) => {
      e.preventDefault();
      select(obj.id);
      showContextMenu(e, obj);
    };
    parent.append(button);
  }
  const grouped = new Set(data.groups.flatMap((g) => g.ids));
  for (const group of data.groups) {
    const details = document.createElement("details"),
      heading = document.createElement("summary");
    details.open = !collapsedGroups.has(group.id);
    details.ontoggle = () => {
      if (details.open) collapsedGroups.delete(group.id);
      else collapsedGroups.add(group.id);
    };
    heading.textContent = group.name;
    heading.onclick = (e) => {
      if (e.offsetX < 18) return;
      e.preventDefault();
      selectMany(group.ids, group.id);
    };
    heading.oncontextmenu = (e) => {
      e.preventDefault();
      selectMany(group.ids, group.id);
      showContextMenu(e, { id: group.id });
    };
    details.append(heading);
    for (const id of group.ids) {
      const obj = objects.find((o) => o.id === id);
      if (obj) row(obj, details);
    }
    details.ondragover = (e) => {
      if (e.dataTransfer.types.includes("application/x-editor-object"))
        e.preventDefault();
    };
    details.ondrop = (e) => {
      const id = e.dataTransfer.getData("application/x-editor-object");
      if (!id) return;
      e.preventDefault();
      change(() => {
        for (const g of data.groups) g.ids = g.ids.filter((v) => v !== id);
        group.ids.push(id);
      });
    };
    list.append(details);
  }
  for (const obj of objects) if (!grouped.has(obj.id)) row(obj);
}
function showContextMenu(event, obj) {
  document.querySelector(".context-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.style.left = `${Math.min(event.clientX, innerWidth - 150)}px`;
  menu.style.top = `${Math.min(event.clientY, innerHeight - 180)}px`;
  for (const [name, action] of [
    ["Rename", () => $("object-name")?.focus()],
    ["Duplicate", duplicate],
    ["Group", () => $("group-selection").click()],
    ["Lock / unlock", () => $("lock-selection").click()],
    ["Delete", remove],
  ]) {
    const b = document.createElement("button");
    b.textContent = name;
    b.onclick = () => {
      action();
      menu.remove();
    };
    menu.append(b);
  }
  document.body.append(menu);
  setTimeout(
    () =>
      document.addEventListener(
        "pointerdown",
        (e) => {
          if (!menu.contains(e.target)) menu.remove();
        },
        { once: true },
      ),
    0,
  );
}
function numericFields(root, title, values, edit) {
  const label = document.createElement("div");
  label.className = "section-heading";
  label.textContent = title;
  root.append(label);
  const row = document.createElement("div");
  row.className = "xyz";
  values.forEach((value, i) => {
    const l = document.createElement("label");
    l.textContent = ["X", "Y", "Z"][i];
    const input = document.createElement("input");
    input.type = "number";
    input.disabled = !$("reset-preview").hidden;
    input.step = title === "ROTATION" ? "15" : String(grid);
    input.value = Number(value.toFixed(3));
    input.onchange = () => {
      const n = Number(input.value);
      if (Number.isFinite(n) && Math.abs(n) <= 16384) change(() => edit(i, n));
      else error(new Error("Enter a valid coordinate"));
    };
    l.append(input);
    row.append(l);
  });
  root.append(row);
}
function property(root, key, value, edit, choices) {
  const row = document.createElement("label");
  row.className = "property";
  const name = document.createElement("span");
  name.textContent = key;
  const input = document.createElement(choices ? "select" : "input");
  if (choices)
    for (const [v, label] of choices) {
      const option = document.createElement("option");
      option.value = v;
      option.textContent = label;
      input.append(option);
    }
  input.value = value;
  input.disabled = !$("reset-preview").hidden;
  if (!choices && Number.isFinite(Number(value))) {
    input.type = "number";
    input.step = "any";
  }
  input.onchange = () => change(() => edit(input.value));
  row.append(name, input);
  root.append(row);
}
function renderInspector() {
  const root = $("inspector");
  root.replaceChildren();
  const { brush, entity, object } = selection();
  if (!object) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Select a brush or object to edit it.";
    root.append(p);
    return;
  }
  const heading = document.createElement("div");
  heading.className = "inspector-name";
  heading.textContent = label(object);
  root.append(heading);
  if (selectedIds.size > 1) {
    const info = document.createElement("p");
    info.className = "muted";
    info.textContent = `${selectedIds.size} selected · Position edits translate the selection`;
    root.append(info);
  }
  const name = document.createElement("input");
  name.id = "object-name";
  name.maxLength = 80;
  name.value = selectedGroup
    ? metadata(project).groups.find((g) => g.id === selectedGroup)?.name ||
      "Group"
    : label(object);
  name.setAttribute("aria-label", "Object name");
  name.disabled = !$("reset-preview").hidden;
  name.onchange = () =>
    change(() => {
      const value = name.value.replace(/["\\\x00-\x1f]/g, "").slice(0, 80);
      if (selectedGroup)
        metadata(project).groups.find((g) => g.id === selectedGroup).name =
          value;
      else metadata(project).names[object.id] = value;
    });
  root.append(name);
  numericFields(
    root,
    "POSITION",
    brush?.position || entity.position,
    (i, n) => {
      if (selectedIds.size > 1 || (entity && TYPES[entity.classname].brush)) {
        const delta = [0, 0, 0];
        delta[i] = n - (brush?.position || entity.position)[i];
        translateObjects(project, selectedIds, delta);
        return;
      }
      if (brush) {
        brush.position[i] = n;
        if (entity) entity.position[i] = n;
      } else entity.position[i] = n;
    },
  );
  if (brush) {
    numericFields(
      root,
      "SIZE",
      brush.size,
      (i, n) => (brush.size[i] = Math.max(1, n)),
    );
    numericFields(
      root,
      "ROTATION",
      brush.rotation,
      (i, n) => (brush.rotation[i] = n),
    );
    const faces =
      selectedFace === null ? brush.faces : [brush.faces[selectedFace]];
    const f = faces[0];
    for (const [key, value, apply] of [
      ["U offset", f.shift[0], (f, n) => (f.shift[0] = n)],
      ["V offset", f.shift[1], (f, n) => (f.shift[1] = n)],
      ["U scale", f.scale[0], (f, n) => (f.scale[0] = Math.max(0.01, n))],
      ["V scale", f.scale[1], (f, n) => (f.scale[1] = Math.max(0.01, n))],
      ["UV rotation", f.rotation, (f, n) => (f.rotation = n)],
    ])
      property(root, key, String(value), (value) => {
        const n = Number(value);
        if (Number.isFinite(n)) faces.forEach((f) => apply(f, n));
      });
  }
  if (entity) {
    const native = engineScene.entities.find((a) => a.id === entity.id);
    const asset = document.createElement("p");
    asset.className = "asset-reference";
    asset.textContent = native
      ? `${native.model} · Skin ${native.skin} · Frame ${native.frame}`
      : TYPES[entity.classname].brush ||
          entity.classname === "light" ||
          entity.classname.startsWith("info_")
        ? "Editor marker / brush geometry"
        : "Build Scene to resolve the game asset";
    root.append(asset);
    if (native) {
      const capture = document.createElement("button");
      capture.textContent = "Preview game asset";
      capture.onclick = async () => {
        try {
          capture.disabled = true;
          const png = await projectBrowser.capture(native),
            image = document.createElement("img");
          image.className = "model-preview";
          image.src = png;
          image.alt = native.model;
          root.querySelector(".model-preview")?.remove();
          root.append(image);
          engineScene.select(selectedId, showOverlays);
        } catch (e) {
          error(e);
        } finally {
          capture.disabled = false;
        }
      };
      root.append(capture);
    }
    if (
      ["func_door", "func_button", "trigger_once", "trigger_multiple"].includes(
        entity.classname,
      )
    ) {
      const activate = document.createElement("button");
      activate.textContent = "Activate in preview";
      activate.onclick = async () => {
        try {
          await readyBuild();
          if (!engineScene.activate(entity.id))
            throw new Error("This object has no game activation function");
          previewControls(true);
        } catch (e) {
          error(e);
        }
      };
      root.append(activate);
    }
    const flags = document.createElement("details"),
      flagTitle = document.createElement("summary");
    flagTitle.textContent = "Spawn flags";
    flags.append(flagTitle);
    const definitions = [
      [256, "Exclude Easy"],
      [512, "Exclude Normal"],
      [1024, "Exclude Hard / Nightmare"],
      [2048, "Exclude deathmatch"],
    ];
    if (entity.classname === "item_health")
      definitions.unshift([1, "Rotten health"], [2, "Megahealth"]);
    else if (
      entity.classname.startsWith("item_") &&
      entity.classname !== "item_armor1"
    )
      definitions.unshift([1, "Large pickup"]);
    else if (entity.classname === "func_door")
      definitions.unshift(
        [1, "Starts open"],
        [8, "Requires silver key"],
        [16, "Requires gold key"],
        [32, "Toggle"],
      );
    for (const [bit, label] of definitions) {
      const row = document.createElement("label"),
        checkbox = document.createElement("input");
      row.className = "flag-field";
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(
        Number(entity.properties.spawnflags || 0) & bit,
      );
      checkbox.disabled = !$("reset-preview").hidden;
      checkbox.onchange = () =>
        change(() => {
          for (const e of project.entities)
            if (selectedIds.has(e.id))
              e.properties.spawnflags = String(
                checkbox.checked
                  ? Number(e.properties.spawnflags || 0) | bit
                  : Number(e.properties.spawnflags || 0) & ~bit,
              );
        });
      row.append(checkbox, document.createTextNode(label));
      flags.append(row);
    }
    root.append(flags);
    for (const [key, value] of Object.entries(entity.properties))
      property(
        root,
        key,
        value,
        (v) => {
          for (const e of project.entities)
            if (selectedIds.has(e.id) && Object.hasOwn(e.properties, key))
              e.properties[key] = v;
          entity.properties[key] = v;
        },
        key === "map" ? (config?.maps || ["e1m1"]).map((m) => [m, m]) : null,
      );
    if (
      !TYPES[entity.classname].brush &&
      !["light"].includes(entity.classname) &&
      !("angle" in entity.properties)
    )
      property(root, "angle", "0", (v) => (entity.properties.angle = v));
    if (
      ["func_button", "trigger_once", "trigger_multiple"].includes(
        entity.classname,
      )
    )
      property(
        root,
        "Activate",
        entity.targetId || "",
        (v) => (entity.targetId = v || null),
        [
          ["", "No target"],
          ...project.entities
            .filter(
              (e) =>
                e.id !== entity.id &&
                TYPES[e.classname].brush &&
                !e.classname.startsWith("trigger_"),
            )
            .map((e) => [e.id, `${label(e)} · ${e.id.slice(0, 5)}`]),
        ],
      );
    if (entity.classname === "func_button" && !("health" in entity.properties))
      property(
        root,
        "Shoot health",
        "0",
        (v) => (entity.properties.health = v),
      );
  }
}
function refresh() {
  const valid = new Set(sceneObjects(project).map((o) => o.id));
  selectedIds = new Set([...selectedIds].filter((id) => valid.has(id)));
  if (selectedId && !valid.has(selectedId))
    selectedId = [...selectedIds][0] || null;
  if (!selectedId) selectedIds.clear();
  else if (!selectedIds.has(selectedId)) selectedIds = new Set([selectedId]);
  if (
    selectedGroup &&
    !metadata(project).groups.some(
      (g) =>
        g.id === selectedGroup &&
        [...selectedIds].every((id) => g.ids.includes(id)),
    )
  )
    selectedGroup = null;
  $("title").value = project.title;
  rebuildScene();
  renderList();
  renderInspector();
  $("undo").disabled = !history.length;
  $("redo").disabled = !future.length;
  $("build-state").textContent = build
    ? `${build.status.toUpperCase()}${compiledSource === sourceSignature(project) ? " · GEOMETRY CURRENT" : build.revision !== project.revision ? " · CHANGES NOT BUILT" : ""}`
    : "No build yet";
  $("solo").disabled = building;
  $("coop").disabled = building;
}
async function renderTextures() {
  const search = $("texture-search").value.toLowerCase(),
    list = $("texture-list");
  list.replaceChildren();
  const entries = [
    ...project.textures,
    ...textureCatalogue.filter(
      (t) => !project.textures.some((c) => c.name === t.name),
    ),
  ];
  $("texture-count").textContent = entries.length;
  for (const entry of entries
    .filter((t) => t.name.toLowerCase().includes(search))
    .slice(0, textureLimit)) {
    const button = document.createElement("button"),
      image = document.createElement("img"),
      span = document.createElement("span");
    span.textContent = entry.name;
    button.title = `${entry.name} · ${entry.width} × ${entry.height}`;
    button.classList.toggle("chosen", entry.name === currentTexture);
    button.append(image, span);
    button.onclick = () => paint(entry.name);
    button.draggable = true;
    button.ondragstart = (e) =>
      e.dataTransfer.setData("application/x-quake-texture", entry.name);
    list.append(button);
    fetchTexture(entry.name)
      .then((t) => {
        image.src = rgbaCanvas(t).toDataURL();
      })
      .catch(() => {});
  }
  if (
    entries.filter((t) => t.name.toLowerCase().includes(search)).length >
    textureLimit
  ) {
    const more = document.createElement("button");
    more.textContent = "More textures";
    more.style.gridColumn = "1 / -1";
    more.onclick = () => {
      textureLimit += 150;
      renderTextures();
    };
    list.append(more);
  }
}
function paint(name) {
  currentTexture = name;
  const { brush } = selection();
  if (brush)
    change(() => {
      for (const [index, f] of brush.faces.entries())
        if (selectedFace === null || selectedFace === index) f.texture = name;
    });
  renderTextures();
  $("texture-note").textContent =
    `${name} · ${selectedFace === null ? "All faces" : "Selected face"}`;
}
function resetTextureCache() {
  for (const m of materialCache.values()) m.dispose();
  materialCache.clear();
  textures.clear();
}
function newLevel(example = false) {
  if (!$("reset-preview").hidden) {
    toast("Stop / Reset preview to edit the level");
    return;
  }
  if (
    !confirm("Start a new project? Export your current project to keep a copy.")
  )
    return;
  project = example ? exampleProject() : starterProject();
  selectedId = null;
  history = [];
  future = [];
  build = null;
  resetTextureCache();
  changed();
  renderTextures();
}
function exampleProject() {
  const p = starterProject();
  p.title = "Switchyard · example";
  p.brushes = roomBrushes([0, 0, 128], [2048, 1024, 256]);
  p.brushes.push(
    ...cutOpening(newBrush("box", [0, 0, 128], [16, 1024, 256]), 128, 128),
  );
  const door = newEntity("func_door", [0, 0, 64]);
  door.properties.angle = "90";
  const button = newEntity("func_button", [-16, -128, 64]);
  button.targetId = door.id;
  const exit = newEntity("trigger_changelevel", [768, 256, 48]);
  exit.properties.map = config?.maps.includes("e1m1")
    ? "e1m1"
    : config?.maps[0] || "e1m1";
  p.entities.push(
    door,
    button,
    exit,
    newEntity("monster_army", [384, 128, 32]),
    newEntity("weapon_supershotgun", [-224, -128, 32]),
    newEntity("item_health", [640, 64, 32]),
    newEntity("light", [512, 0, 192]),
    newEntity("light", [-512, 0, 192]),
  );
  p.entities
    .filter((e) => e.classname === "light")
    .forEach((e) => (e.properties.light = "600"));
  p.brushes.push(
    newBrush("box", door.position, [16, 128, 128], "ed_demo", door.id),
    newBrush("box", button.position, [16, 24, 24], "ed_demo", button.id),
    newBrush("box", exit.position, [96, 96, 96], "ed_grid", exit.id),
    newBrush("wedge", [-512, 256, 64], [256, 128, 128]),
  );
  p.textures = [
    {
      name: "ed_demo",
      width: 64,
      height: 64,
      pixels: b64(
        Uint8Array.from({ length: 4096 }, (_, i) =>
          (((i % 64) >> 3) + (Math.floor(i / 64) >> 3)) % 2 ? 112 : 40,
        ),
      ),
    },
  ];
  return p;
}
function addObject(classname) {
  const e = newEntity(classname, [
    cursor[0],
    cursor[1],
    classname === "light" ? 192 : 32,
  ]);
  change(() => {
    project.entities.push(e);
    if (TYPES[classname].brush) {
      e.position[2] = 64;
      project.brushes.push(
        newBrush(
          "box",
          e.position,
          classname === "func_button" ? [16, 32, 32] : [128, 32, 128],
          currentTexture,
          e.id,
        ),
      );
    }
    selectedId = e.id;
  });
}
function duplicate() {
  if (!selectedId) return;
  change(() => {
    selectedIds = new Set(
      duplicateObjects(project, selectedIds.size ? selectedIds : [selectedId], [
        grid * 2,
        0,
        0,
      ]),
    );
    selectedId = [...selectedIds][0];
    selectedGroup = null;
  });
}
function remove() {
  if (!selectedId) return;
  change(() => {
    removeObjects(project, selectedIds.size ? selectedIds : [selectedId]);
    selectedIds.clear();
    selectedId = null;
  });
}
async function compile() {
  if (building) throw new Error("A build is already running");
  validateProject(project);
  building = true;
  const compilationProject = clone(project),
    source = sourceSignature(compilationProject);
  $("build").disabled = true;
  $("cancel-build").hidden = false;
  refresh();
  try {
    build = await api("/api/editor/builds", {
      method: "POST",
      body: JSON.stringify({ project: compilationProject }),
    });
    while (build.status === "building") {
      await new Promise((r) => setTimeout(r, 350));
      build = await api(`/api/editor/builds/${build.id}`);
      renderBuildLog();
      $("build-state").textContent = `BUILDING · ${build.stage}`;
    }
    renderBuildLog();
    if (build.status !== "ready") {
      workspace.console();
      throw new Error(build.error || "Build failed");
    }
    toast("Level compiled successfully");
    if (source === sourceSignature(project) && config?.canPlay) {
      if (sceneProject !== project.id) {
        const spawn = project.entities.find(
          (e) => e.classname === "info_player_start",
        );
        if (spawn) {
          cameras[0].position.set(
            spawn.position[0],
            spawn.position[1],
            spawn.position[2] + 48,
          );
          controls[0].target.set(
            spawn.position[0] + 256,
            spawn.position[1] + 128,
            spawn.position[2] + 32,
          );
          controls[0].update();
        }
        sceneProject = project.id;
      }
      compiledSource = source;
      config = await api("/api/editor/config");
      await engineScene.load(
        build,
        { ...config, skill: Number($("difficulty").value) },
        compilationProject,
      );
      sceneSource = source;
      for (const id of metadata(project).hidden) engineScene.hide(id, true);
      engineScene.select(selectedId, showOverlays);
      previewControls(false);
      renderAssets();
    }
    return build;
  } finally {
    building = false;
    $("build").disabled = false;
    $("cancel-build").hidden = true;
    refresh();
    if (build?.revision !== project.revision) queueSceneBuild();
  }
}
function queueSceneBuild() {
  clearTimeout(sceneBuildTimer);
  if (sceneSource === sourceSignature(project)) {
    if (engineScene.current && $("reset-preview").hidden)
      $("scene-revision").textContent =
        `Compiled revision ${engineScene.current.revision} · Geometry current`;
    return;
  }
  if (engineScene.current && engineScene.current.revision !== project.revision)
    $("scene-revision").textContent =
      `Revision ${engineScene.current.revision} · Pending changes`;
  if (
    !$("auto-scene").checked ||
    !config?.canPlay ||
    !config.compiler ||
    building
  )
    return;
  sceneBuildTimer = setTimeout(
    () =>
      compile().catch((e) => {
        $("scene-revision").textContent = "Build failed · See Console";
        renderBuildLog(e.message);
      }),
    900,
  );
}
function sourceSignature(p) {
  return JSON.stringify({
    title: p.title,
    brushes: p.brushes.map(({ name, ...b }) => b),
    entities: p.entities,
    textures: p.textures,
    game: p.gameFingerprint,
  });
}
function renderBuildLog(extra = "") {
  const search = $("console-search").value.toLowerCase(),
    warnings = $("console-severity").value === "warnings",
    lines = [
      ...(build?.logs || []),
      ...(build?.error ? [build.error] : []),
      ...(extra ? [extra] : []),
    ];
  $("build-log").textContent = lines
    .filter(
      (line) =>
        line.toLowerCase().includes(search) &&
        (!warnings || /warn|error|fail|leak/i.test(line)),
    )
    .join("\n");
  $("build-log").scrollTop = $("build-log").scrollHeight;
  $("frame-leak").hidden = !build?.leak?.length;
}
$("console-search").oninput = () => renderBuildLog();
$("console-severity").onchange = () => renderBuildLog();
$("frame-leak").onclick = () => {
  if (!build?.leak?.length) return;
  switchTab("scene");
  const bounds = new THREE.Box3().setFromPoints(
      build.leak.map((point) => new THREE.Vector3(...point)),
    ),
    center = bounds.getCenter(new THREE.Vector3()),
    radius = Math.max(128, bounds.getSize(new THREE.Vector3()).length());
  cameras[0].position
    .copy(center)
    .add(new THREE.Vector3(radius, -radius, radius * 0.6));
  controls[0].target.copy(center);
  controls[0].update();
};
function renderAssets() {
  return projectBrowser?.render().catch(error);
}
async function readyBuild() {
  return build?.status === "ready" &&
    compiledSource === sourceSignature(project)
    ? build
    : await compile();
}
function openPlay(url) {
  $("play-frame").src = url;
  $("play-dialog").show();
  switchTab("game");
}
$("build").onclick = () => compile().catch(error);
$("refresh-scene").onclick = () => compile().catch(error);
$("auto-scene").onchange = queueSceneBuild;
$("difficulty").onchange = async () => {
  if (
    build?.status === "ready" &&
    compiledSource === sourceSignature(project)
  ) {
    try {
      await engineScene.load(
        build,
        { ...config, skill: Number($("difficulty").value) },
        project,
      );
      previewControls(false);
      for (const id of metadata(project).hidden) engineScene.hide(id, true);
      engineScene.select(selectedId, showOverlays);
      refresh();
    } catch (e) {
      error(e);
    }
  }
};
$("scene-tab").onclick = () => switchTab("scene");
$("game-tab").onclick = () => switchTab("game");
$("four-view").onclick = () => {
  fourViews = !fourViews;
  host.classList.toggle("single-view", !fourViews);
  $("four-view").classList.toggle("active", fourViews);
  $("cutaway").disabled = !fourViews;
  activeView = 0;
  transform.camera = cameras[0];
  transform.connect(views[0]);
  resize();
};
$("overlays").onclick = () => {
  showOverlays = !showOverlays;
  $("overlays").classList.toggle("active", showOverlays);
  engineScene.select(selectedId, showOverlays);
};
function previewControls(active) {
  $("pause-preview").hidden = !active;
  $("reset-preview").hidden = !active;
  $("simulate").disabled = active;
  $("pause-preview").textContent = "Pause";
  transform.enabled = !active && showOverlays;
  for (const id of [
    "new",
    "example",
    "open",
    "image-import",
    "undo",
    "redo",
    "title",
  ])
    $(id).disabled = active;
  if (!active) {
    $("undo").disabled = !history.length;
    $("redo").disabled = !future.length;
  }
  if (active)
    $("scene-revision").textContent =
      "Simulating · Authoring document unchanged";
  renderInspector();
}
$("simulate").onclick = async () => {
  try {
    await readyBuild();
    engineScene.simulate(true);
    previewControls(true);
  } catch (e) {
    error(e);
  }
};
$("pause-preview").onclick = () => {
  const running = engineScene.snapshot()?.simulating;
  engineScene.simulate(!running);
  $("pause-preview").textContent = running ? "Resume" : "Pause";
};
$("reset-preview").onclick = async () => {
  try {
    await engineScene.reset();
    previewControls(false);
    for (const id of metadata(project).hidden) engineScene.hide(id, true);
    for (const e of project.entities)
      if (!TYPES[e.classname].brush) engineScene.preview(e);
    $("scene-revision").textContent =
      `Compiled revision ${engineScene.current.revision}`;
    refresh();
  } catch (e) {
    error(e);
  }
};
$("hierarchy-search").oninput = renderList;
$("group-selection").onclick = () => {
  if (!selectedIds.size) return;
  change(() => {
    const group = groupSelection(
      project,
      selectedIds,
      `Group ${metadata(project).groups.length + 1}`,
    );
    selectedGroup = group?.id;
  });
};
$("ungroup-selection").onclick = () =>
  change(() => {
    const data = metadata(project);
    data.groups = data.groups
      .map((g) => ({ ...g, ids: g.ids.filter((id) => !selectedIds.has(id)) }))
      .filter((g) => g.ids.length);
    selectedGroup = null;
  });
$("hide-selection").onclick = () =>
  change(() => {
    const data = metadata(project),
      hide = ![...selectedIds].every((id) => data.hidden.includes(id));
    for (const id of selectedIds) {
      data.hidden = data.hidden.filter((v) => v !== id);
      if (hide) data.hidden.push(id);
      engineScene.hide(id, hide);
    }
  });
$("lock-selection").onclick = () =>
  change(() => {
    const data = metadata(project),
      lock = ![...selectedIds].every((id) => data.locked.includes(id));
    for (const id of selectedIds) {
      data.locked = data.locked.filter((v) => v !== id);
      if (lock) data.locked.push(id);
    }
  });
$("transform-space").onchange = () =>
  transform.setSpace($("transform-space").value);
$("pivot-mode").onchange = refreshSelection;
for (const button of document.querySelectorAll("[data-axis]"))
  button.onclick = () => {
    const index = "xyz".indexOf(button.dataset.axis),
      target = controls[0].target.clone(),
      distance = cameras[0].position.distanceTo(target) || 512,
      position = target.clone();
    position.setComponent(index, position.getComponent(index) + distance);
    if (index === 2) position.y -= 0.01;
    cameras[0].position.copy(position);
    controls[0].update();
  };
$("perspective-view").onclick = () => {
  const target = controls[0].target.clone();
  cameras[0].position.copy(target).add(new THREE.Vector3(256, -384, 192));
  controls[0].update();
};
$("solo").onclick = async () => {
  try {
    if (!config?.canPlay)
      throw new Error(
        "Install Quake pak0.pak in runtime/id1, then reload the editor",
      );
    const b = await readyBuild();
    openPlay(`play.html?build=${b.id}&skill=${$("difficulty").value}`);
  } catch (e) {
    error(e);
  }
};
$("coop").onclick = async () => {
  try {
    if (
      session?.status === "ready" &&
      !confirm("Restart the co-op test? Current test players will disconnect.")
    )
      return;
    const b = await readyBuild();
    $("coop").disabled = true;
    session = await api("/api/editor/sessions", {
      method: "POST",
      body: JSON.stringify({
        buildId: b.id,
        skill: Number($("difficulty").value),
      }),
    });
    $("join-link").hidden = false;
    $("join-url").href = session.joinUrl;
    $("join-url").textContent = session.joinUrl;
    $("stop-session").hidden = false;
    openPlay(`play.html?session=${session.id}`);
  } catch (e) {
    error(e);
  } finally {
    $("coop").disabled = false;
  }
};
$("stop-session").onclick = async () => {
  try {
    await api(`/api/editor/sessions/${session.id}`, { method: "DELETE" });
    session = null;
    $("join-link").hidden = true;
    $("stop-session").hidden = true;
  } catch (e) {
    error(e);
  }
};
$("cancel-build").onclick = () => {
  if (build)
    api(`/api/editor/builds/${build.id}`, { method: "DELETE" }).catch(error);
};
$("copy-link").onclick = () =>
  navigator.clipboard
    .writeText(session.joinUrl)
    .then(() => toast("Join link copied"), error);
$("close-play").onclick = () => {
  $("play-dialog").close();
  $("play-frame").src = "about:blank";
  switchTab("scene");
};
$("play-dialog").addEventListener("close", () => {
  $("play-frame").src = "about:blank";
});
$("title").onchange = () => {
  const title = $("title")
    .value.replace(/["\\\x00-\x1f]/g, "")
    .slice(0, 80);
  change(() => (project.title = title || "Untitled level"));
};
$("new").onclick = () => newLevel();
$("example").onclick = () => newLevel(true);
$("save").onclick = () =>
  download(
    `${project.title.replace(/[^a-zA-Z0-9_-]/g, "_")}.qlevel.json`,
    JSON.stringify(project, null, 2),
    "application/json",
  );
$("open").onchange = async () => {
  try {
    const file = $("open").files[0];
    if (file.size > 16 * 1024 * 1024) throw new Error("Project exceeds 16 MiB");
    const loaded = JSON.parse(await file.text());
    validateProject(loaded, { requireSpawn: false });
    if (
      !confirm("Open this project? Export your current project to keep a copy.")
    )
      return;
    project = loaded;
    selectedId = null;
    history = [];
    future = [];
    build = null;
    resetTextureCache();
    changed();
    renderTextures();
  } catch (e) {
    error(e);
  } finally {
    $("open").value = "";
  }
};
$("source").onclick = async () => {
  try {
    let b = build;
    if (
      !b ||
      b.revision !== project.revision ||
      !b.files.some((f) => f.name === "source.zip")
    ) {
      try {
        b = await compile();
      } catch (e) {
        b = build;
        if (!b?.files.some((f) => f.name === "source.zip")) throw e;
        toast("Source exported; the map still needs the build errors fixed");
      }
    }
    const response = await fetch(`/api/editor/builds/${b.id}/files/source.zip`);
    if (!response.ok) throw new Error("Build no longer available");
    download(`${b.map}-source.zip`, await response.arrayBuffer());
  } catch (e) {
    error(e);
  }
};
$("export-bsp").onclick = async () => {
  try {
    const b = await readyBuild(),
      files = {};
    for (const f of b.files.filter((f) => /\.(bsp|lit)$/.test(f.name))) {
      const response = await fetch(
        `/api/editor/builds/${b.id}/files/${f.name}`,
      );
      if (!response.ok) throw new Error("Build no longer available");
      files[`maps/${f.name}`] = new Uint8Array(await response.arrayBuffer());
    }
    files["README.txt"] = strToU8(
      `Level: ${project.title}\nInstall maps into a compatible Quake game directory. Run: map ${b.map}\nTextures retain their original licenses.\n`,
    );
    download(`${b.map}.zip`, zipSync(files));
  } catch (e) {
    error(e);
  }
};
$("undo").onclick = () => {
  if (!history.length || !$("reset-preview").hidden) return;
  future.push(clone(project));
  const revision = project.revision + 1;
  project = history.pop();
  project.revision = revision;
  selectedId = null;
  resetTextureCache();
  changed();
  renderTextures();
};
$("redo").onclick = () => {
  if (!future.length || !$("reset-preview").hidden) return;
  history.push(clone(project));
  const revision = project.revision + 1;
  project = future.pop();
  project.revision = revision;
  selectedId = null;
  resetTextureCache();
  changed();
  renderTextures();
};
$("duplicate").onclick = duplicate;
$("delete").onclick = remove;
$("focus").onclick = () => {
  const bounds = new THREE.Box3();
  for (const brush of project.brushes)
    if (selectedIds.has(brush.id) || selectedIds.has(brush.entityId))
      for (const face of brushFaces(brush))
        for (const point of face.vertices)
          bounds.expandByPoint(new THREE.Vector3(...point));
  for (const entity of project.entities) {
    if (!selectedIds.has(entity.id) || TYPES[entity.classname].brush) continue;
    const native = engineScene.entities.find((item) => item.id === entity.id);
    for (const corner of native
      ? [native.mins, native.maxs]
      : [
          [-24, -24, -24],
          [24, 24, 24],
        ])
      bounds.expandByPoint(
        new THREE.Vector3(...(native?.origin || entity.position)).add(
          new THREE.Vector3(...corner),
        ),
      );
  }
  const center = bounds.isEmpty()
      ? new THREE.Vector3(0, 0, 64)
      : bounds.getCenter(new THREE.Vector3()),
    distance = bounds.isEmpty()
      ? 128
      : Math.max(70, bounds.getSize(new THREE.Vector3()).length());
  controls.forEach((c, i) => {
    c.target.copy(center);
    if (i === 0) {
      c.object.position
        .copy(c.target)
        .add(new THREE.Vector3(distance, -distance, distance * 0.6));
    } else
      c.object.position.copy(c.target).add(
        new THREE.Vector3(
          ...[
            [0, 0, 8000],
            [0, -8000, 0],
            [8000, 0, 0],
          ][i - 1],
        ),
      );
    c.update();
  });
};
$("opening").onclick = () => {
  try {
    const { brush } = selection();
    if (!brush) throw new Error("Select a wall first");
    const pieces = cutOpening(brush);
    change(() => {
      const data = metadata(project);
      for (const group of data.groups)
        if (group.ids.includes(brush.id))
          group.ids = group.ids.flatMap((id) =>
            id === brush.id ? pieces.map((p) => p.id) : [id],
          );
      delete data.names[brush.id];
      data.hidden = data.hidden.filter((id) => id !== brush.id);
      data.locked = data.locked.filter((id) => id !== brush.id);
      project.brushes = project.brushes.filter((b) => b.id !== brush.id);
      project.brushes.push(...pieces);
      selectedId = pieces[0].id;
    });
  } catch (e) {
    error(e);
  }
};
for (const button of document.querySelectorAll("[data-create]"))
  button.onclick = () => {
    const type = button.dataset.create;
    change(() => {
      if (type === "room") {
        const brushes = roomBrushes(
          [cursor[0], cursor[1], 128],
          undefined,
          currentTexture,
        );
        project.brushes.push(...brushes);
        groupSelection(
          project,
          brushes.map((b) => b.id),
          `Room ${metadata(project).groups.length + 1}`,
        );
        selectedId = brushes[0].id;
      } else {
        const b = newBrush(
          type,
          [cursor[0], cursor[1], 64],
          type === "wedge" ? [256, 128, 128] : [128, 128, 128],
          currentTexture,
        );
        project.brushes.push(b);
        selectedId = b.id;
      }
    });
  };
for (const [name, type] of Object.entries(TYPES)) {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = type.label;
  $("object-type").append(option);
}
$("add-object").onclick = () => addObject($("object-type").value);
function setTool(tool) {
  transform.setMode(tool);
  transform.setSpace(tool === "scale" ? "local" : $("transform-space").value);
  document
    .querySelectorAll("[data-tool]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
  refreshSelection();
}
document
  .querySelectorAll("[data-tool]")
  .forEach((button) => (button.onclick = () => setTool(button.dataset.tool)));
$("grid").onchange = () => {
  grid = Number($("grid").value);
  transform.setTranslationSnap(grid);
  renderInspector();
};
$("face-mode").onclick = () => {
  faceMode = !faceMode;
  selectedFace = null;
  $("face-mode").classList.toggle("active", faceMode);
  renderInspector();
};
$("cutaway").onclick = () => {
  cutaway = !cutaway;
  $("cutaway").classList.toggle("active", cutaway);
};
$("texture-search").oninput = () => {
  textureLimit = 150;
  renderTextures();
};
$("image-import").onchange = async () => {
  try {
    const file = $("image-import").files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) throw new Error("Image exceeds 8 MiB");
    const image = await createImageBitmap(file);
    if (image.width > 8192 || image.height > 8192)
      throw new Error("Image dimensions exceed 8192 pixels");
    const ratio = Math.min(1, 512 / image.width, 512 / image.height),
      w = Math.max(1, Math.round(image.width * ratio)),
      h = Math.max(1, Math.round(image.height * ratio)),
      canvas = document.createElement("canvas");
    canvas.width = Math.ceil(w / 16) * 16;
    canvas.height = Math.ceil(h / 16) * 16;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#343a40";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, w, h);
    image.close();
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    toast("Converting image to the Quake palette…");
    const worker = new Worker(new URL("texture-worker.js", location.href), {
      type: "module",
    });
    const pixels = await new Promise((resolve, reject) => {
      worker.onmessage = (event) =>
        event.data.error
          ? reject(new Error(event.data.error))
          : resolve(event.data.pixels);
      worker.onerror = reject;
      worker.postMessage(
        {
          rgba,
          palette: config.palette,
          width: canvas.width,
          height: canvas.height,
        },
        [rgba.buffer],
      );
    }).finally(() => worker.terminate());
    const bytes = new Uint8Array(await file.arrayBuffer()),
      name = `ed_${uid().replaceAll("-", "").slice(0, 10)}`,
      t = {
        name,
        width: canvas.width,
        height: canvas.height,
        pixels: b64(pixels),
        source: b64(bytes),
        sourceType: file.type,
      };
    const preview = rgbaCanvas(t),
      dialog = document.createElement("dialog");
    dialog.innerHTML =
      '<div class="play-card"><h1>Converted texture</h1><p>Opaque, palette-converted texture. Reserved glow colors are excluded.</p><div class="preview-image"></div><button class="accent">Use texture</button><button class="cancel">Cancel</button></div>';
    dialog.style.width = "420px";
    dialog.style.height = "auto";
    preview.style.width = "256px";
    preview.style.height = "256px";
    preview.style.imageRendering = "pixelated";
    dialog.querySelector(".preview-image").append(preview);
    document.body.append(dialog);
    dialog.querySelector(".accent").onclick = () => {
      change(() => project.textures.push(t));
      paint(name);
      dialog.close();
    };
    dialog.querySelector(".cancel").onclick = () => dialog.close();
    dialog.onclose = () => dialog.remove();
    dialog.showModal();
  } catch (e) {
    error(e);
  } finally {
    $("image-import").value = "";
  }
};
document.addEventListener("keydown", (event) => {
  if (
    ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName) ||
    ($("play-dialog").open && !$("game-panel").hidden)
  )
    return;
  const key = event.key.toLowerCase();
  if (flyActive) {
    flyKeys.add(event.code);
    event.preventDefault();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === "z") {
    event.preventDefault();
    $(event.shiftKey ? "redo" : "undo").click();
  } else if ((event.ctrlKey || event.metaKey) && key === "s") {
    event.preventDefault();
    $("save").click();
  } else if ((event.ctrlKey || event.metaKey) && key === "d") {
    event.preventDefault();
    duplicate();
  } else if (event.key === "Delete") remove();
  else if (key === "f") {
    $("focus").click();
    event.preventDefault();
  } else if (event.key === "F2") {
    $("object-name")?.focus();
    event.preventDefault();
  } else if (key === "q") {
    transform.detach();
    event.preventDefault();
  } else if (["w", "e", "r"].includes(key))
    setTool({ w: "translate", e: "rotate", r: "scale" }[key]);
});
document.addEventListener("keyup", (e) => flyKeys.delete(e.code));
views[0].addEventListener(
  "pointerdown",
  (e) => {
    if (e.button !== 2 || e.shiftKey) return;
    flyActive = true;
    flyPointer = { x: e.clientX, y: e.clientY };
    controls[0].enabled = false;
    views[0].setPointerCapture(e.pointerId);
  },
  { capture: true },
);
views[0].addEventListener("pointermove", (e) => {
  if (!flyActive) return;
  const d = cameras[0].getWorldDirection(new THREE.Vector3()),
    yaw = Math.atan2(d.y, d.x) - (e.clientX - flyPointer.x) * 0.004,
    pitch = Math.max(
      -1.54,
      Math.min(1.54, Math.asin(d.z) - (e.clientY - flyPointer.y) * 0.004),
    );
  const direction = new THREE.Vector3(
    Math.cos(yaw) * Math.cos(pitch),
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
  );
  controls[0].target.copy(cameras[0].position).addScaledVector(direction, 256);
  cameras[0].lookAt(controls[0].target);
  flyPointer = { x: e.clientX, y: e.clientY };
});
views[0].addEventListener("pointerup", () => {
  flyActive = false;
  flyKeys.clear();
  controls[0].enabled = true;
});
const marquee = document.createElement("div");
marquee.id = "marquee";
marquee.hidden = true;
host.append(marquee);
let marqueeStart;
views.forEach((view, i) => {
  view.addEventListener("pointerdown", (e) => {
    if (e.shiftKey && e.button === 0 && !transform.dragging) {
      marqueeStart = { x: e.clientX, y: e.clientY, view: i };
      marquee.hidden = false;
    }
  });
  view.addEventListener("pointermove", (e) => {
    if (!marqueeStart) return;
    const rect = host.getBoundingClientRect();
    Object.assign(marquee.style, {
      left: `${Math.min(e.clientX, marqueeStart.x) - rect.left}px`,
      top: `${Math.min(e.clientY, marqueeStart.y) - rect.top}px`,
      width: `${Math.abs(e.clientX - marqueeStart.x)}px`,
      height: `${Math.abs(e.clientY - marqueeStart.y)}px`,
    });
  });
  view.addEventListener("pointerup", (e) => {
    if (!marqueeStart) return;
    const start = marqueeStart;
    marqueeStart = null;
    marquee.hidden = true;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) return;
    const rect = view.getBoundingClientRect(),
      camera = cameras[i],
      ids = [];
    for (const obj of sceneObjects(project)) {
      if (
        metadata(project).locked.includes(obj.id) ||
        metadata(project).hidden.includes(obj.id)
      )
        continue;
      const p = new THREE.Vector3(...obj.position).project(camera),
        x = rect.left + ((p.x + 1) * rect.width) / 2,
        y = rect.top + ((1 - p.y) * rect.height) / 2;
      if (
        p.z >= -1 &&
        p.z <= 1 &&
        x >= Math.min(start.x, e.clientX) &&
        x <= Math.max(start.x, e.clientX) &&
        y >= Math.min(start.y, e.clientY) &&
        y <= Math.max(start.y, e.clientY)
      )
        ids.push(obj.id);
    }
    selectMany([...new Set([...selectedIds, ...ids])]);
  });
  view.ondragover = (e) => {
    if (
      [...e.dataTransfer.types].some((type) =>
        type.startsWith("application/x-quake-"),
      )
    )
      e.preventDefault();
  };
  view.ondrop = (e) => {
    e.preventDefault();
    try {
      const rect = view.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((e.clientY - rect.top) / rect.height) * 2,
      );
      raycaster.setFromCamera(pointer, cameras[i]);
      const point = raycaster.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
        new THREE.Vector3(),
      );
      if (point) cursor = point.toArray().map((v) => snap(v, grid));
      const entity = e.dataTransfer.getData("application/x-quake-entity"),
        template = e.dataTransfer.getData("application/x-quake-template");
      if (entity) addObject(entity);
      else if (template) useTemplate(JSON.parse(template));
      else {
        const texture = e.dataTransfer.getData("application/x-quake-texture");
        if (texture) paint(texture);
      }
    } catch (errorValue) {
      error(errorValue);
    }
  };
});
function useTemplate(template) {
  try {
    const candidate = clone(project),
      ids = insertTemplate(candidate, template, [cursor[0], cursor[1], 64]);
    validateProject(candidate, { requireSpawn: false });
    change(() => {
      project = candidate;
      selectedIds = new Set(ids);
      selectedId = ids[0] || null;
    });
    renderTextures();
  } catch (e) {
    error(e);
  }
}
projectBrowser = createProjectBrowser({
  db: () => db,
  project: () => project,
  scene: () => engineScene,
  build: () => build,
  error,
  add: addObject,
  insert: useTemplate,
  load: async (saved) => {
    if (!$("reset-preview").hidden)
      throw new Error("Stop / Reset preview to edit the level");
    if (!confirm("Open this saved project? Current work is autosaved.")) return;
    const copy = clone(saved);
    validateProject(copy, { requireSpawn: false });
    project = copy;
    selectedId = null;
    selectedIds.clear();
    history.length = 0;
    future.length = 0;
    changed();
    renderTextures();
  },
  saveTemplate: async () => {
    if (!selectedIds.size) throw new Error("Select objects to save a template");
    const name = prompt(
      "Template name",
      selectedGroup
        ? metadata(project).groups.find((g) => g.id === selectedGroup)?.name
        : "New template",
    );
    if (!name) return;
    const template = templateFromSelection(
      project,
      selectedIds,
      name.replace(/["\\\x00-\x1f]/g, "").slice(0, 80),
    );
    await new Promise((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").put(template, `template:${uid()}`);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    toast("Template saved");
  },
  exportTemplate: (template) =>
    download(
      `${template.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.qtemplate.json`,
      JSON.stringify(template, null, 2),
      "application/json",
    ),
  exportBuild: () => $("export-bsp").click(),
  builtins: () => {
    const sample = exampleProject(),
      doorIds = sample.entities
        .filter((e) => ["func_door", "func_button"].includes(e.classname))
        .map((e) => e.id);
    const room = {
        version: 1,
        name: "Sealed room",
        brushes: roomBrushes(),
        entities: [],
        textures: [],
      },
      corridor = {
        ...room,
        name: "Corridor",
        brushes: roomBrushes([0, 0, 64], [512, 192, 128]),
      };
    return [
      ["Sealed room", room],
      ["Corridor", corridor],
      [
        "Door + button",
        templateFromSelection(sample, doorIds, "Door + button"),
      ],
    ];
  },
});
window.addEventListener("pagehide", () => {
  if (db) {
    const transaction = db.transaction("projects", "readwrite");
    transaction.objectStore("projects").put(project, "last");
  }
});
window.editor = {
  scene: engineScene,
  selection: () => [...selectedIds],
  selectMany,
  insertTemplate: useTemplate,
  get project() {
    return project;
  },
  get build() {
    return build;
  },
  get session() {
    return session;
  },
  get config() {
    return config;
  },
  select,
  compile,
  example: () => {
    project = exampleProject();
    selectedId = null;
    build = null;
    resetTextureCache();
    changed();
    renderTextures();
  },
  snapshot: () => ({
    project: clone(project),
    build,
    errors: window.__editorErrors,
  }),
  get renderer() {
    return renderer;
  },
};
window.__editorErrors = [];
window.addEventListener("error", (event) =>
  window.__editorErrors.push(event.message),
);
window.addEventListener("unhandledrejection", (event) =>
  window.__editorErrors.push(String(event.reason)),
);
try {
  config = await api("/api/editor/config");
  if (!config.engineScene)
    throw new Error(
      "Restart the editor server with launch-editor.cmd to enable the engine Scene view",
    );
  textureCatalogue = await api("/api/editor/textures");
  $("prerequisites").textContent =
    [
      !config.compiler ? "Compiler missing: npm run setup:editor" : null,
      !config.gameAvailable ? "Quake pak0.pak missing" : null,
      config.lan ? "LAN HTTPS enabled" : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Ready to build and play";
  await fetchTexture("ed_grid");
  await openStorage();
  project.gameFingerprint = config.gameFingerprint;
  queueSceneBuild();
  renderAssets();
} catch (e) {
  $("prerequisites").textContent = e.message;
  error(e);
}
refresh();
renderTextures();
