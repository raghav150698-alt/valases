[CmdletBinding()]
param(
  [string]$ReviewedEvents = "",
  [string]$OutputDir = "data\proctoring\validation\latest",
  [string]$Distro = "Ubuntu",
  [switch]$SkipFrontendBuild,
  [switch]$SkipOnnxSmokeTest
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$python = Join-Path $repoRoot ".venv-proctoring\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
  throw "Proctoring Python environment not found: $python"
}

$visionRoot = Join-Path $repoRoot "data\proctoring\models\proctor_vision_ultra"
$visionReports = foreach ($file in Get-ChildItem -LiteralPath $visionRoot -Filter "proctor_vision_ultra_report.json" -Recurse -File -ErrorAction SilentlyContinue) {
  try {
    $report = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
    [pscustomobject]@{ Path = $file.FullName; Map = [double]$report.validation_metrics.'val/mAP_50_95' }
  } catch {
    Write-Warning "Ignoring unreadable report: $($file.FullName)"
  }
}
$bestVision = $visionReports | Sort-Object Map -Descending | Select-Object -First 1
if (-not $bestVision) { throw "No completed vision report found below $visionRoot" }

$voiceReport = Join-Path $repoRoot "data\proctoring\models\voice_overlap_overnight\promoted\voice_overlap_metrics.json"
$fusionPolicy = Join-Path $repoRoot "data\proctoring\models\fusion\proctor_fusion_policy.json"
$outputPath = Join-Path $repoRoot $OutputDir
$onnxModel = Join-Path (Split-Path -Parent $bestVision.Path) "export\rfdetr-nano.onnx"
$evaluator = Join-Path $PSScriptRoot "evaluate_proctor_readiness.py"

foreach ($required in @($voiceReport, $fusionPolicy, $evaluator)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required validation input is missing: $required" }
}
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null

Write-Host "Proctor system validation" -ForegroundColor Cyan
Write-Host "Vision report: $($bestVision.Path)"
Write-Host "Validation mAP: $($bestVision.Map)"
Write-Host "Output: $outputPath"

if (-not $SkipOnnxSmokeTest) {
  if (-not (Test-Path -LiteralPath $onnxModel)) { throw "ONNX model is missing: $onnxModel" }
  Write-Host "[1/4] Running ONNX smoke inference..." -ForegroundColor Cyan
  $savedErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $python -c "import onnxruntime" 2>$null
  $windowsOnnxAvailable = $LASTEXITCODE -eq 0
  $ErrorActionPreference = $savedErrorActionPreference
  if ($windowsOnnxAvailable) {
    & $python (Join-Path $PSScriptRoot "verify_proctor_vision_onnx.py") --model $onnxModel
  } else {
    Write-Host "Windows ONNX Runtime is unavailable; using the existing WSL RF-DETR environment."
    $escapedRepoRoot = $repoRoot.Replace('\', '\\')
    $escapedOnnxModel = $onnxModel.Replace('\', '\\')
    $linuxRepoRoot = (& wsl.exe -d $Distro -- wslpath -a $escapedRepoRoot).Trim()
    $linuxOnnxModel = (& wsl.exe -d $Distro -- wslpath -a $escapedOnnxModel).Trim()
    $wslHome = (& wsl.exe -d $Distro -- sh -lc 'printf %s "$HOME"').Trim()
    if (-not $linuxRepoRoot -or -not $linuxOnnxModel -or -not $wslHome) { throw "Could not resolve validation paths for WSL." }
    $linuxVerifier = "$linuxRepoRoot/ml/proctoring/scripts/verify_proctor_vision_onnx.py"
    $wslPython = "$wslHome/.venvs/certora-proctor-rfdetr-py312/bin/python"
    & wsl.exe -d $Distro -- $wslPython $linuxVerifier --model $linuxOnnxModel
  }
  if ($LASTEXITCODE -ne 0) { throw "ONNX smoke inference failed with exit code $LASTEXITCODE" }
} else {
  Write-Host "[1/4] ONNX smoke inference skipped"
}

Write-Host "[2/4] Running backend fusion and proctor-route tests..." -ForegroundColor Cyan
Set-Location $repoRoot
& $python -m unittest tests.services.test_proctor_event_fusion tests.api.test_issued_consent_proctor_routes tests.api.test_proctor_review_labels
if ($LASTEXITCODE -ne 0) { throw "Backend validation failed with exit code $LASTEXITCODE" }

if (-not $SkipFrontendBuild) {
  Write-Host "[3/4] Building production assessment frontend..." -ForegroundColor Cyan
  Push-Location (Join-Path $repoRoot "app\web_assessment_react")
  try {
    & pnpm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
} else {
  Write-Host "[3/4] Frontend production build skipped"
}

Write-Host "[4/4] Generating readiness report..." -ForegroundColor Cyan
$arguments = @(
  $evaluator,
  "--vision-report", $bestVision.Path,
  "--voice-report", $voiceReport,
  "--fusion-policy", $fusionPolicy,
  "--output-dir", $outputPath
)
if ($ReviewedEvents) {
  $reviewedPath = if ([System.IO.Path]::IsPathRooted($ReviewedEvents)) { $ReviewedEvents } else { Join-Path $repoRoot $ReviewedEvents }
  $arguments += @("--reviewed-events", $reviewedPath)
}
& $python @arguments
if ($LASTEXITCODE -ne 0) { throw "Readiness evaluation failed with exit code $LASTEXITCODE" }

Write-Host "Validation completed." -ForegroundColor Green
Write-Host "Read: $outputPath\proctor_readiness_report.md"
Write-Host "Machine-readable report: $outputPath\proctor_readiness_report.json"
