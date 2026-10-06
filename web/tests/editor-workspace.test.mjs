import test from "node:test";
import assert from "node:assert/strict";
import {
  starterProject,
  newEntity,
  newBrush,
  validateProject,
  exportMap,
  clone,
} from "../editor/domain.mjs";
import {
  metadata,
  groupSelection,
  duplicateObjects,
  removeObjects,
  translateObjects,
  templateFromSelection,
  insertTemplate,
} from "../editor/document.mjs";

function assembly() {
  const p = starterProject(),
    door = newEntity("func_door", [128, 0, 64]),
    button = newEntity("func_button", [80, -96, 64]);
  button.targetId = door.id;
  p.entities.push(door, button);
  p.brushes.push(
    newBrush("box", door.position, [16, 128, 128], "ed_grid", door.id),
    newBrush("box", [128, 0, 144], [16, 128, 32], "ed_grid", door.id),
    newBrush("box", button.position, [16, 32, 32], "ed_grid", button.id),
  );
  return { p, door, button };
}
test("hierarchy metadata migrates old documents without changing exported geometry", () => {
  const { p, door, button } = assembly(),
    map = exportMap(p);
  metadata(p).names[door.id] = "Hall door";
  groupSelection(p, [door.id, button.id], "Door assembly");
  assert.equal(exportMap(p), map);
  validateProject(p);
  const invalid = clone(p);
  invalid.editor.groups[0].ids.push("missing");
  assert.throws(() => validateProject(invalid), /membership/);
});
test("multi-object duplication remaps internal links and every owned brush", () => {
  const { p, door, button } = assembly();
  const ids = duplicateObjects(p, [door.id, button.id], [64, 32, 0]),
    copiedDoor = p.entities.find((e) => e.id === ids[0]),
    copiedButton = p.entities.find((e) => e.id === ids[1]);
  assert.equal(copiedButton.targetId, copiedDoor.id);
  assert.equal(p.brushes.filter((b) => b.entityId === copiedDoor.id).length, 2);
  assert.deepEqual(copiedDoor.position, [192, 32, 64]);
  assert.equal(button.targetId, door.id);
  translateObjects(p, ids, [16, 0, 0]);
  assert.equal(
    p.brushes.find((b) => b.entityId === copiedDoor.id).position[0],
    208,
  );
  validateProject(p);
});
test("templates carry textures and remap references without colliding with destination IDs", () => {
  const { p, door, button } = assembly();
  p.textures.push({
    name: "ed_saved",
    width: 16,
    height: 16,
    pixels: Buffer.alloc(256, 12).toString("base64"),
  });
  p.brushes.find((b) => b.entityId === door.id).faces[0].texture = "ed_saved";
  const template = templateFromSelection(
      p,
      [door.id, button.id],
      "Door button",
    ),
    destination = starterProject();
  destination.textures.push({
    ...p.textures[0],
    pixels: Buffer.alloc(256, 20).toString("base64"),
  });
  const ids = insertTemplate(destination, template, [256, 0, 64]);
  const createdDoor = destination.entities.find((e) => e.id === ids[0]),
    createdButton = destination.entities.find((e) => e.id === ids[1]);
  assert.equal(createdButton.targetId, createdDoor.id);
  assert.equal(
    destination.brushes.filter((b) => b.entityId === createdDoor.id).length,
    2,
  );
  assert.equal(destination.textures.length, 2);
  assert.notEqual(
    destination.brushes.find((b) => b.entityId === createdDoor.id).faces[0]
      .texture,
    "ed_saved",
  );
  validateProject(destination);
});
test("deleting a group removes owned geometry and cleans editor state and external links", () => {
  const { p, door, button } = assembly();
  groupSelection(p, [door.id, button.id]);
  metadata(p).hidden.push(door.id);
  metadata(p).locked.push(button.id);
  metadata(p).names[door.id] = "Door";
  removeObjects(p, [door.id]);
  assert.equal(button.targetId, null);
  assert.ok(!p.brushes.some((b) => b.entityId === door.id));
  assert.equal(p.editor.groups[0].ids.length, 1);
  assert.deepEqual(p.editor.hidden, []);
  assert.ok(!Object.hasOwn(p.editor.names, door.id));
  validateProject(p);
});
