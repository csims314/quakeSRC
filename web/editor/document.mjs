import { clone, uid, TYPES } from "./domain.mjs";
export const sceneObjects = (project) => [
  ...project.brushes.filter((b) => !b.entityId),
  ...project.entities,
];
export function metadata(project) {
  project.editor ||= {
    version: 1,
    names: {},
    groups: [],
    hidden: [],
    locked: [],
  };
  return project.editor;
}
export function displayName(project, object) {
  const names = metadata(project).names;
  return (
    (Object.hasOwn(names, object.id) ? names[object.id] : null) ||
    object.name ||
    (object.classname
      ? TYPES[object.classname].label
      : object.shape === "wedge"
        ? "Ramp"
        : "Block")
  );
}
export function groupSelection(project, ids, name = "Group") {
  const data = metadata(project),
    members = [...new Set(ids)].filter((id) =>
      sceneObjects(project).some((o) => o.id === id),
    );
  if (!members.length) return null;
  for (const group of data.groups)
    group.ids = group.ids.filter((id) => !members.includes(id));
  data.groups = data.groups.filter((g) => g.ids.length);
  const group = { id: uid(), name, ids: members };
  data.groups.push(group);
  return group;
}
export function duplicateObjects(project, ids, offset = [32, 32, 0]) {
  const chosen = new Set(ids),
    remap = new Map(),
    data = metadata(project);
  const entities = project.entities.filter((e) => chosen.has(e.id)).map(clone);
  const brushes = project.brushes
    .filter((b) => chosen.has(b.id) || chosen.has(b.entityId))
    .map(clone);
  for (const obj of [...entities, ...brushes]) {
    const old = obj.id;
    obj.id = uid();
    remap.set(old, obj.id);
    obj.position = obj.position.map((v, i) => v + offset[i]);
    if (data.names[old]) data.names[obj.id] = `${data.names[old]} Copy`;
  }
  for (const e of entities)
    if (e.targetId && remap.has(e.targetId)) e.targetId = remap.get(e.targetId);
  for (const b of brushes)
    if (b.entityId) b.entityId = remap.get(b.entityId) || b.entityId;
  project.entities.push(...entities);
  project.brushes.push(...brushes);
  return [...entities, ...brushes.filter((b) => !b.entityId)].map((o) => o.id);
}
export function removeObjects(project, ids) {
  const chosen = new Set(ids);
  project.entities = project.entities.filter((e) => !chosen.has(e.id));
  project.brushes = project.brushes.filter(
    (b) => !chosen.has(b.id) && !chosen.has(b.entityId),
  );
  for (const e of project.entities)
    if (chosen.has(e.targetId)) e.targetId = null;
  const data = metadata(project);
  for (const id of chosen) delete data.names[id];
  data.hidden = data.hidden.filter((id) => !chosen.has(id));
  data.locked = data.locked.filter((id) => !chosen.has(id));
  for (const group of data.groups)
    group.ids = group.ids.filter((id) => !chosen.has(id));
  data.groups = data.groups.filter((g) => g.ids.length);
}
export function translateObjects(project, ids, delta) {
  const chosen = new Set(ids);
  for (const e of project.entities)
    if (chosen.has(e.id)) e.position = e.position.map((v, i) => v + delta[i]);
  for (const b of project.brushes)
    if (chosen.has(b.id) || chosen.has(b.entityId))
      b.position = b.position.map((v, i) => v + delta[i]);
}
export function templateFromSelection(project, ids, name) {
  const chosen = new Set(ids),
    entities = project.entities.filter((e) => chosen.has(e.id)).map(clone),
    brushes = project.brushes
      .filter((b) => chosen.has(b.id) || chosen.has(b.entityId))
      .map(clone);
  const textures = project.textures
    .filter((t) =>
      brushes.some((b) => b.faces.some((f) => f.texture === t.name)),
    )
    .map(clone);
  const names = Object.fromEntries(
    sceneObjects(project)
      .filter((o) => chosen.has(o.id))
      .map((o) => [o.id, displayName(project, o)]),
  );
  return {
    version: 1,
    name: name || "Template",
    entities,
    brushes,
    textures,
    names,
  };
}
export function insertTemplate(project, template, position = [0, 0, 0]) {
  if (
    template.version !== 1 ||
    !Array.isArray(template.brushes) ||
    !Array.isArray(template.entities)
  )
    throw new Error("Invalid template");
  const copy = clone(template),
    remap = new Map();
  const all = [...copy.entities, ...copy.brushes],
    origin = all[0]?.position || [0, 0, 0];
  for (const obj of all) {
    const old = obj.id;
    obj.id = uid();
    remap.set(old, obj.id);
    obj.position = obj.position.map((v, i) => v - origin[i] + position[i]);
    if (copy.names && Object.hasOwn(copy.names, old))
      metadata(project).names[obj.id] = copy.names[old];
  }
  for (const e of copy.entities)
    e.targetId = e.targetId ? remap.get(e.targetId) || null : null;
  for (const b of copy.brushes)
    if (b.entityId) {
      if (!remap.has(b.entityId))
        throw new Error("Template brush has a missing owner");
      b.entityId = remap.get(b.entityId);
    }
  const textureRemap = new Map();
  for (const t of copy.textures || []) {
    const existing = project.textures.find((p) => p.name === t.name);
    if (existing && existing.pixels !== t.pixels) {
      const old = t.name;
      t.name = `ed_${uid().replaceAll("-", "").slice(0, 10)}`;
      textureRemap.set(old, t.name);
    }
    if (!project.textures.some((p) => p.name === t.name))
      project.textures.push(t);
  }
  for (const b of copy.brushes)
    for (const f of b.faces)
      if (textureRemap.has(f.texture)) f.texture = textureRemap.get(f.texture);
  project.entities.push(...copy.entities);
  project.brushes.push(...copy.brushes);
  const ids = [
    ...copy.entities,
    ...copy.brushes.filter((b) => !b.entityId),
  ].map((o) => o.id);
  groupSelection(project, ids, copy.name);
  return ids;
}
