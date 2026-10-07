# Planar reflections and volumetric fog

## Plan

1. Add a clear planar mirror in a beveled gunmetal frame on the stock `start`
   map's north-facing wall directly behind the player spawn. The glass is at
   y=192.5, x=480–608, z=8–80, with the frame reaching the floor. Validate the
   supporting BSP faces; leave map assets, collision and triggers intact.
2. Render a reflected camera into a texture with reversed winding, oblique
   clipping and independent visibility. Include Ranger's colored world model;
   exclude the first-person gun, HUD and recursive mirrors. Keep simulation,
   interpolation and light-style updates independent of the number of views.
3. Replace the empty volumetric-fog stubs with bounded, depth-aware ray marching.
   Build a padded 3D lighting atlas from map lights, tracing the BSP to shadow
   their scattering. Add height falloff and coherent density variation.
4. Integrate extinction and in-scattering front to back using Beer–Lambert
   transmittance. March at half resolution by default and use a depth-aware
   bilateral upsample. Offer lower and higher quality presets; avoid temporal
   history so camera movement cannot leave trails.
5. Provide opt-in subtle warm-gray fog for the stock spawn and difficulty hall.
   Fog is disabled for now. Other maps use their
   existing fog settings or explicit worldspawn volume settings. Integrate the
   mirror's fog from its plane to the reflected object, then the main view's fog
   from the camera to the glass. Draw the first-person gun and HUD afterward.
6. Detect framebuffer/depth-texture support and fall back to classic fog and a
   dark mirror panel on unsupported hardware. Reuse targets, restore GL state,
   and clean up resources on video resets and map changes.
7. Verify real browser rendering, reflected player motion/colors, clipping,
   fog occlusion, resizing, toggles, map changes and multiplayer regressions.

## Controls

| Console setting | Default | Meaning |
| --- | --- | --- |
| `r_mirrors` | `1` | Live planar reflections. |
| `r_mirror_maxsize` | `2048` | Maximum reflection target dimension. |
| `r_vfog` | `0` | Volumetric fog is disabled for now; `1` enables it. `0` uses the original fog renderer. |
| `r_vfog_quality` | `2` | `1`: 24 samples at half resolution; `2`: 48 samples at half resolution; `3`: 64 samples at full resolution. |
| `r_vfog_density` | `-1` | Use the map profile; nonnegative values override its density (`0` removes volumetric fog). |

The browser launcher applies `r_vfog 0` after loading saved configuration, so
previous settings cannot turn it back on at launch. You can opt in during play
with `r_vfog 1`. The stock `start` map has no classic fog.

## Map authoring

The normal `fog` command, worldspawn `fog` key and server fog fades remain
supported. Optional worldspawn keys (a leading underscore is accepted):

- `volfog`: `density red green blue`; colors are in 0–1 and density uses the
  same scale as QuakeSpasm fog.
- `volfog_bounds`: `minX minY minZ maxX maxY maxZ`; defaults to world bounds.
- `volfog_height`: vertical falloff distance in Quake units; default 256.

Lights come from the BSP entity text, including colored `_color`/`color` lights
and torch/flame fixtures. The initial lighting atlas shadows against static
BSP geometry. Moving doors, actors and projectile lights do not cast volumetric
shadows in this version. This is a renderer effect and adds no network messages.

The stock `start` profile covers the spawn, difficulty hall and its approach.
The mirror is 95.5 units from the spawn, with glass starting 8 units above
the floor. Stock start-room player spawns face it at yaw 270, including
respawns and co-op starts, so the selected character is visible immediately. It is a
client-side decoration, with one reflection bounce.

## Verification and implementation notes

Run `npm run build:web`, `npm run test:render:math` and `npm run test:render`.
The browser check uses the real compiled engine and compares lossless pixels
for mirror toggling, Ranger's changed skin colors and fog. It also checks all
quality presets, gamma, render scaling, video resize, map changes, fog commands,
GL framebuffer lifetime and the missing-depth-texture fallback. Artifacts are
saved in `web/test-artifacts/`.

The WebAssembly build, render-math checks, the browser rendering checks,
30 unit tests, and the co-op and deathmatch browser suites passed locally.
The browser reported no GL errors or lost context. Native project files include
the new renderer source; native binaries have not been rebuilt or tested here.

The rendering path uses framebuffer objects and sampleable depth textures.
The browser driver adapter enables `WEBGL_depth_texture` and advertises its
GLES alias to GL4ES; the vendored GL4ES sources are unchanged. Fog uses a
padded 2D atlas rather than requiring WebGL 2's 3D textures. Missing depth
support preserves the original fog renderer while mirrors can still use a
depth renderbuffer. Stereo mode currently uses the original renderer.

Lighting is baked into the atlas on the first fog-enabled frame of a map.
Quality controls change ray integration and upsampling, rather than advancing
gameplay or altering multiplayer visibility. Console/server `fog` updates
override the map profile and preserve normal color/density fades.
