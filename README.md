# Local QuakeSpasm setup

For the browser version, double-click `launch-web.cmd`. It supports local single player and WebTransport multiplayer. Click **Join co-op** after launching to fight the original monsters with up to eight players; other browsers or tabs can join the same server. See [web/README.md](web/README.md) for controls, saves, difficulty, deathmatch, and rebuild instructions. The native version is still available through `launch.cmd`.

Double-click `launch.cmd` to play. From PowerShell you can also run:

```powershell
.\launch.cmd
```

## Game data

The free Quake 1.06 shareware episode is installed in `runtime/id1/pak0.pak`, so you can play now. Its original license and documentation are in `runtime/shareware-docs/`.

To play the full original campaign, copy `pak0.pak` and `pak1.pak` from the `id1` directory of your purchased original Quake installation into `runtime/id1/`, replacing the shareware PAK when prompted. The commercial game data is not included.

For the original soundtrack, copy your music files into `runtime/id1/music/`, using names such as `track02.ogg`. See `source/Quakespasm-Music.txt` for details.

## Layout

- `source/`: vendored QuakeSpasm engine source and GPL license, including the browser changes tracked in this project's repository.
- `runtime/`: official Windows x64 engine distribution, DLLs, documentation, and your local game data.
- `downloads/`: original runtime archive.
- `launch.cmd` / `launch.ps1`: launch from this project's runtime directory and forward engine arguments.

The runtime uses the official website's Windows x64 download, version 0.96.3. Its archive SHA-256 is `ea041cb535cd38fba0bc0b5668da6c8a605b187067606c4da1d9644a13b19b5d`.

Source was cloned from https://github.com/sezero/quakespasm at commit `c9c8ee9895961669c4674e8f8ca8c64cc43e38b5`. The development source is newer than the packaged runtime; editing it does not change the downloaded executable.

## Engine development

Public co-op deployment is prepared in [deploy/README.md](deploy/README.md). The source repository includes the complete engine source used to build the browser and server. Downloaded SDKs, game PAKs, and certificate keys are excluded from Git.

Open `source/Windows/VisualStudio/quakespasm.sln` in Visual Studio with the C++ desktop development tools installed. Use the SDL2 project and `Release | x64` configuration. The source also includes MinGW makefiles. Build instructions are in `source/Quakespasm.txt`.

After building, replace the runtime executable with your build and use compatible dependency DLLs. The runtime installed here is the prebuilt distribution, not a local compilation.

## Verification

The engine archive matched the publisher's SHA-256. The shareware archive and extracted PAK matched the checksums recorded in Debian's game-data-packager:

- `quake106.zip` MD5: `8cee4d03ee092909fdb6a4f84f0c1357`
- `pak0.pak` SHA-256: `35a9c55e5e5a284a159ad2a62e0e8def23d829561fe2f54eb402dbc0a9a946af`

A runtime check initialized the Intel OpenGL renderer, loaded the original `demo1` recording and The Necropolis map, and processed gameplay events. The interactive game was then launched with sound enabled. Press Escape and choose Single Player / New Game to play.

## Sources

- https://quakespasm.sourceforge.net/download.htm
- https://quakespasm.sourceforge.net/Quakespasm.html
- https://github.com/sezero/quakespasm
- https://ftp.gwdg.de/pub/misc/ftp.idsoftware.com/idstuff/quake/quake106.zip
- https://sources.debian.org/src/game-data-packager/49.1/data/quake.yaml/
