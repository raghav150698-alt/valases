[CmdletBinding()]
param(
  [switch]$RetrainVision,
  [switch]$RetrainAudio,
  [ValidateRange(1, 100)]
  [int]$VisionEpochs = 40,
  [ValidateRange(1, 50)]
  [int]$AudioSeedCount = 12
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$python = Join-Path $repoRoot ".venv-proctoring\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
  $python = (Get-Command python -ErrorAction Stop).Source
}

Set-Location $repoRoot
Write-Host "Best proctor model pipeline" -ForegroundColor Cyan
Write-Host "Decision levels: ignore -> recruiter review -> high-confidence flag"
Write-Host "Automatic rejection: disabled"
Write-Host "Automatic score deductions: disabled"
$visionModelRoot = Join-Path $repoRoot "data\proctoring\models\proctor_vision_ultra"
$visionReport = Join-Path $visionModelRoot "rfdetr_nano_grouped_v1\proctor_vision_ultra_report.json"

function Select-BestVisionReport {
  param([string]$ModelRoot, [string]$FallbackReport)

  $rankedReports = foreach ($reportFile in Get-ChildItem -LiteralPath $ModelRoot -Filter "proctor_vision_ultra_report.json" -Recurse -File -ErrorAction SilentlyContinue) {
    try {
      $report = Get-Content -LiteralPath $reportFile.FullName -Raw | ConvertFrom-Json
      $map = [double]$report.validation_metrics.'val/mAP_50_95'
      if ([double]::IsNaN($map) -or [double]::IsInfinity($map)) { continue }
      [pscustomobject]@{ Path = $reportFile.FullName; Map = $map }
    } catch {
      Write-Warning "Ignoring unreadable vision report: $($reportFile.FullName)"
    }
  }
  $bestReport = $rankedReports | Sort-Object Map -Descending | Select-Object -First 1
  if ($bestReport) {
    Write-Host "Selected best completed vision report (validation mAP=$($bestReport.Map)): $($bestReport.Path)"
    return $bestReport.Path
  }
  return $FallbackReport
}

$visionReport = Select-BestVisionReport -ModelRoot $visionModelRoot -FallbackReport $visionReport

if ($RetrainVision) {
  Write-Host "Retraining RF-DETR vision model..." -ForegroundColor Cyan
  $visionRunName = "rfdetr_nano_grouped_v2_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
  & powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\train_proctor_vision_ultra_overnight.ps1" -Epochs $VisionEpochs -RunName $visionRunName
  if ($LASTEXITCODE -ne 0) { throw "Vision training failed with exit code $LASTEXITCODE" }
  $candidateVisionReport = Join-Path $repoRoot "data\proctoring\models\proctor_vision_ultra\$visionRunName\proctor_vision_ultra_report.json"
  if (-not (Test-Path -LiteralPath $candidateVisionReport)) { throw "Vision report is missing: $candidateVisionReport" }
  if (Test-Path -LiteralPath $visionReport) {
    $currentMetrics = Get-Content -LiteralPath $visionReport -Raw | ConvertFrom-Json
    $candidateMetrics = Get-Content -LiteralPath $candidateVisionReport -Raw | ConvertFrom-Json
    $currentMap = [double]$currentMetrics.validation_metrics.'val/mAP_50_95'
    $candidateMap = [double]$candidateMetrics.validation_metrics.'val/mAP_50_95'
    if ($candidateMap -ge $currentMap) {
      $visionReport = $candidateVisionReport
      Write-Host "Selected new vision run by validation mAP: $candidateMap >= $currentMap"
    } else {
      Write-Host "Kept current vision run by validation mAP: $currentMap > $candidateMap"
    }
  } else {
    $visionReport = $candidateVisionReport
  }
}

if ($RetrainAudio) {
  Write-Host "Retraining voice-overlap ensemble..." -ForegroundColor Cyan
  & powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\train_voice_overlap_overnight.ps1" -SeedCount $AudioSeedCount -PromoteToBrowser
  if ($LASTEXITCODE -ne 0) { throw "Audio training failed with exit code $LASTEXITCODE" }
}

Write-Host "Building calibrated event-fusion policy..." -ForegroundColor Cyan
& $python "$PSScriptRoot\train_proctor_fusion_policy.py" --vision-report $visionReport
if ($LASTEXITCODE -ne 0) { throw "Fusion policy build failed with exit code $LASTEXITCODE" }

Write-Host "Running fusion policy tests..." -ForegroundColor Cyan
& $python -m unittest tests.services.test_proctor_event_fusion tests.api.test_issued_consent_proctor_routes
if ($LASTEXITCODE -ne 0) { throw "Fusion validation failed with exit code $LASTEXITCODE" }

Write-Host "Best proctor fusion model completed." -ForegroundColor Green
Write-Host "Policy: $repoRoot\data\proctoring\models\fusion\proctor_fusion_policy.json"
Write-Host "Browser copy: $repoRoot\app\web_assessment_react\public\assets\generated\proctor_fusion_policy.json"
Write-Host "High-confidence incidents remain flagged; uncertain incidents require recruiter review."
