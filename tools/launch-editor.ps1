$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction Stop).Source
Push-Location $projectRoot
try {
    if (-not (Test-Path -LiteralPath 'node_modules\three\package.json')) {
        & npm.cmd ci --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    & $node tools/setup-editor.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Compiler setup failed.' }
    & $node tools/build-editor.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Editor build failed.' }
    & $node tools/setup-network.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Network setup failed.' }
    $port = if ($env:QUAKE_WEB_PORT) { [int]$env:QUAKE_WEB_PORT } else { 3000 }
    $scheme = if ($env:QUAKE_EDITOR_LAN -eq '1') { 'https' } else { 'http' }
    $hostname = if ($scheme -eq 'https') { 'localhost' } else { '127.0.0.1' }
    $url = "${scheme}://${hostname}:$port/editor/"
    $ready = $false
    try { $response = Invoke-RestMethod -Uri "${scheme}://${hostname}:$port/api/editor/config" -TimeoutSec 2; $ready = [bool]$response.token -and $response.editorVersion -eq 2 } catch {}
    if (-not $ready) {
        $existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($existing) {
            if ($env:QUAKE_WEB_PORT -or $env:QUAKE_EDITOR_LAN -eq '1') { throw "Port $port is in use by a server with different editor settings. Restart it, or set QUAKE_WEB_PORT to another port." }
            $port = 3001
            while (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { $port++ }
            if ($port -gt 3010) { throw 'No free editor port between 3001 and 3010. Set QUAKE_WEB_PORT.' }
            $env:QUAKE_WEB_PORT = [string]$port
            $url = "${scheme}://${hostname}:$port/editor/"
            Write-Host "Keeping your existing server running; editor will use port $port."
            if (-not $env:QUAKE_MULTIPLAYER_PORT) {
                $gamePort = 4453
                while (Get-NetUDPEndpoint -LocalPort $gamePort -ErrorAction SilentlyContinue) { $gamePort++ }
                if ($gamePort -gt 4463) { throw 'Set an unused QUAKE_MULTIPLAYER_PORT for the editor server.' }
                $env:QUAKE_MULTIPLAYER_PORT = [string]$gamePort
            }
        }
        $serverScript = Join-Path $projectRoot 'web\server.mjs'
        $proc = Start-Process -FilePath $node -ArgumentList @('"' + $serverScript + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $projectRoot 'web\editor.stdout.log') -RedirectStandardError (Join-Path $projectRoot 'web\editor.stderr.log')
        $proc.Id | Set-Content (Join-Path $projectRoot 'web\editor.pid')
        for ($attempt = 0; $attempt -lt 80; $attempt++) {
            try { $response = Invoke-RestMethod -Uri "${scheme}://${hostname}:$port/api/editor/config" -TimeoutSec 1; if ($response.token) { $ready = $true; break } } catch {}
            if ($proc.HasExited) { break }
            Start-Sleep -Milliseconds 250
        }
        if (-not $ready) {
            if (-not $proc.HasExited) { Stop-Process -Id $proc.Id }
            throw 'Editor server did not start. See web/editor.stderr.log.'
        }
    }
    Start-Process $url
    Write-Host "Editor ready: $url"
} finally { Pop-Location }
