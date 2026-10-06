$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$linuxProject = (wsl.exe -d ModelGenTrellis --exec wslpath -a $project).Trim()
if ($LASTEXITCODE -ne 0) { throw 'WSL path conversion failed.' }
wsl.exe -d ModelGenTrellis --exec bash "$linuxProject/tools/build-web.sh"
if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
