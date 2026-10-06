$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$port = if ($env:QUAKE_WEB_PORT) { [int]$env:QUAKE_WEB_PORT } else { 3000 }
$url = "http://127.0.0.1:$port"
$node = (Get-Command node.exe -ErrorAction Stop).Source
$serverScript = Join-Path $projectRoot 'web\server.mjs'
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'web\dist\engine\quakespasm.wasm'))) {
    throw 'Web engine is missing. Run build-web.cmd first.'
}
function Test-QuakeServer {
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
        $network = Invoke-RestMethod -Uri "$url/api/multiplayer" -TimeoutSec 1
        return $response.Content.Contains('<title>Quake') -and $network.available -and $network.transport -eq 'webtransport'
    } catch { return $false }
}
if (-not (Test-QuakeServer)) {
    # Restart only the project's tracked server when upgrading an older build.
    $pidFile = Join-Path $projectRoot 'web\server.pid'
    if (Test-Path -LiteralPath $pidFile) {
        $trackedId = 0
        if ([int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$trackedId)) {
            $tracked = Get-CimInstance Win32_Process -Filter "ProcessId = $trackedId"
            if ($tracked.Name -eq 'node.exe' -and $tracked.CommandLine.Contains($serverScript)) {
                Stop-Process -Id $trackedId
                Start-Sleep -Milliseconds 300
            }
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\@fails-components\webtransport\package.json'))) {
        Push-Location $projectRoot
        try {
            & npm.cmd ci --ignore-scripts
            if ($LASTEXITCODE -ne 0) { throw 'Could not install multiplayer dependencies.' }
        } finally { Pop-Location }
    }
    & $node (Join-Path $projectRoot 'tools\setup-network.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'WebTransport native setup failed.' }
    $proc = Start-Process -FilePath $node -ArgumentList @('"' + $serverScript + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $projectRoot 'web\server.stdout.log') -RedirectStandardError (Join-Path $projectRoot 'web\server.stderr.log')
    $proc.Id | Set-Content (Join-Path $projectRoot 'web\server.pid')
    $serverReady = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Test-QuakeServer) { $serverReady = $true; break }
        if ($proc.HasExited) { break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $serverReady) { throw 'Could not start the local Quake server. See web/server.stderr.log.' }
}
Start-Process $url
Write-Host "Quake is ready at $url"
