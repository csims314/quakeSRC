import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const transport = path.join(project, 'node_modules/@fails-components/webtransport-transport-http3-quiche');
const check = () => spawnSync(process.execPath, ['--input-type=module', '-e', "await import('@fails-components/webtransport-transport-http3-quiche')"], { cwd: project, windowsHide: true, stdio: 'pipe' });
if (check().status !== 0) {
  // Download the dependency's official N-API prebuild. No shell or source build.
  const installer = path.join(project, 'node_modules/prebuild-install/bin.js');
  const install = spawnSync(process.execPath, [installer, '-r', 'napi', '-d', '-t', '6'], { cwd: transport, windowsHide: true, stdio: 'inherit' });
  if (install.status !== 0) throw new Error('Could not install the WebTransport native prebuild. See the installer output.');
  const result = check();
  if (result.status !== 0) throw new Error(`WebTransport native transport could not load: ${result.stderr}`);
}
console.log('WebTransport native transport is ready.');
