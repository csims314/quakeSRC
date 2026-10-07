// Two real browsers exercise Nick, Chris and Ranger through the actual engine.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as portProbe } from 'node:net';
import { decodePng } from '../../tools/characters/lib/png.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.QUAKE_TEST_WEB_PORT || 3108);
const quicPort = Number(process.env.QUAKE_TEST_MULTIPLAYER_PORT || 4452);
const publicUrl = process.env.QUAKE_TEST_PUBLIC_URL;
const url = (publicUrl || `http://127.0.0.1:${port}`).replace(/\/$/, '');
const nativeCli = path.join(path.dirname(process.execPath), 'node_modules', 'agent-browser', 'bin', 'agent-browser-win32-x64.exe');
const cli = process.env.AGENT_BROWSER_BIN || (process.platform === 'win32' && existsSync(nativeCli) ? nativeCli : 'agent-browser');
const artifactDir = path.join(project, `web/test-artifacts/characters${publicUrl ? '-production' : ''}`);
const [nick, ranger] = [`quake-character-nick-${process.pid}`, `quake-character-ranger-${process.pid}`];
const NICK_MODEL = 'characters/nick/player.mdl';
let server, serverOutput = '', failure;
const checks = [], evidence = {};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(fn, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    try { last = await fn(); if (last) return last; } catch (error) { last = error.message; }
    await delay(150);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}; last result: ${JSON.stringify(last)}`);
}
function browser(session, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ['--session', session, '--json', ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '', error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Browser command timed out: ${args.join(' ')}`)); }, 45000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('exit', code => {
      clearTimeout(timer);
      child.stdout.destroy(); child.stderr.destroy();
      try {
        const result = JSON.parse(output.trim());
        if (code || !result.success) throw new Error(result.error || error || output);
        resolve(result.data);
      } catch (problem) { reject(new Error(`${args.join(' ')}: ${problem.message}; ${error}`)); }
    });
    child.stdin.end(input);
  });
}
const evaluate = async (session, code) => (await browser(session, ['eval', '--stdin'], code)).result;
const command = (session, text) => evaluate(session, `window.quake.command(${JSON.stringify(text)}); true`);
const state = session => evaluate(session, 'window.quake.state()');
const status = async () => (await fetch(`${url}/api/multiplayer/status?mode=coop`, { signal: AbortSignal.timeout(2000) })).json();
const seen = async (session, slot) => (await state(session)).players.find(player => player.slot === slot)?.model;
const shot = (session, name) => evaluate(session, "document.getElementById('capture').hidden = true; true")
  .then(() => browser(session, ['screenshot', path.join(artifactDir, name)]));
function passed(name) { checks.push(name); console.log(`PASS ${name}`); }

async function checkHudPortrait(scale, session = nick, character = 'nick') {
  await command(session, `scr_sbarscale ${scale}\ngamma 1\ncontrast 1\ngl_texturemode GL_NEAREST`);
  await delay(350);
  const filename = `${character}-hud-scale-${scale}.png`;
  await shot(session, filename);
  const rendered = decodePng(await readFile(path.join(artifactDir, filename))),
    portrait = decodePng(await readFile(path.join(project, `web/dist/characters/${character}/face1.png`))),
    box = await evaluate(session, `(()=>{
      const canvas = document.getElementById('canvas'), rect = canvas.getBoundingClientRect();
      const scale = Math.min(${scale}, canvas.width / 320), factor = rect.width / canvas.width;
      return { x: rect.left + ((canvas.width - 320 * scale) / 2 + 112 * scale) * factor,
        y: rect.top + (canvas.height - 24 * scale) * factor, size: 24 * scale * factor };
    })()`);
  const pixel = (image, x, y) => (Math.round(y) * image.width + Math.round(x)) * 4;
  let fullError = 0, croppedError = 0, samples = 0;
  for (let y = 1; y <= 9; y++) for (let x = 1; x <= 9; x++) {
    const u = x / 10, v = y / 10,
      actual = pixel(rendered, box.x + u * box.size, box.y + v * box.size),
      full = pixel(portrait, u * (portrait.width - 1), v * (portrait.height - 1)),
      cropped = pixel(portrait, u * (portrait.width - 1) * 0.75, v * (portrait.height - 1) * 0.75);
    for (let channel = 0; channel < 3; channel++) {
      fullError += Math.abs(rendered.rgba[actual + channel] - portrait.rgba[full + channel]);
      croppedError += Math.abs(rendered.rgba[actual + channel] - portrait.rgba[cropped + channel]);
      samples++;
    }
  }
  evidence[`${character}HudScale${scale}`] = { fullError: fullError / samples, croppedError: croppedError / samples };
  assert.ok(fullError < croppedError * 0.7, `scale ${scale}: the HUD must show the full portrait, including its right/bottom edges`);
}

async function launchAndJoin(session) {
  await browser(session, ['find', 'role', 'button', 'click', '--name', 'Launch Quake']);
  await waitFor(async () => evaluate(session, 'window.quake?.ready && window.quake.state().signon === 4'), 'single-player startup', 60000);
  await browser(session, ['press', 'Escape']);
  await command(session, 'menu_multiplayer');
  await browser(session, ['find', 'role', 'button', 'click', '--name', await evaluate(session, "document.getElementById('join').textContent")]);
  await waitFor(async () => {
    const current = await state(session);
    return current.signon === 4 && !current.serverActive && current.map === 'maps/e1m1.bsp';
  }, 'co-op join', 60000);
  await command(session, 'god\nnotarget\ncrosshair 0');
}

await mkdir(artifactDir, { recursive: true });
try {
  if (publicUrl) {
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
    assert.equal((await fetch(`${url}/api/multiplayer/status`)).status, 404);
  } else {
    await new Promise((resolve, reject) => { const probe = portProbe(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => probe.close(resolve)); });
    server = spawn(process.execPath, ['web/server.mjs'], {
      cwd: project, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, QUAKE_WEB_PORT: String(port), QUAKE_MULTIPLAYER_PORT: String(quicPort), QUAKE_MULTIPLAYER_MODE: 'coop', QUAKE_MULTIPLAYER_MAP: 'e1m1', QUAKE_MULTIPLAYER_SKILL: '1' },
    });
    server.stdout.on('data', chunk => { serverOutput += chunk; });
    server.stderr.on('data', chunk => { serverOutput += chunk; });
    await waitFor(async () => (await status()).serverActive, 'dedicated server startup', 60000);
    assert.ok(!serverOutput.includes('missing its models'));
  }

  for (const session of [nick, ranger]) {
    await browser(session, ['open', url]);
    await browser(session, ['set', 'viewport', '1400', '1000']);
    await waitFor(async () => evaluate(session, 'document.querySelectorAll(".character-card").length === 3'), 'character cards');
  }
  await browser(nick, ['click', '.character-card:has(input[value="nick"])']);
  await browser(nick, ['reload']);
  await waitFor(async () => evaluate(nick, `document.getElementById('character').value === 'nick' &&
    document.querySelector('.character-card input[value="nick"]').checked`), 'remembered choice after reload');
  await browser(nick, ['screenshot', path.join(artifactDir, 'launch-screen.png')]);
  assert.equal(await evaluate(ranger, "document.getElementById('character').value"), 'ranger');
  await browser(ranger, ['click', '.character-card:has(input[value="chris"])']);
  await browser(ranger, ['reload']);
  await waitFor(async () => evaluate(ranger, `document.getElementById('character').value === 'chris' &&
    document.querySelector('.character-card input[value="chris"]').checked`), 'remembered Chris choice');
  passed('launch screen offers all three characters and remembers Nick and Chris');

  await launchAndJoin(nick);
  await launchAndJoin(ranger);
  assert.equal((await state(nick)).character, 'nick');
  assert.equal((await state(ranger)).character, 'chris');
  const players = await waitFor(async () => {
    const list = publicUrl ? (await state(nick)).players : (await status()).players;
    return list.length === 2 ? list : false;
  }, 'two players on the server');
  if (publicUrl) {
    evidence.clients = players.map(player => ({ slot: player.slot, model: player.model }));
    passed('both character clients complete public multiplayer sign-on');
  } else {
    evidence.server = players.map(player => ({ slot: player.slot, character: player.character }));
    assert.deepEqual(evidence.server, [{ slot: 1, character: 'nick' }, { slot: 2, character: 'chris' }]);
    passed('server records each player\'s character during sign-on');
  }

  await command(nick, 'color 1 6\nsetpos 480 200 24 0 270 0');
  await command(ranger, 'setpos 480 140 24 4 90 0');
  await waitFor(async () => (await seen(ranger, 1)) === NICK_MODEL, 'Ranger sees Nick');
  await waitFor(async () => (await seen(nick, 2)) === 'characters/chris/player.mdl', 'Nick sees Chris');
  await delay(1000);
  await shot(ranger, 'nick-seen-by-player-2.png');
  await shot(nick, 'chris-seen-by-player-1.png');
  await command(nick, 'scr_sbarscale 3');
  await delay(500);
  await shot(nick, 'nick-hud.png');
  passed('the other player sees Nick, and Nick sees Chris');

  // Review both sides through the actual renderer, with the viewing player
  // zoomed onto the head. Keep these images alongside the frontal comparison.
  for (const [subject, viewer, character, y, facing] of [[nick, ranger, 'nick', 200, 270], [ranger, nick, 'chris', 140, 90]]) {
    await command(viewer, 'fov 35\nr_drawviewmodel 0');
    for (const [angle, side] of [[0, 'right'], [180, 'left']]) {
      await command(subject, `setpos 480 ${y} 24 0 ${angle} 0`);
      await delay(400);
      await shot(viewer, `${character}-profile-${side}.png`);
    }
    await command(subject, `setpos 480 ${y} 24 0 ${facing} 0`);
    await command(viewer, 'fov 90\nr_drawviewmodel 1');
  }
  passed('both sides of Nick and Chris render with the profile textures');

  // Inspect the actual collar join from every direction and from below. The
  // neck fills the frame, rather than being a few pixels in a full-body view.
  for (const [subject, viewer, character, sy, cy] of [[nick,ranger,'nick',200,140],[ranger,nick,'chris',140,200]]) {
    const yaw = cy < sy ? 90 : 270;
    await command(viewer, 'noclip 1\nfov 20\nr_drawviewmodel 0\nv_centerspeed 0\ngl_polyblend 0\nv_kicktime 0\nv_kickroll 0\nv_kickpitch 0');
    for (const [height,label] of [[24,'level'],[8,'below'],[42,'above']]) {
      const pitch=Math.atan2(height+22-42,60)*180/Math.PI;
      await command(viewer, `setpos 480 ${cy} ${height} ${pitch} ${yaw} 0`);
      await delay(250);
      const camera = await state(viewer);
      evidence[`${character}-${label}-camera`] = { origin: camera.origin, angles: camera.angles, requested: pitch };
      // Server angles are quantized to 360 / 256 degrees.
      assert.ok(Math.abs(camera.angles[0] - pitch) < 0.75, 'close-up camera must retain its requested elevation');
      for (const angle of [0,45,90,135,180,225,270,315]) {
        await command(subject, `setpos 480 ${sy} 24 0 ${angle} 0`);
        await delay(200);
        await shot(viewer, `${character}-neck-${label}-${angle}.png`);
      }
    }
    await command(viewer, `setpos 480 ${cy} 24 4 ${yaw} 0`);
    await command(subject, 'give s 100\nimpulse 2');
    await delay(350);
    const initialAmmo = (await state(subject)).ammo;
    for (const angle of [0,90,180,270]) {
      await command(subject, `setpos 480 ${sy} 24 0 ${angle} 0\n+attack`);
      for (let frame = 0; frame < 3; frame++) {
        await delay(120);
        await shot(viewer, `${character}-neck-attack-${angle}-${frame}.png`);
      }
      await command(subject, '-attack');
    }
    const shotsFired = initialAmmo - (await state(subject)).ammo;
    evidence[`${character}-firing-review`] = { shotsFired, angles: [0, 90, 180, 270], screenshots: 12 };
    assert.ok(shotsFired >= 6, 'moving review must exercise the real firing animation');
    assert.equal((await state(viewer)).health, 100, 'reviewing fire must leave the viewing player invulnerable');
    await command(viewer, `setpos 480 ${cy} 24 4 ${yaw} 0\nfov 90\nnoclip 0\nr_drawviewmodel 1`);
    await command(subject, `setpos 480 ${sy} 24 0 ${cy<sy?270:90} 0`);
  }
  passed('neck and collar close-ups cover the full turn, three elevations and firing animations');

  for (const scale of [1, 2, 3]) await checkHudPortrait(scale);
  for (const scale of [1, 2, 3]) await checkHudPortrait(scale, ranger, 'chris');
  passed('the complete portrait fits its HUD slot at every status-bar scale');

  await command(nick, 'menu_options');
  await browser(nick, ['select', '#character', 'ranger']);
  await waitFor(async () => (await seen(ranger, 1)) === 'progs/player.mdl', 'switch to the Ranger reaches the other player');
  await browser(nick, ['select', '#character', 'nick']);
  await command(nick, 'web_menu_close');
  await waitFor(async () => (await seen(ranger, 1)) === NICK_MODEL, 'switch back to Nick reaches the other player');
  passed('changing character mid-game updates what other players see');

  await command(ranger, 'menu_options');
  await browser(ranger, ['select', '#character', 'ranger']);
  await waitFor(async () => (await seen(nick, 2)) === 'progs/player.mdl', 'Chris switches to Ranger');
  await browser(ranger, ['select', '#character', 'chris']);
  await command(ranger, 'web_menu_close');
  await waitFor(async () => (await seen(nick, 2)) === 'characters/chris/player.mdl', 'Ranger switches back to Chris');
  assert.equal((await state(ranger)).character, 'chris');
  passed('Chris can switch to Ranger and back during multiplayer');

  // QuakeC's suicide respawns at once; in co-op the body is copied to the corpse queue.
  await command(nick, 'kill');
  const corpse = await waitFor(async () => (await evaluate(ranger, 'window.quake.world().actors')).find(actor => actor.model === NICK_MODEL), 'Nick\'s corpse replicated as Nick');
  evidence.corpse = corpse;
  passed('a dead Nick leaves a Nick corpse after respawning');

  // Return Nick to the viewing position after his respawn, then kill Chris.
  await command(nick, 'setpos 480 200 24 0 270 0');
  await command(ranger, 'kill');
  evidence.chrisCorpse = await waitFor(async () => (await evaluate(nick, 'window.quake.world().actors'))
    .find(actor => actor.model === 'characters/chris/player.mdl'), 'Chris corpse keeps his model');
  passed('a dead Chris leaves a Chris corpse after respawning');

  for (const session of [nick, ranger]) {
    const result = await evaluate(session, '({errors: window.__quakeErrors, log: window.quake.logs})');
    assert.deepEqual(result.errors, []);
    assert.ok(!result.log.some(line => /Missing characters\/|Image_LoadPNG/.test(line)), 'no missing character files');
  }
  passed('no browser errors or missing character files');
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  for (const session of [nick, ranger]) await browser(session, ['close']).catch(() => {});
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  await writeFile(path.join(artifactDir, 'characters-evidence.json'), JSON.stringify({ checks, evidence, failure: failure?.message }, null, 2));
  await writeFile(path.join(artifactDir, 'server.log'), serverOutput);
}
if (failure) process.exit(1);
console.log(`${checks.length} character checks passed`);
