$ErrorActionPreference = 'Stop'
$launchRoot = Split-Path -Parent $PSScriptRoot
$launchKeyPath = Join-Path $launchRoot '.pilot-runs\launch-rehearsal\owner-key.txt'
if (-not (Test-Path -LiteralPath $launchKeyPath)) { throw 'Start the local launch server first: node launch-rehearsal/server.mjs' }
$launchOwnerKey = (Get-Content -LiteralPath $launchKeyPath -Raw).Trim()
$launchControlUrl = 'http://127.0.0.1:4390/__launch/control#' + $launchOwnerKey
Start-Process -FilePath 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList @('--new-tab', $launchControlUrl) -WindowStyle Hidden
