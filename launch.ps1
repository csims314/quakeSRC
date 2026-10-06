param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $EngineArguments
)

$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot 'runtime'
$engine = Join-Path $runtime 'quakespasm.exe'
$pak0 = Join-Path $runtime 'id1\pak0.pak'

if (-not (Test-Path -LiteralPath $engine)) {
    Write-Host 'QuakeSpasm runtime is missing. See README.md.'
    exit 1
}
if (-not (Test-Path -LiteralPath $pak0)) {
    Write-Host 'Quake game data is required.'
    Write-Host "Copy pak0.pak and pak1.pak from your purchased Quake id1 folder into:"
    Write-Host (Join-Path $runtime 'id1')
    Write-Host 'The shareware pak0.pak can run the first episode only.'
    exit 1
}

Push-Location $runtime
try {
    & $engine -basedir $runtime @EngineArguments
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
