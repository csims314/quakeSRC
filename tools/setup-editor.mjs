import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "tools", "ericw-tools");
const platform =
  process.platform === "win32"
    ? "win64"
    : process.platform === "linux"
      ? "Linux"
      : process.platform === "darwin"
        ? "Darwin"
        : null;
if (!platform) throw new Error("Unsupported map compiler platform");
const suffix = process.platform === "win32" ? ".exe" : "";
try {
  await Promise.all(
    ["qbsp", "vis", "light"].map((n) =>
      access(path.join(directory, n + suffix)),
    ),
  );
  await access(path.join(directory, "gpl_v3.txt"));
  console.log("Map compiler is ready.");
  process.exit(0);
} catch {}
const url = `https://github.com/ericwa/ericw-tools/releases/download/v0.18.1/ericw-tools-v0.18.1-${platform}.zip`;
console.log(`Downloading ericw-tools 0.18.1 (${platform})`);
const response = await fetch(url);
if (!response.ok)
  throw new Error(`Compiler download failed: ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
const checksum = createHash("sha256").update(bytes).digest("hex");
if (platform === "win64" && checksum !== "a0f39c6faeb29cd08b267880cdcebb310f9938fef4cbbff07d1f6843c36e9cd3") throw new Error("Compiler archive checksum mismatch");
const files = unzipSync(bytes),
  names = Object.keys(files);
await mkdir(directory, { recursive: true });
for (const [name, data] of Object.entries(files)) {
  if (name.endsWith("/")) continue;
  // Flatten binaries and their adjacent libraries, retain licenses and docs.
  const base = path.basename(name);
  if (
    /\.(exe|dll|so(?:\.\d+)*|dylib|txt|md|html)$/i.test(base) ||
    ["qbsp", "vis", "light", "bsputil"].includes(base) ||
    /license|copying/i.test(base)
  )
    await writeFile(path.join(directory, base), data, { mode: 0o755 });
}
await writeFile(
  path.join(directory, "download.json"),
  JSON.stringify(
    {
      version: "0.18.1",
      url,
      sha256: checksum,
      files: names,
    },
    null,
    2,
  ),
);
await Promise.all(
  ["qbsp", "vis", "light"].map((n) => access(path.join(directory, n + suffix))),
);
console.log("Map compiler installed.");
