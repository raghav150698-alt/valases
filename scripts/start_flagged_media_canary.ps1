[CmdletBinding()]
param(
    [ValidateRange(1, 30)]
    [int]$CandidatesPerEmployer = 10,

    [ValidateRange(1, 90)]
    [int]$Concurrency = 10,

    [ValidateRange(1, 100)]
    [int]$FlagPercent = 10,

    [ValidateRange(16, 12288)]
    [int]$ClipKilobytes = 256
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$sourceConfigPath = Join-Path $PSScriptRoot "product_fit_pilot.local.json"
$resultsDirectory = Join-Path $repositoryRoot ".pilot-runs"
$runId = "flagged-media-canary-sept-2026-v1"
$configPath = Join-Path $resultsDirectory "$runId.config.json"
$statePath = Join-Path $resultsDirectory "$runId.state.json"
$pilotRunner = Join-Path $PSScriptRoot "run_product_fit_pilot.py"
$loadRunner = Join-Path $PSScriptRoot "run_assessment_load_test.py"
$venvPython = Join-Path $repositoryRoot ".codex-run-venv\Scripts\python.exe"
$python = if (Test-Path -LiteralPath $venvPython) { $venvPython } else { "python" }

function Read-PlainTextPassword {
    param([Parameter(Mandatory = $true)][string]$Label)
    $secure = Read-Host "Password for $Label" -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Get-LocalApiHealth {
    try {
        return Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 3
    }
    catch {
        return $null
    }
}

function Ensure-LocalApi {
    $health = Get-LocalApiHealth
    if ($null -ne $health -and $health.status -eq "ok" -and $health.database -eq "ready") {
        return $health
    }

    $logDirectory = Join-Path $repositoryRoot "logs"
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $stdoutPath = Join-Path $logDirectory "flagged-media-canary-api.stdout.log"
    $stderrPath = Join-Path $logDirectory "flagged-media-canary-api.stderr.log"
    Write-Host "Local API is not running. Starting it in the background..." -ForegroundColor Cyan
    $apiProcess = Start-Process `
        -FilePath $python `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000") `
        -WorkingDirectory $repositoryRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru

    for ($attempt = 1; $attempt -le 45; $attempt++) {
        Start-Sleep -Seconds 1
        $health = Get-LocalApiHealth
        if ($null -ne $health -and $health.status -eq "ok" -and $health.database -eq "ready") {
            Write-Host "Local API is ready." -ForegroundColor Green
            return $health
        }
        if ($apiProcess.HasExited) { break }
    }

    $startupError = if (Test-Path -LiteralPath $stderrPath) {
        (Get-Content -LiteralPath $stderrPath -Tail 20) -join [Environment]::NewLine
    }
    else {
        "No API error log was produced."
    }
    throw "The local API could not be started. Review $stderrPath`n$startupError"
}

$credentialVariables = @(
    "VALASES_PILOT_SIMPLICON_EMAIL",
    "VALASES_PILOT_SIMPLICON_PASSWORD",
    "VALASES_PILOT_QX_GLOBAL_EMAIL",
    "VALASES_PILOT_QX_GLOBAL_PASSWORD",
    "VALASES_PILOT_EDUTRIP_EMAIL",
    "VALASES_PILOT_EDUTRIP_PASSWORD"
)

try {
    Set-Location -LiteralPath $repositoryRoot
    $health = Ensure-LocalApi
    if (-not (Test-Path -LiteralPath $sourceConfigPath)) {
        throw "Pilot configuration is missing: $sourceConfigPath"
    }

    New-Item -ItemType Directory -Path $resultsDirectory -Force | Out-Null
    if (-not (Test-Path -LiteralPath $configPath)) {
        $config = Get-Content -LiteralPath $sourceConfigPath -Raw | ConvertFrom-Json
        $config.run_id = $runId
        $config.candidate_count = $CandidatesPerEmployer
        $config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $configPath -Encoding utf8
    }
    else {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        if ([int]$config.candidate_count -ne $CandidatesPerEmployer) {
            throw "This resumable canary was created for $($config.candidate_count) candidates per employer. Re-run with that value."
        }
    }

    $total = $CandidatesPerEmployer * 3
    $flaggedPerEmployer = [Math]::Ceiling($CandidatesPerEmployer * $FlagPercent / 100)
    $expectedFlagged = $flaggedPerEmployer * 3
    $expectedClips = $expectedFlagged * 2
    Write-Host ""
    Write-Host "Valases flagged-media canary" -ForegroundColor Green
    Write-Host "Fresh candidates: $total ($CandidatesPerEmployer per employer)"
    Write-Host "Concurrent assessment sessions: $Concurrency"
    Write-Host "Expected flagged sessions: approximately $expectedFlagged"
    Write-Host "Expected retained clips: approximately $expectedClips (camera + screen)"
    Write-Host "Clip payload: $ClipKilobytes KB each, six-second duration metadata"
    Write-Host "Candidate email and AI grading are disabled." -ForegroundColor Yellow
    Write-Host "No full-session recording is uploaded or retained." -ForegroundColor Yellow
    $confirmation = Read-Host "Type MEDIA $total to continue"
    if ($confirmation -cne "MEDIA $total") { throw "Flagged-media canary cancelled." }

    $env:VALASES_PILOT_SIMPLICON_EMAIL = "raghav150698@gmail.com"
    $env:VALASES_PILOT_QX_GLOBAL_EMAIL = "qxcommute@gmail.com"
    $env:VALASES_PILOT_EDUTRIP_EMAIL = "founders@edutripindia.com"
    $env:VALASES_PILOT_SIMPLICON_PASSWORD = Read-PlainTextPassword "Simplicon (raghav150698@gmail.com)"
    $env:VALASES_PILOT_QX_GLOBAL_PASSWORD = Read-PlainTextPassword "QX Global (qxcommute@gmail.com)"
    $env:VALASES_PILOT_EDUTRIP_PASSWORD = Read-PlainTextPassword "Edutrip (founders@edutripindia.com)"

    Write-Host ""
    Write-Host "Stage 1/3: creating and screening the fresh candidate batch..." -ForegroundColor Cyan
    & $python $pilotRunner --config $configPath --phase safe --candidate-count $CandidatesPerEmployer
    if ($LASTEXITCODE -ne 0) { throw "Candidate preparation failed. Keep the report and trace for diagnosis." }

    Write-Host ""
    Write-Host "Stage 2/3: issuing assessments without email..." -ForegroundColor Cyan
    & $python $pilotRunner `
        --config $configPath `
        --phase assessments `
        --candidate-count $CandidatesPerEmployer `
        --assessment-invites-per-employer $CandidatesPerEmployer `
        --confirm-assessment-invites $total `
        --suppress-assessment-email
    if ($LASTEXITCODE -ne 0) { throw "Assessment issuing failed. Keep the report and trace for diagnosis." }

    Write-Host ""
    Write-Host "Stage 3/3: running concurrent assessments and flagged clip uploads..." -ForegroundColor Cyan
    & $python $loadRunner `
        --config $configPath `
        --state $statePath `
        --candidates-per-employer $CandidatesPerEmployer `
        --concurrency $Concurrency `
        --autosaves 2 `
        --flag-percent $FlagPercent `
        --clip-bytes ($ClipKilobytes * 1024)
    if ($LASTEXITCODE -ne 0) { throw "Media canary completed with failures. Keep the report and trace for diagnosis." }

    Write-Host ""
    Write-Host "Flagged-media canary completed successfully." -ForegroundColor Green
    Write-Host "Report: $(Join-Path $resultsDirectory "$runId.assessment-load.report.json")"
    Write-Host "Trace:  $(Join-Path $resultsDirectory "$runId.assessment-load.trace.jsonl")"
}
finally {
    foreach ($name in $credentialVariables) {
        Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    }
}
