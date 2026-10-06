import { build } from "esbuild";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
await mkdir("web/dist/editor", { recursive: true });
await build({
  entryPoints: [
    "web/editor/ui.mjs",
    "web/editor/play.mjs",
    "web/editor/texture-worker.mjs",
    "web/editor/scene.mjs",
  ],
  outdir: "web/dist/editor",
  bundle: true,
  format: "esm",
  sourcemap: true,
  target: "es2022",
  legalComments: "linked",
});
for (const name of ["index.html", "style.css", "play.html", "scene.html"])
  await copyFile(`web/editor/${name}`, `web/dist/editor/${name}`);
const notices = [];
for (const dependency of ["three", "fflate"]) {
  const metadata = JSON.parse(
    await readFile(`node_modules/${dependency}/package.json`, "utf8"),
  );
  const license = await readFile(`node_modules/${dependency}/LICENSE`, "utf8");
  notices.push(`${dependency} ${metadata.version}\n${license}`);
}
await writeFile("web/dist/editor/DEPENDENCIES.txt", notices.join("\n\n"));
console.log("Editor browser files built.");
