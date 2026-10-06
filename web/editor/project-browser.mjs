import { TYPES } from "./domain.mjs";
export function createProjectBrowser(actions) {
  const $ = (id) => document.getElementById(id),
    thumbnails = new Map();
  let thumbnailFingerprint;
  const thumbnailKey = (entity) =>
    `${actions.scene().fingerprint}:${actions.scene().current?.id}:${entity.model}:${entity.skin}`;
  function button(label, fn, description) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => Promise.resolve(fn()).catch(actions.error);
    if (description) b.title = description;
    return b;
  }
  const objects = $("objects-assets");
  objects.className = "asset-grid";
  for (const [type, info] of Object.entries(TYPES)) {
    const b = button(
      info.label,
      () => actions.add(type),
      `Place ${type} using the game's spawn code`,
    );
    b.dataset.classname = type;
    b.draggable = true;
    b.ondragstart = (e) =>
      e.dataTransfer.setData("application/x-quake-entity", type);
    objects.append(b);
  }
  async function readLibrary() {
    const db = actions.db();
    if (!db) return [];
    return new Promise((resolve, reject) => {
      const store = db.transaction("projects").objectStore("projects"),
        request = store.getAll(),
        keys = store.getAllKeys();
      let values, names;
      request.onsuccess = () => {
        values = request.result;
        if (names) resolve(names.map((key, i) => ({ key, value: values[i] })));
      };
      keys.onsuccess = () => {
        names = keys.result;
        if (values) resolve(names.map((key, i) => ({ key, value: values[i] })));
      };
      request.onerror = keys.onerror = () =>
        reject(request.error || keys.error);
    });
  }
  async function render() {
    const fingerprint = `${actions.scene().fingerprint}:${actions.scene().current?.id}`;
    if (thumbnailFingerprint !== fingerprint) {
      thumbnailFingerprint = fingerprint;
      thumbnails.clear();
      objects.querySelectorAll("img").forEach((img) => img.remove());
    }
    const library = await readLibrary(),
      templates = $("templates-assets"),
      projects = $("projects-assets"),
      builds = $("builds-assets");
    templates.replaceChildren();
    projects.replaceChildren();
    builds.replaceChildren();
    templates.className = projects.className = builds.className = "asset-grid";
    templates.append(
      button("Save selection as template", async () => {
        await actions.saveTemplate();
        await render();
      }),
      button("Import template", () => $("template-import").click()),
    );
    for (const [name, value] of actions.builtins())
      templates.append(button(name, () => actions.insert(value)));
    for (const entry of library) {
      if (entry.key.startsWith("template:")) {
        const b = button(entry.value.name, () => actions.insert(entry.value));
        b.draggable = true;
        b.ondragstart = (e) =>
          e.dataTransfer.setData(
            "application/x-quake-template",
            JSON.stringify(entry.value),
          );
        templates.append(b);
        const out = button(`Export ${entry.value.name}`, () =>
          actions.exportTemplate(entry.value),
        );
        templates.append(out);
      } else if (entry.key.startsWith("project:"))
        projects.append(
          button(entry.value.title, () => actions.load(entry.value)),
        );
    }
    const build = actions.build();
    if (build)
      builds.append(
        button(
          `${build.map} · r${build.revision} · ${build.status}`,
          () => actions.exportBuild(),
          "Export compiled BSP/LIT",
        ),
      );
    const snapshot = actions.scene().snapshot();
    for (const entity of snapshot?.entities || []) {
      const source = actions.project().entities.find((e) => e.id === entity.id);
      if (!source) continue;
      const b = objects.querySelector(`[data-classname="${source.classname}"]`);
      if (!b) continue;
      b.title = `${entity.model} · skin ${entity.skin} · frame ${entity.frame}`;
      const image = thumbnails.get(thumbnailKey(entity));
      b.querySelector("img")?.remove();
      if (image) {
        const img = document.createElement("img");
        img.src = image;
        img.alt = entity.model;
        b.prepend(img);
      }
    }
  }
  const input = document.createElement("input");
  input.id = "template-import";
  input.type = "file";
  input.accept = ".json";
  input.hidden = true;
  input.onchange = async () => {
    try {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 16 * 1024 * 1024)
        throw new Error("Template exceeds 16 MiB");
      actions.insert(JSON.parse(await file.text()));
    } catch (e) {
      actions.error(e);
    } finally {
      input.value = "";
    }
  };
  document.body.append(input);
  return {
    render,
    capture: async (native) => {
      const png = await actions.scene().thumbnail(native);
      thumbnails.set(thumbnailKey(native), png);
      await render();
      return png;
    },
  };
}
