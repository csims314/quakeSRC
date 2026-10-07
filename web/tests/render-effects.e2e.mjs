// Real engine, real GPU rendering, pixel comparisons and GL resource checks.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzlibSync } from 'fflate';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.QUAKE_TEST_WEB_PORT || 3111);
const url = process.env.QUAKE_TEST_RENDER_URL || `http://127.0.0.1:${port}`;
const artifacts = path.join(project, 'web/test-artifacts');
const native = path.join(path.dirname(process.execPath), 'node_modules/agent-browser/bin/agent-browser-win32-x64.exe');
const cli = process.env.AGENT_BROWSER_BIN || (process.platform === 'win32' && existsSync(native) ? native : 'agent-browser');
const session = `quake-render-test-${process.pid}`;
let server, serverOutput = '', failure;
const checks = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
function browser(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ['--session', session, '--json', ...args], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    let out = '', err = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Browser timeout: ${args}`)); }, 45000);
    child.stdout.on('data', chunk => out += chunk); child.stderr.on('data', chunk => err += chunk);
    child.on('error', reject);
    child.on('exit', code => {
      clearTimeout(timeout); child.stdout.destroy(); child.stderr.destroy();
      try { const result=JSON.parse(out.trim()); if(code || !result.success) throw new Error(result.error || err); resolve(result.data); }
      catch(error) { reject(new Error(`${args}: ${error.message}; ${err}`)); }
    }); child.stdin.end(input);
  });
}
async function evaluate(code) { return (await browser(['eval','--stdin'],code)).result; }
async function state() { return evaluate('window.quake?.ready ? window.quake.state() : null'); }
async function waitFor(fn,label,timeout=45000) {
  const end=Date.now()+timeout;let last;
  do { try { last=await fn();if(last)return last; } catch(error) { last=error.message; } await delay(150); } while(Date.now()<end);
  throw new Error(`Timed out: ${label}; ${JSON.stringify(last)}`);
}
async function command(text) {
  await evaluate(`window.quake.command(${JSON.stringify(text)});true`);
  await delay(350);
}
function passed(label) { checks.push(label); console.log(`PASS ${label}`); }

// Chromium PNGs are lossless RGB/RGBA; decode them without a native dependency.
function png(bytes) {
  let width,height,channels,compressed=[];
  for(let offset=8;offset<bytes.length;) {
    const size=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+size);
    if(type==='IHDR') { width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);channels=data[9]===2?3:data[9]===6?4:0;assert.ok(channels);assert.equal(data[12],0); }
    if(type==='IDAT')compressed.push(data);offset+=size+12;
  }
  const packed=unzlibSync(Buffer.concat(compressed)),stride=width*channels,pixels=new Uint8Array(stride*height);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++) {
    const filter=packed[y*(stride+1)];
    for(let x=0;x<stride;x++) {
      const i=y*stride+x,left=x>=channels?pixels[i-channels]:0,up=y?pixels[i-stride]:0,corner=y&&x>=channels?pixels[i-stride-channels]:0;
      const add=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,corner);
      pixels[i]=(packed[y*(stride+1)+x+1]+add)&255;
    }
  }
  return {width,height,channels,pixels};
}
async function capture(name) {
  const filename=path.join(artifacts,`${name}.png`);await browser(['screenshot','#canvas',filename]);
  const image=png(await readFile(filename));let brightness=0;const colors=new Set();
  for(let i=0;i<image.pixels.length;i+=image.channels)brightness+=image.pixels[i]+image.pixels[i+1]+image.pixels[i+2];
  assert.ok(brightness/(image.width*image.height*3)>5,`${name}: rendered image must not be black`);
  for(let i=0;i<image.pixels.length;i+=image.channels*13)colors.add((image.pixels[i]<<16)|(image.pixels[i+1]<<8)|image.pixels[i+2]);
  assert.ok(colors.size>150,`${name}: rendered geometry must survive compositing`);
  return image;
}
function difference(a,b,crop=[0,0,1,1]) {
  assert.equal(a.width,b.width);assert.equal(a.height,b.height);let sum=0,count=0;
  for(let y=Math.floor(a.height*crop[1]);y<Math.floor(a.height*crop[3]);y++)for(let x=Math.floor(a.width*crop[0]);x<Math.floor(a.width*crop[2]);x++) {
    for(let c=0;c<3;c++)sum+=Math.abs(a.pixels[(y*a.width+x)*a.channels+c]-b.pixels[(y*b.width+x)*b.channels+c]);count+=3;
  }
  return sum/count;
}

await mkdir(artifacts,{recursive:true});
try {
  if(!process.env.QUAKE_TEST_RENDER_URL) {
    server=spawn(process.execPath,['web/server.mjs'],{cwd:project,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,QUAKE_WEB_PORT:String(port),QUAKE_MULTIPLAYER_PORT:'4451'}});
    server.stdout.on('data',chunk=>serverOutput+=chunk);server.stderr.on('data',chunk=>serverOutput+=chunk);
  }
  await waitFor(async()=> (await fetch(`${url}/healthz`)).ok,'server ready');
  await browser(['open',url]);
  await browser(['set','viewport','1360','1000']);
  await evaluate(`(() => {
    window.renderResources={framebuffers:new Set()};
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      const gl=original.call(this,type,...args);if(!gl||!type.includes('webgl')||window.renderGL)return gl;
      window.renderGL=gl;
      const create=gl.createFramebuffer.bind(gl),destroy=gl.deleteFramebuffer.bind(gl);
      gl.createFramebuffer=()=>{const fb=create();window.renderResources.framebuffers.add(fb);return fb;};
      gl.deleteFramebuffer=fb=>{window.renderResources.framebuffers.delete(fb);destroy(fb);};return gl;
    };return true;
  })()`);
  await browser(['find','role','button','click','--name','Launch Quake']);
  await waitFor(async()=> (await state())?.signon===4,'stock start map');
  assert.equal((await state()).map,'start');
  assert.equal((await state()).renderEffects.fogPasses,0,'fog must be disabled at launch');
  assert.ok(Math.abs(((await state()).angles[1] + 360) % 360 - 270) < 1, 'new players must face the mirror');
  await waitFor(async()=> (await state())?.renderEffects.mirrorPasses===1,'mirror visible at spawn');
  await evaluate("document.getElementById('capture').hidden=true;true");
  await capture('mirror-facing-spawn');
  await command('character nick\nr_drawviewmodel 0\nfov 35');const nickMirror=await capture('nick-neck-mirror');
  await command('character chris');const chrisMirror=await capture('chris-neck-mirror');
  assert.ok(difference(nickMirror,chrisMirror,[.3,.15,.7,.7])>0.3,'both custom heads must appear in the mirror');
  await command('kill');
  await command('+attack');await delay(500);await command('-attack');
  await waitFor(async()=> (await state())?.health>0,'mirror-facing respawn');
  assert.ok(Math.abs(((await state()).angles[1] + 360) % 360 - 270) < 1, 'respawn must face the mirror');
  await command('character ranger\nr_drawviewmodel 1\nfov 90');
  passed('players spawn and respawn facing the mirror; Nick and Chris reflect their tapered necks');
  await command('setpos 544 288 28 0 270 0\nviewsize 110\ngamma 1\nr_mirrors 1');
  await evaluate("document.getElementById('capture').hidden=true;true");
  const mirror=await capture('planar-mirror');
  assert.equal((await state()).renderEffects.mirrorPasses,1);
  await command('r_mirrors 0');const plain=await capture('mirror-disabled');
  assert.equal((await state()).renderEffects.mirrorPasses,0);
  assert.ok(difference(mirror,plain,[.3,.1,.7,.85])>2,'live reflection must change the glass pixels');
  passed('live planar reflection changes the glass; disabling it removes the extra pass');
  await command('r_mirrors 1\ncolor 4 12');const colored=await capture('mirror-player-colors');
  assert.ok(difference(mirror,colored,[.42,.38,.58,.70])>.5,'Ranger skin colors must appear in the reflection');
  passed('Ranger is visible in the mirror and reflects changed player colors');

  // The same opaque panel should receive less fog when it is closer.
  await command('r_mirrors 0\nr_vfog 0');const farClear=await capture('fog-depth-far-clear');
  await command('r_vfog 1\nr_vfog_density 0.3');const farFog=await capture('fog-depth-far');
  await command('setpos 544 240 24 0 270 0\nr_vfog 0');const nearClear=await capture('fog-depth-near-clear');
  await command('r_vfog 1');const nearFog=await capture('fog-depth-near');
  const center=[.42,.32,.58,.55];
  assert.ok(difference(nearClear,nearFog,center)<difference(farClear,farFog,center)*.7,'fog must stop at the nearest opaque surface');
  passed('fog thickness follows surface depth rather than a flat screen overlay');
  await command('setpos 544 288 28 0 270 0\nr_mirrors 1');

  await command('r_vfog 1\nr_vfog_density 0.3');const fog=await capture('volumetric-mirror');
  assert.equal((await state()).renderEffects.fogPasses,2);
  assert.equal((await state()).renderEffects.fogSteps,48);
  assert.ok(difference(fog,colored)>1,'volumetric scattering must alter the scene');
  passed('depth-aware fog changes real pixels in both main and reflected views');
  const live=await evaluate('window.renderResources.framebuffers.size');
  for(const [quality,steps] of [[1,24],[3,64],[2,48]]) {
    await command(`r_vfog_quality ${quality}`);assert.equal((await state()).renderEffects.fogSteps,steps);
    await capture(`fog-quality-${quality}`);
  }
  await command('gamma 0.8');await capture('volumetric-gamma');
  await command('r_scale 2');await capture('volumetric-scaled');
  await command('r_scale 1\nr_mirror_maxsize 512');
  assert.equal(Math.max(...(await state()).renderEffects.mirrorSize),512);
  await command('vid_unlock\nvid_width 960\nvid_height 540\nvid_restart');
  await capture('volumetric-resized');
  assert.ok(await evaluate('window.renderResources.framebuffers.size')<=live+3,'resizing must not leak reflection/fog framebuffers');
  passed('quality presets, gamma, render scaling, resolution cap and video resize render correctly');

  await command('setpos 544 288 28 0 90 0');assert.equal((await state()).renderEffects.mirrorPasses,0);
  await command('r_vfog_density 0');assert.equal((await state()).renderEffects.fogPasses,0);
  await command('map e1m1');await waitFor(async()=> (await state())?.map==='e1m1','ordinary map');
  assert.equal((await state()).renderEffects.mirrorPlaced,0);await capture('ordinary-map');
  await command('map start');await waitFor(async()=> (await state())?.map==='start','return to start');
  await command('setpos 544 288 28 0 270 0\nr_vfog_density -1\nr_mirror_maxsize 2048');
  assert.equal((await state()).renderEffects.mirrorPlaced,1);
  await command('fog 0.1 0.2 0.3 0.4 0.5');assert.equal((await state()).renderEffects.fogPasses,2);
  await command('fog 0');assert.equal((await state()).renderEffects.fogPasses,0);
  passed('offscreen mirrors, density zero, map reloads and original fog commands behave correctly');
  await command('map start\nr_vfog 0\nr_vfog_density -1\nr_vfog_quality 2\ngamma 1\nviewsize 100');
  await command('setpos 544 288 28 0 270 0');
  const gl=await evaluate(`(async()=>{const g=window.renderGL;g.getError();await new Promise(r=>setTimeout(r,350));return {error:g.getError(),lost:g.isContextLost(),framebuffers:window.renderResources.framebuffers.size};})()`);
  assert.equal(gl.error,0);assert.equal(gl.lost,false);
  const bad=await evaluate("window.quake.logs.filter(x=>/Render effects:|shader.*failed|gl_programs overflow/i.test(x))");assert.deepEqual(bad,[]);
  await capture('spawn-mirror-fog-disabled');
  passed('no GL errors, lost context, effect fallback warnings or shader failures');
  const renderedState=await state();

  // The launcher must override the archived value from the previous build.
  await evaluate(`(async()=>{
    const q=window.quake,filename='/user/id1/config.cfg';
    const config=q.fs.readFile(filename,{encoding:'utf8'});
    q.fs.writeFile(filename,config+'\\nr_vfog "1"\\n');await q.sync();return true;
  })()`);
  await browser(['open',url]);
  await browser(['find','role','button','click','--name','Launch Quake']);
  await waitFor(async()=> (await state())?.signon===4,'reload with old fog preferences');
  assert.equal((await state()).renderEffects.fogPasses,0);
  await command('r_vfog');
  const fogSetting=await evaluate('window.quake.logs.filter(x=>x.includes("\\"r_vfog\\" is")).at(-1)');
  assert.match(fogSetting,/"r_vfog" is "0"/);
  passed('fog stays disabled when reopening an older saved configuration');

  // Exercise the GLES fallback without requiring a different physical GPU.
  await browser(['open',url]);
  await evaluate(`(() => {
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      const g=original.call(this,type,...args);if(!g||!type.includes('webgl')||window.noDepthGL)return g;
      window.noDepthGL=g;const get=g.getExtension.bind(g),list=g.getSupportedExtensions.bind(g);
      g.getExtension=name=>/depth_texture/i.test(name)?null:get(name);
      g.getSupportedExtensions=()=>list().filter(name=>!/depth_texture/i.test(name));return g;
    };return true;
  })()`);
  await browser(['find','role','button','click','--name','Launch Quake']);
  await waitFor(async()=> (await state())?.signon===4,'fallback game launch');
  await command('setpos 544 288 28 0 270 0\nr_vfog 1\nr_mirrors 1\ngamma 1');
  await evaluate("document.getElementById('capture').hidden=true;true");
  assert.equal((await state()).renderEffects.fogPasses,0);
  assert.equal((await state()).renderEffects.fogAvailable,0);
  assert.equal((await state()).renderEffects.mirrorPasses,1);
  await capture('depth-texture-fallback');
  passed('missing depth-texture support preserves gameplay and the live mirror');
  await writeFile(path.join(artifacts,'render-effects-result.json'),JSON.stringify({checks,gl,state:renderedState,fallback:await state()},null,2));
} catch(error) {
  failure=error;console.error(error.stack);
  await writeFile(path.join(artifacts,'render-effects-failure.json'),JSON.stringify({error:error.stack,serverOutput,state:await state().catch(()=>null),logs:await evaluate('window.quake?.logs').catch(()=>null)},null,2));
} finally {
  await browser(['close']).catch(()=>{});server?.kill();
}
if(failure)process.exitCode=1;
