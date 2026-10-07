[CmdletBinding()]
param(
    [ValidateSet("Plan", "Preflight", "Safe", "Verify", "Assessments")]
    [string]$Phase = "Plan",

    [ValidateRange(1, 100)]
    [int]$CandidatesPerEmployer = 100,

    [ValidateRange(1, 100)]
    [int]$AssessmentInvitesPerEmployer = 1
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $PSScriptRoot "product_fit_pilot.local.json"
$runnerPath = Join-Path $PSScriptRoot "run_product_fit_pilot.py"
$venvPython = Join-Path $repositoryRoot ".codex-run-venv\Scripts\python.exe"
$python = if (Test-Path -LiteralPath $venvPython) { $venvPython } else { "python" }

function Read-PlainTextPassword {
    param([Parameter(Mandatory = $true)][string]$Label)

    $secure = Read-Host "Password for $Label" -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Test-LocalApi {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 8
    }
    catch {
        throw "The Valases API is not running at http://127.0.0.1:8000. Start the local product first."
    }
    if ($health.status -ne "ok" -or $health.database -ne "ready") {
        throw "The API responded, but it is not ready: $($health | ConvertTo-Json -Compress)"
    }
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
    if (-not (Test-Path -LiteralPath $configPath)) {
        throw "Pilot configuration is missing: $configPath"
    }

    $phaseValue = $Phase.ToLowerInvariant()
    if ($phaseValue -ne "plan") {
        Test-LocalApi
        $env:VALASES_PILOT_SIMPLICON_EMAIL = "raghav150698@gmail.com"
        $env:VALASES_PILOT_QX_GLOBAL_EMAIL = "qxcommute@gmail.com"
        $env:VALASES_PILOT_EDUTRIP_EMAIL = "founders@edutripindia.com"
        $env:VALASES_PILOT_SIMPLICON_PASSWORD = Read-PlainTextPassword "Simplicon (raghav150698@gmail.com)"
        $env:VALASES_PILOT_QX_GLOBAL_PASSWORD = Read-PlainTextPassword "QX Global (qxcommute@gmail.com)"
        $env:VALASES_PILOT_EDUTRIP_PASSWORD = Read-PlainTextPassword "Edutrip (founders@edutripindia.com)"
    }

    Write-Host ""
    Write-Host "Valases product-fit pilot" -ForegroundColor Green
    Write-Host "Phase: $phaseValue"
    Write-Host "Scope: 3 employers x $CandidatesPerEmployer candidates"
    if ($phaseValue -eq "safe") {
        Write-Host "No assessment invitations or candidate emails will be sent." -ForegroundColor Yellow
        Write-Host "The run is resumable; re-run this same command if it is interrupted." -ForegroundColor Yellow
    }
    if ($phaseValue -eq "assessments") {
        $maximumInvitations = $AssessmentInvitesPerEmployer * 3
        Write-Host "This can send up to $maximumInvitations assessment invitations and store temporary candidate credentials." -ForegroundColor Yellow
        $confirmation = Read-Host "Type ISSUE $maximumInvitations to continue"
        if ($confirmation -cne "ISSUE $maximumInvitations") {
            throw "Assessment invitation phase cancelled."
        }
    }
    Write-Host ""

    $runnerArguments = @($runnerPath, "--config", $configPath, "--phase", $phaseValue, "--candidate-count", $CandidatesPerEmployer)
    if ($phaseValue -eq "assessments") {
        $runnerArguments += @(
            "--assessment-invites-per-employer", $AssessmentInvitesPerEmployer,
            "--confirm-assessment-invites", ($AssessmentInvitesPerEmployer * 3)
        )
    }
    & $python @runnerArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Pilot runner exited with code $LASTEXITCODE. Review the report under .pilot-runs and re-run after correcting the reported error."
    }
}
finally {
    foreach ($name in $credentialVariables) {
        Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    }
}
