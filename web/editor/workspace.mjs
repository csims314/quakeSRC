/* Layout is separate from the document and never enters exported MAP files. */
export function createWorkspace() {
  const $ = (id) => document.getElementById(id),
    main = document.querySelector("main");
  document
    .querySelector(".workspace-tabs")
    .insertBefore($("stop-session"), $("scene-revision"));
  const scene = document.createElement("section");
  scene.id = "scene-panel";
  for (const element of [
    document.querySelector(".viewport-toolbar"),
    $("viewports"),
    document.querySelector(".statusbar"),
  ])
    scene.append(element);
  const game = document.createElement("section");
  game.id = "game-panel";
  game.hidden = true;
  game.append($("play-dialog"));
  const empty = document.createElement("p");
  empty.id = "game-empty";
  empty.textContent = "Use Play solo or Host co-op to launch your level.";
  game.prepend(empty);
  const dock = document.createElement("section");
  dock.id = "bottom-dock";
  dock.innerHTML =
    '<div class="dock-tabs"><button data-dock="project" class="active" draggable="true">Project</button><button data-dock="console" draggable="true">Console</button><button id="reset-layout">Reset layout</button><select id="dock-position" aria-label="Dock position"><option value="bottom">Bottom</option><option value="right">Right</option><option value="left">Left</option></select></div><div id="project-panel"><div class="project-tabs"><button data-assets="textures" class="active">Textures</button><button data-assets="objects">Game objects</button><button data-assets="templates">Templates</button><button data-assets="projects">Projects</button><button data-assets="builds">Builds</button></div><div id="textures-assets"></div><div id="objects-assets" hidden></div><div id="templates-assets" hidden></div><div id="projects-assets" hidden></div><div id="builds-assets" hidden></div></div><div id="console-panel" hidden></div>';
  main.append(dock);
  const textures = $("textures-assets"),
    right = document.querySelector(".right-panel");
  for (const id of [
    "texture-search",
    "image-import",
    "texture-note",
    "texture-list",
  ]) {
    const element = $(id);
    textures.append(id === "image-import" ? element.closest("label") : element);
  }
  const heading = [...right.querySelectorAll(":scope > .section-heading")].find(
    (el) => el.textContent.includes("TEXTURES"),
  );
  if (heading) textures.prepend(heading);
  const consolePanel = dock.querySelector("#console-panel");
  consolePanel.append(document.querySelector(".build-panel"));
  main.append(scene, game, dock);
  let saved = {};
  try {
    saved =
      JSON.parse(localStorage.getItem("quake-editor-layout") || "null") || {};
  } catch {
    // A damaged preference should never prevent opening a level.
  }
  const dimension = (value, fallback, min) =>
    Number.isFinite(value) ? Math.max(min, Math.min(420, value)) : fallback;
  const layout = {
    left: dimension(saved.left, 220, 170),
    right: dimension(saved.right, 270, 170),
    dock: dimension(saved.dock, 210, 130),
    position: ["bottom", "left", "right"].includes(saved.position)
      ? saved.position
      : "bottom",
  };
  function apply() {
    document.documentElement.style.setProperty(
      "--left-width",
      `${layout.left}px`,
    );
    document.documentElement.style.setProperty(
      "--right-width",
      `${layout.right}px`,
    );
    document.documentElement.style.setProperty(
      "--dock-height",
      `${layout.dock}px`,
    );
    document
      .querySelector(
        layout.position === "left"
          ? ".left-panel"
          : layout.position === "right"
            ? ".right-panel"
            : "main",
      )
      .append(dock);
    $("dock-position").value = layout.position;
    localStorage.setItem("quake-editor-layout", JSON.stringify(layout));
  }
  function resizeHandle(element, key, horizontal) {
    const handle = document.createElement("div");
    handle.className = `panel-resize ${horizontal ? "vertical" : "horizontal"}`;
    element.append(handle);
    handle.onpointerdown = (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const start = horizontal ? e.clientX : e.clientY,
        before = layout[key];
      handle.onpointermove = (move) => {
        const delta =
          ((horizontal ? move.clientX : move.clientY) - start) *
          (key === "left" ? 1 : -1);
        layout[key] = Math.max(
          key === "dock" ? 130 : 170,
          Math.min(420, before + delta),
        );
        apply();
      };
      handle.onpointerup = () => {
        handle.onpointermove = null;
      };
    };
  }
  resizeHandle(document.querySelector(".left-panel"), "left", true);
  resizeHandle(document.querySelector(".right-panel"), "right", true);
  resizeHandle(dock, "dock", false);
  $("dock-position").onchange = () => {
    layout.position = $("dock-position").value;
    apply();
  };
  $("reset-layout").onclick = () => {
    Object.assign(layout, {
      left: 220,
      right: 270,
      dock: 210,
      position: "bottom",
    });
    apply();
  };
  for (const button of dock.querySelectorAll("[data-dock]"))
    button.onclick = () => {
      const type = button.dataset.dock;
      $("project-panel").hidden = type !== "project";
      $("console-panel").hidden = type !== "console";
      dock
        .querySelectorAll("[data-dock]")
        .forEach((b) => b.classList.toggle("active", b === button));
    };
  for (const button of dock.querySelectorAll("[data-assets]"))
    button.onclick = () => {
      dock.querySelectorAll("[data-assets]").forEach((b) => {
        b.classList.toggle("active", b === button);
        $(`${b.dataset.assets}-assets`).hidden = b !== button;
      });
    };
  for (const region of [
    document.querySelector(".left-panel"),
    document.querySelector(".right-panel"),
    main,
  ]) {
    region.ondragover = (e) => {
      if (e.dataTransfer.types.includes("application/x-editor-panel"))
        e.preventDefault();
    };
    region.ondrop = (e) => {
      if (e.dataTransfer.getData("application/x-editor-panel")) {
        e.preventDefault();
        layout.position =
          region === main
            ? "bottom"
            : region.classList.contains("left-panel")
              ? "left"
              : "right";
        apply();
      }
    };
  }
  dock
    .querySelectorAll("[data-dock]")
    .forEach(
      (b) =>
        (b.ondragstart = (e) =>
          e.dataTransfer.setData("application/x-editor-panel", b.dataset.dock)),
    );
  apply();
  return {
    tab(type) {
      scene.hidden = type !== "scene";
      game.hidden = type !== "game";
      $("game-empty").hidden = $("play-dialog").open;
      $("scene-tab").classList.toggle("active", type === "scene");
      $("game-tab").classList.toggle("active", type === "game");
    },
    assets(type) {
      dock.querySelector(`[data-assets="${type}"]`)?.click();
    },
    console() {
      dock.querySelector('[data-dock="console"]').click();
    },
  };
}
