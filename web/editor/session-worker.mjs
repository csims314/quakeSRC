import { readFile } from "node:fs/promises";
import path from "node:path";
import { startMultiplayer } from "../multiplayer.mjs";
let server, timer;
process.on("message", async (message) => {
  if (message.type === "stop") {
    clearInterval(timer);
    server?.stop();
    process.exit(0);
  }
  if (message.type !== "start") return;
  try {
    const { root, build, options, skill } = message;
    const files = [];
    for (const f of build.files)
      files.push({
        name: `maps/${f.name}`,
        bytes: await readFile(path.join(build.directory, f.name)),
      });
    server = await startMultiplayer(root, {
      ...options,
      origins: new Set(options.origins),
      editorFiles: files,
      roomDefinitions: {
        defaultMode: "coop",
        rooms: [
          {
            id: "coop",
            path: "/quake",
            label: "Editor co-op",
            skill,
            map: build.map,
            fragLimit: 0,
            timeLimit: 0,
          },
        ],
      },
    });
    if (!server.healthy())
      throw new Error("Engine did not load the custom level");
    process.send({ type: "ready", config: server.config("coop") });
    timer = setInterval(
      () =>
        process.send({
          type: "state",
          state: server.status("coop"),
          world: server.world("coop"),
          connection: server.config("coop"),
        }),
      1000,
    );
  } catch (e) {
    process.send({ type: "error", error: e.stack || e.message });
  }
});
process.on("disconnect", () => {
  clearInterval(timer);
  server?.stop();
  process.exit(0);
});
