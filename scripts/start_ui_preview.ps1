param()

$ErrorActionPreference = 'Stop'
$previewRoot = Split-Path -Parent $PSScriptRoot
$previewFrontend = Join-Path $previewRoot 'app\web_assessment_react'
$previewUrl = 'http://127.0.0.1:5173/assessment/?ui-preview=1'

function Test-PreviewReady {
    try {
        $previewResponse = Invoke-WebRequest -Uri $previewUrl -UseBasicParsing -TimeoutSec 2
        return $previewResponse.StatusCode -eq 200 -and $previewResponse.Content -match 'Valases Assessment Console'
    } catch {
        return $false
    }
}

if (Test-PreviewReady) {
    Write-Host "UI preview is already running: $previewUrl"
    exit 0
}

if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 5173 is occupied by another service. No process was stopped.'
}
if (-not (Test-Path -LiteralPath (Join-Path $previewFrontend 'node_modules\vite\bin\vite.js'))) {
    throw "Frontend dependencies are missing in $previewFrontend. Install them before starting the preview."
}

$previewNode = (Get-Command node.exe -ErrorAction Stop).Source
$previewLogDirectory = Join-Path $previewRoot 'logs\ui-preview'
New-Item -ItemType Directory -Path $previewLogDirectory -Force | Out-Null
$previewStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$previewStdout = Join-Path $previewLogDirectory "$previewStamp.stdout.log"
$previewStderr = Join-Path $previewLogDirectory "$previewStamp.stderr.log"
$previewProcess = Start-Process -FilePath $previewNode `
    -ArgumentList 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort' `
    -WorkingDirectory $previewFrontend -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $previewStdout -RedirectStandardError $previewStderr

$previewDeadline = [DateTime]::UtcNow.AddSeconds(30)
do {
    if (Test-PreviewReady) {
        Write-Host "UI preview is ready: $previewUrl"
        Write-Host "Sample data only. No backend or Supabase connection is needed."
        Write-Host "Server process: $($previewProcess.Id)"
        Write-Host "Logs: $previewLogDirectory"
        exit 0
    }
    $previewProcess.Refresh()
    if ($previewProcess.HasExited) {
        throw "The preview server exited. Inspect $previewStderr"
    }
    Start-Sleep -Milliseconds 500
} while ([DateTime]::UtcNow -lt $previewDeadline)

throw "The preview server did not become ready within 30 seconds. Inspect $previewStdout and $previewStderr"
