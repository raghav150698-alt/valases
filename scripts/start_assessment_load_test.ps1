[CmdletBinding()]
param(
    [ValidateRange(1, 100)]
    [int]$CandidatesPerEmployer = 100,

    [ValidateRange(1, 300)]
    [int]$Concurrency = 60,

    [ValidateRange(1, 10)]
    [int]$Autosaves = 2,

    [ValidateRange(0, 100)]
    [int]$FlagPercent = 10,

    [switch]$UploadFlagClips = $true,

    [ValidateRange(16, 12288)]
    [int]$ClipKilobytes = 256
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $PSScriptRoot "product_fit_pilot.local.json"
$pilotRunner = Join-Path $PSScriptRoot "run_product_fit_pilot.py"
$loadRunner = Join-Path $PSScriptRoot "run_assessment_load_test.py"
$statePath = Join-Path $repositoryRoot ".pilot-runs\three-employer-product-fit-sept-2026.state.json"
$venvPython = Join-Path $repositoryRoot ".codex-run-venv\Scripts\python.exe"
$python = if (Test-Path -LiteralPath $venvPython) { $venvPython } else { "python" }

function Read-PlainTextPassword {
    param([Parameter(Mandatory = $true)][string]$Label)
    $secure = Read-Host "Password for $Label" -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
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
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 8
    if ($health.status -ne "ok" -or $health.database -ne "ready") {
        throw "The API is not ready: $($health | ConvertTo-Json -Compress)"
    }
    if (-not (Test-Path -LiteralPath $configPath) -or -not (Test-Path -LiteralPath $statePath)) {
        throw "The completed 300-candidate safe pilot configuration and state are required."
    }

    $pilotState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $stateEmployers = @($pilotState.employers.PSObject.Properties)
    $preparedCounts = @(
        foreach ($employerProperty in $stateEmployers) {
            @(
                $employerProperty.Value.candidates.PSObject.Properties |
                    Where-Object { $null -ne $_.Value.assessment_issue }
            ).Count
        }
    )
    $preparedStateComplete = (
        $stateEmployers.Count -eq 3 -and
        @($preparedCounts | Where-Object { $_ -lt $CandidatesPerEmployer }).Count -eq 0
    )

    $total = $CandidatesPerEmployer * 3
    Write-Host ""
    Write-Host "Valases concurrent assessment load test" -ForegroundColor Green
    Write-Host "Sessions: $total ($CandidatesPerEmployer per employer)"
    Write-Host "Peak concurrent sessions: $Concurrency"
    Write-Host "Autosaves per session: $Autosaves"
    Write-Host "Synthetic proctor-event rate: $FlagPercent%"
    Write-Host "Flagged media: $(if ($UploadFlagClips) { "camera + screen, $ClipKilobytes KB each" } else { "disabled" })"
    Write-Host "Candidate email is suppressed. AI grading is not used." -ForegroundColor Yellow
    Write-Host "This creates and submits synthetic assessments into the recruiter review queues." -ForegroundColor Yellow
    $confirmation = Read-Host "Type LOAD $total to continue"
    if ($confirmation -cne "LOAD $total") { throw "Assessment load test cancelled." }

    if ($preparedStateComplete) {
        Write-Host ""
        Write-Host "Preparation: 100.0% | $total/$total invitations already available; skipping employer login." -ForegroundColor Green
    }
    else {
        $env:VALASES_PILOT_SIMPLICON_EMAIL = "raghav150698@gmail.com"
        $env:VALASES_PILOT_QX_GLOBAL_EMAIL = "qxcommute@gmail.com"
        $env:VALASES_PILOT_EDUTRIP_EMAIL = "founders@edutripindia.com"
        $env:VALASES_PILOT_SIMPLICON_PASSWORD = Read-PlainTextPassword "Simplicon (raghav150698@gmail.com)"
        $env:VALASES_PILOT_QX_GLOBAL_PASSWORD = Read-PlainTextPassword "QX Global (qxcommute@gmail.com)"
        $env:VALASES_PILOT_EDUTRIP_PASSWORD = Read-PlainTextPassword "Edutrip (founders@edutripindia.com)"

        Write-Host ""
        Write-Host "Preparing tenant-owned assessment invitations without email..." -ForegroundColor Cyan
        & $python $pilotRunner `
            --config $configPath `
            --phase assessments `
            --candidate-count $CandidatesPerEmployer `
            --assessment-invites-per-employer $CandidatesPerEmployer `
            --confirm-assessment-invites $total `
            --suppress-assessment-email
        if ($LASTEXITCODE -ne 0) { throw "Assessment preparation failed. Inspect the pilot report and trace." }
    }

    Write-Host ""
    Write-Host "Releasing concurrent candidate assessment sessions..." -ForegroundColor Cyan
    $loadArguments = @(
        $loadRunner,
        "--config", $configPath,
        "--state", $statePath,
        "--candidates-per-employer", $CandidatesPerEmployer,
        "--concurrency", $Concurrency,
        "--autosaves", $Autosaves,
        "--flag-percent", $FlagPercent
    )
    if ($UploadFlagClips) {
        $loadArguments += @("--clip-bytes", ($ClipKilobytes * 1024))
    }
    & $python @loadArguments
    if ($LASTEXITCODE -ne 0) { throw "Load run completed with failures. Keep the report and trace for diagnosis." }
}
finally {
    foreach ($name in $credentialVariables) {
        Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    }
}
