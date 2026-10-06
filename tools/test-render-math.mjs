import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const source = fileURLToPath(new URL('../web/tests/render-effects-math.c', import.meta.url));
if (process.platform === 'win32') {
  const distro = process.env.QUAKE_WSL_DISTRO || 'ModelGenTrellis';
  const translated = spawnSync('wsl.exe', ['-d', distro, '--exec', 'wslpath', '-a', source], { encoding: 'utf8', windowsHide: true });
  if (translated.status) throw new Error(translated.stderr);
  const result = spawnSync('wsl.exe', ['-d', distro, '--exec', 'bash', '-c',
    'gcc -Wall -Wextra -O2 "$1" -lm -o "$2" && "$2"; result=$?; rm -f -- "$2"; exit "$result"',
    'render-math', translated.stdout.trim(), `/tmp/quake-render-math-${process.pid}`], { stdio: 'inherit', windowsHide: true });
  process.exitCode = result.status ?? 1;
} else {
  const directory = mkdtempSync(path.join(tmpdir(), 'quake-render-math-'));
  const binary = path.join(directory, 'test');
  try {
    const built = spawnSync(process.env.CC || 'cc', ['-Wall', '-Wextra', '-O2', source, '-lm', '-o', binary], { stdio: 'inherit' });
    process.exitCode = built.status || spawnSync(binary, [], { stdio: 'inherit' }).status;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
