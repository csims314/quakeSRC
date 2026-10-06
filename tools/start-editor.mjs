import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function run(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${file} failed`)),
    );
  });
}
await run("tools/setup-editor.mjs");
await run("tools/build-editor.mjs");
const port = process.env.QUAKE_WEB_PORT || 3000;
const url = `${process.env.QUAKE_EDITOR_LAN === "1" ? "https://localhost" : "http://127.0.0.1"}:${port}/editor/`;
console.log(`Level editor: ${url}`);
await run("web/server.mjs");
