export const VERSION = 1;
export const TYPES = {
  info_player_start: { label: "Player start", color: "#67d7ae" },
  info_player_coop: { label: "Co-op start", color: "#67d7ae" },
  light: {
    label: "Light",
    color: "#ffdc85",
    defaults: { light: "300", _color: "1 1 1" },
  },
  monster_army: { label: "Soldier", color: "#ee8279" },
  monster_ogre: { label: "Ogre", color: "#ee8279" },
  monster_dog: { label: "Dog", color: "#ee8279" },
  monster_knight: { label: "Knight", color: "#ee8279" },
  monster_zombie: { label: "Zombie", color: "#ee8279" },
  monster_demon1: { label: "Fiend", color: "#ee8279" },
  monster_shambler: { label: "Shambler", color: "#ee8279" },
  monster_wizard: { label: "Scrag", color: "#ee8279" },
  weapon_supershotgun: { label: "Super shotgun", color: "#a9b4ff" },
  weapon_nailgun: { label: "Nailgun", color: "#a9b4ff" },
  weapon_supernailgun: { label: "Super nailgun", color: "#a9b4ff" },
  weapon_grenadelauncher: { label: "Grenade launcher", color: "#a9b4ff" },
  weapon_rocketlauncher: { label: "Rocket launcher", color: "#a9b4ff" },
  weapon_lightning: { label: "Lightning gun", color: "#a9b4ff" },
  item_shells: { label: "Shells", color: "#a9b4ff" },
  item_spikes: { label: "Nails", color: "#a9b4ff" },
  item_rockets: { label: "Rockets", color: "#a9b4ff" },
  item_cells: { label: "Cells", color: "#a9b4ff" },
  item_health: { label: "Health", color: "#67d7ae" },
  item_armor1: { label: "Armor", color: "#67d7ae" },
  func_door: {
    label: "Door",
    color: "#bca3ff",
    brush: true,
    defaults: { angle: "0", speed: "100", wait: "3", lip: "8" },
  },
  func_button: {
    label: "Button",
    color: "#bca3ff",
    brush: true,
    defaults: { angle: "0", speed: "40", wait: "1", lip: "4" },
  },
  trigger_once: { label: "Once trigger", color: "#e9ae6d", brush: true },
  trigger_multiple: {
    label: "Repeat trigger",
    color: "#e9ae6d",
    brush: true,
    defaults: { wait: "0.2" },
  },
  trigger_changelevel: {
    label: "Level exit",
    color: "#e9ae6d",
    brush: true,
    defaults: { map: "e1m1" },
  },
};
export const uid = () => crypto.randomUUID();
export const clone = (value) => structuredClone(value);
export const snap = (value, grid = 16) => Math.round(value / grid) * grid;
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export function rotate(point, angles) {
  let [x, y, z] = point;
  const [a, b, c] = angles.map((v) => (v * Math.PI) / 180);
  [y, z] = [
    y * Math.cos(a) - z * Math.sin(a),
    y * Math.sin(a) + z * Math.cos(a),
  ];
  [x, z] = [
    x * Math.cos(b) + z * Math.sin(b),
    -x * Math.sin(b) + z * Math.cos(b),
  ];
  return [
    x * Math.cos(c) - y * Math.sin(c),
    x * Math.sin(c) + y * Math.cos(c),
    z,
  ];
}
export function brushFaces(brush) {
  const [x, y, z] = brush.size.map((v) => v / 2);
  const points =
    brush.shape === "wedge"
      ? [
          [-x, -y, -z],
          [x, -y, -z],
          [x, y, -z],
          [-x, y, -z],
          [x, -y, z],
          [x, y, z],
        ]
      : [
          [-x, -y, -z],
          [x, -y, -z],
          [x, y, -z],
          [-x, y, -z],
          [-x, -y, z],
          [x, -y, z],
          [x, y, z],
          [-x, y, z],
        ];
  const indexes =
    brush.shape === "wedge"
      ? [
          [0, 3, 2, 1],
          [0, 1, 4],
          [1, 2, 5, 4],
          [2, 3, 5],
          [3, 0, 4, 5],
        ]
      : [
          [0, 3, 2, 1],
          [4, 5, 6, 7],
          [0, 1, 5, 4],
          [1, 2, 6, 5],
          [2, 3, 7, 6],
          [3, 0, 4, 7],
        ];
  const world = points.map((p) =>
    rotate(p, brush.rotation).map((v, i) => v + brush.position[i]),
  );
  return indexes.map((indices, i) => {
    const vertices = indices.map((index) => world[index]);
    const n = cross(
      sub(vertices[1], vertices[0]),
      sub(vertices[2], vertices[0]),
    );
    const length = Math.hypot(...n);
    return {
      vertices,
      normal: n.map((v) => v / length),
      surface: brush.faces[i],
    };
  });
}
export function textureAxes(normal, rotation = 0) {
  const dominant = normal
    .map(Math.abs)
    .indexOf(Math.max(...normal.map(Math.abs)));
  const u = dominant === 0 ? [0, 1, 0] : [1, 0, 0];
  const v = dominant === 2 ? [0, -1, 0] : [0, 0, -1];
  const a = (rotation * Math.PI) / 180;
  return [
    u.map((x, i) => x * Math.cos(a) - v[i] * Math.sin(a)),
    u.map((x, i) => x * Math.sin(a) + v[i] * Math.cos(a)),
  ];
}
export function newBrush(
  shape = "box",
  position = [0, 0, 64],
  size = [128, 128, 128],
  texture = "ed_grid",
  entityId = null,
) {
  return {
    id: uid(),
    shape,
    position: [...position],
    size: [...size],
    rotation: [0, 0, 0],
    entityId,
    faces: Array.from({ length: shape === "wedge" ? 5 : 6 }, () => ({
      texture,
      shift: [0, 0],
      scale: [1, 1],
      rotation: 0,
    })),
  };
}
export function newEntity(classname, position = [0, 0, 32]) {
  if (!Object.hasOwn(TYPES, classname)) throw new Error("Unknown object type");
  return {
    id: uid(),
    classname,
    position: [...position],
    properties: { ...TYPES[classname].defaults },
    targetId: null,
  };
}
export function roomBrushes(
  center = [0, 0, 128],
  size = [1024, 1024, 256],
  texture = "ed_grid",
) {
  const [x, y, z] = size,
    t = 16,
    [cx, cy, cz] = center;
  return [
    newBrush(
      "box",
      [cx, cy, cz - z / 2 - t / 2],
      [x + 2 * t, y + 2 * t, t],
      texture,
    ),
    newBrush(
      "box",
      [cx, cy, cz + z / 2 + t / 2],
      [x + 2 * t, y + 2 * t, t],
      texture,
    ),
    newBrush("box", [cx - x / 2 - t / 2, cy, cz], [t, y + 2 * t, z], texture),
    newBrush("box", [cx + x / 2 + t / 2, cy, cz], [t, y + 2 * t, z], texture),
    newBrush("box", [cx, cy - y / 2 - t / 2, cz], [x, t, z], texture),
    newBrush("box", [cx, cy + y / 2 + t / 2, cz], [x, t, z], texture),
  ].map((b, i) => ({
    ...b,
    name: [
      "Floor",
      "Ceiling",
      "West wall",
      "East wall",
      "South wall",
      "North wall",
    ][i],
  }));
}
export function starterProject() {
  const entities = [
    newEntity("info_player_start", [-320, -256, 32]),
    newEntity("light", [0, 0, 192]),
  ];
  for (let i = 1; i < 8; i++)
    entities.push(
      newEntity("info_player_coop", [
        -320 + (i % 4) * 96,
        -256 + Math.floor(i / 4) * 96,
        32,
      ]),
    );
  return {
    version: VERSION,
    id: uid(),
    title: "Untitled level",
    revision: 0,
    gameFingerprint: null,
    brushes: roomBrushes(),
    entities,
    textures: [],
  };
}
const text = (value) => {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    /["\\\x00-\x1f]/.test(value)
  )
    throw new Error("Unsupported text in project");
  return value;
};
const vector = (value, positive = false) => {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some(
      (x) => !Number.isFinite(x) || Math.abs(x) > 16384 || (positive && x < 1),
    )
  )
    throw new Error("Invalid geometry coordinates");
};
export function validateProject(
  p,
  { textures = null, maps = null, requireSpawn = true } = {},
) {
  if (!p || p.version !== VERSION)
    throw new Error("Unsupported project version");
  text(p.title);
  if (!Number.isSafeInteger(p.revision) || p.revision < 0)
    throw new Error("Invalid project revision");
  if (
    !Array.isArray(p.brushes) ||
    p.brushes.length > 2048 ||
    !Array.isArray(p.entities) ||
    p.entities.length > 512 ||
    !Array.isArray(p.textures) ||
    p.textures.length > 128
  )
    throw new Error("Project exceeds editor limits");
  const ids = new Set();
  for (const obj of [...p.brushes, ...p.entities]) {
    if (
      typeof obj.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(obj.id) ||
      ids.has(obj.id)
    )
      throw new Error("Invalid or duplicate object ID");
    ids.add(obj.id);
    vector(obj.position);
    if (obj.name !== undefined) {
      if (typeof obj.name !== "string" || obj.name.length > 80)
        throw new Error("Invalid object name");
      text(obj.name);
    }
  }
  const entities = new Map(p.entities.map((e) => [e.id, e]));
  if (p.editor) {
    const data = p.editor,
      objects = new Set(
        [...p.brushes.filter((b) => !b.entityId), ...p.entities].map(
          (o) => o.id,
        ),
      );
    if (
      data.version !== 1 ||
      !data.names ||
      typeof data.names !== "object" ||
      Array.isArray(data.names) ||
      !Array.isArray(data.groups) ||
      data.groups.length > 2048 ||
      !Array.isArray(data.hidden) ||
      !Array.isArray(data.locked)
    )
      throw new Error("Invalid editor metadata");
    for (const [id, name] of Object.entries(data.names)) {
      if (!objects.has(id) || typeof name !== "string" || name.length > 80)
        throw new Error("Invalid object name");
      text(name);
    }
    const members = new Set(),
      groups = new Set();
    for (const g of data.groups) {
      if (
        !g ||
        !/^[-a-zA-Z0-9_]{1,64}$/.test(g.id) ||
        groups.has(g.id) ||
        typeof g.name !== "string" ||
        g.name.length > 80 ||
        !Array.isArray(g.ids)
      )
        throw new Error("Invalid hierarchy group");
      text(g.name);
      groups.add(g.id);
      for (const id of g.ids) {
        if (!objects.has(id) || members.has(id))
          throw new Error("Invalid group membership");
        members.add(id);
      }
    }
    for (const id of [...data.hidden, ...data.locked])
      if (!objects.has(id))
        throw new Error("Invalid editor visibility or lock");
  }
  for (const e of p.entities) {
    if (!Object.hasOwn(TYPES, e.classname))
      throw new Error("Unknown gameplay object");
    if (
      !e.properties ||
      typeof e.properties !== "object" ||
      Object.keys(e.properties).length > 32
    )
      throw new Error("Invalid object properties");
    for (const [key, value] of Object.entries(e.properties)) {
      if (
        !/^[a-zA-Z_][a-zA-Z0-9_]{0,30}$/.test(key) ||
        [
          "classname",
          "origin",
          "target",
          "targetname",
          "model",
          "wad",
          "mapversion",
        ].includes(key)
      )
        throw new Error("Unsupported object property");
      text(value);
      if (
        [
          "angle",
          "speed",
          "wait",
          "lip",
          "dmg",
          "health",
          "light",
          "spawnflags",
          "count",
        ].includes(key) &&
        (!value.trim() ||
          !Number.isFinite(Number(value)) ||
          Math.abs(Number(value)) > 100000)
      )
        throw new Error(`Invalid ${key} property`);
      if (
        key === "_color" &&
        (value.trim().split(/\s+/).length !== 3 ||
          value
            .trim()
            .split(/\s+/)
            .some(
              (v) =>
                !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 1,
            ))
      )
        throw new Error("Light color must contain three numbers from 0 to 1");
    }
    if (e.targetId && !entities.has(e.targetId))
      throw new Error("An object has a missing target");
    if (
      e.classname === "trigger_changelevel" &&
      (!/^[a-zA-Z0-9_]+$/.test(e.properties.map || "") ||
        (maps && !maps.includes(e.properties.map)))
    )
      throw new Error("Choose an installed map for the level exit");
    if (TYPES[e.classname].brush && !p.brushes.some((b) => b.entityId === e.id))
      throw new Error("A brush object has no geometry");
  }
  if (p.entities.filter((e) => TYPES[e.classname].brush).length > 128)
    throw new Error("Too many doors, buttons or triggers");
  for (const b of p.brushes) {
    if (!["box", "wedge"].includes(b.shape))
      throw new Error("Unsupported brush shape");
    vector(b.size, true);
    vector(b.rotation);
    if (
      b.entityId &&
      (!entities.has(b.entityId) ||
        !TYPES[entities.get(b.entityId).classname].brush)
    )
      throw new Error("Brush has a missing owner");
    if (
      !Array.isArray(b.faces) ||
      b.faces.length !== (b.shape === "wedge" ? 5 : 6)
    )
      throw new Error("Invalid brush faces");
    for (const f of b.faces) {
      if (
        typeof f.texture !== "string" ||
        !/^[a-zA-Z0-9_*+!-]{1,15}$/.test(f.texture) ||
        (textures && !textures.has(f.texture))
      )
        throw new Error(`Missing texture: ${f.texture}`);
      for (const [values, positive] of [
        [f.shift, false],
        [f.scale, true],
      ]) {
        if (
          !Array.isArray(values) ||
          values.length !== 2 ||
          values.some(
            (v) =>
              !Number.isFinite(v) ||
              Math.abs(v) > 65536 ||
              (positive && v <= 0),
          )
        )
          throw new Error("Invalid texture alignment");
      }
      if (!Number.isFinite(f.rotation))
        throw new Error("Invalid texture rotation");
    }
    if (
      brushFaces(b).some((f) =>
        f.vertices.some((v) => v.some((n) => Math.abs(n) > 16384)),
      )
    )
      throw new Error("Brush lies outside the supported world");
  }
  if (
    requireSpawn &&
    p.entities.filter((e) => e.classname === "info_player_start").length !== 1
  )
    throw new Error("Place exactly one player start");
  if (requireSpawn) {
    const solids = p.brushes.filter((b) => !b.entityId).map(brushFaces);
    for (const e of p.entities.filter((e) =>
      e.classname.startsWith("info_player_"),
    )) {
      if (
        solids.some((faces) =>
          faces.every(
            (f) => dot(sub(e.position, f.vertices[0]), f.normal) <= 0,
          ),
        )
      ) {
        throw new Error(
          "A player start is inside solid geometry. Place starts above the floor and clear of walls.",
        );
      }
    }
  }
  const names = new Set();
  for (const t of p.textures) {
    if (
      !t ||
      typeof t.name !== "string" ||
      !/^ed_[a-zA-Z0-9_]{1,12}$/.test(t.name) ||
      t.name === "ed_grid" ||
      names.has(t.name) ||
      !Number.isInteger(t.width) ||
      !Number.isInteger(t.height) ||
      t.width < 16 ||
      t.height < 16 ||
      t.width > 512 ||
      t.height > 512 ||
      t.width % 16 ||
      t.height % 16 ||
      typeof t.pixels !== "string" ||
      t.pixels.length > 512 * 512 * 2 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(t.pixels)
    )
      throw new Error("Invalid imported texture");
    names.add(t.name);
    let pixels;
    try {
      pixels = atob(t.pixels);
    } catch {
      throw new Error("Invalid imported texture encoding");
    }
    if (
      pixels.length !== t.width * t.height ||
      [...pixels].some((c) => c.charCodeAt(0) >= 224)
    )
      throw new Error("Invalid imported texture pixels");
    if (
      t.source &&
      (typeof t.source !== "string" || t.source.length > 12 * 1024 * 1024)
    )
      throw new Error("Imported image is too large");
  }
  return p;
}
const n = (value) => String(Number(value.toFixed(6)));
const vec = (value) => value.map(n).join(" ");
export function exportMap(p) {
  validateProject(p);
  const brush = (b) =>
    [
      "{",
      ...brushFaces(b).map(({ vertices, normal, surface: f }) => {
        const [u, v] = textureAxes(normal, f.rotation);
        // Quake plane points are clockwise when viewed from outside the solid.
        return `${[vertices[2], vertices[1], vertices[0]].map((p) => `( ${vec(p)} )`).join(" ")} ${f.texture} [ ${vec(u)} ${n(f.shift[0])} ] [ ${vec(v)} ${n(f.shift[1])} ] 0 ${n(f.scale[0])} ${n(f.scale[1])}`;
      }),
      "}",
    ].join("\n");
  const lines = [
    "{",
    '"classname" "worldspawn"',
    '"mapversion" "220"',
    '"wad" "textures.wad"',
    // Like the original levels, name a CD track so the level's music plays.
    '"sounds" "6"',
    `"message" "${text(p.title)}"`,
    ...p.brushes.filter((b) => !b.entityId).map(brush),
    "}",
  ];
  const targeted = new Set(p.entities.map((e) => e.targetId).filter(Boolean));
  for (const e of p.entities) {
    lines.push("{", `"classname" "${e.classname}"`, `"_editor_id" "${e.id}"`);
    if (!TYPES[e.classname].brush) lines.push(`"origin" "${vec(e.position)}"`);
    if (targeted.has(e.id)) lines.push(`"targetname" "e_${e.id}"`);
    if (e.targetId) lines.push(`"target" "e_${e.targetId}"`);
    for (const [k, v] of Object.entries(e.properties))
      lines.push(`"${k}" "${text(v)}"`);
    lines.push(...p.brushes.filter((b) => b.entityId === e.id).map(brush), "}");
  }
  return lines.join("\n") + "\n";
}
export function cutOpening(b, width = 128, height = 128) {
  if (b.shape !== "box" || b.entityId || b.rotation.some((v) => v !== 0))
    throw new Error("Choose an unrotated wall box");
  const axis = b.size[0] > b.size[1] ? 0 : 1;
  const length = b.size[axis],
    z = b.size[2];
  if (width >= length || height >= z)
    throw new Error("Opening must be smaller than the wall");
  const pieces = [];
  for (const sign of [-1, 1]) {
    const q = clone(b);
    q.id = uid();
    q.size[axis] = (length - width) / 2;
    q.position[axis] += sign * (width / 2 + q.size[axis] / 2);
    pieces.push(q);
  }
  const q = clone(b);
  q.id = uid();
  q.size[axis] = width;
  q.size[2] = z - height;
  q.position[2] += height / 2;
  pieces.push(q);
  return pieces;
}
