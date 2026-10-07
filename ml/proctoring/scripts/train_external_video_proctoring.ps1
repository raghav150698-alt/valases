[CmdletBinding()]
param(
  [int]$MaxFrames = 120,
  [int]$WindowsPerVideo = 12,
  [int]$XgbEstimators = 2000,
  [int]$CnnEpochs = 300,
  [switch]$SkipPrepare
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$pythonExe = Join-Path $repoRoot ".venv-proctoring\Scripts\python.exe"
if (-not (Test-Path $pythonExe)) { throw "Python environment not found: $pythonExe" }

$manifest = Join-Path $repoRoot "data\proctoring\processed\manifest_external_video_dedup.csv"
$features = Join-Path $repoRoot "data\proctoring\processed\video_features_external_dedup.csv"
$modelDir = Join-Path $repoRoot "data\proctoring\models\supervised_external_video"

Push-Location $repoRoot
try {
  if (-not $SkipPrepare) {
    & $pythonExe "ml\proctoring\scripts\prepare_external_video_manifest.py" `
      --repo-root $repoRoot `
      --output "data\proctoring\processed\manifest_external_video_dedup.csv"
    if ($LASTEXITCODE -ne 0) { throw "External manifest preparation failed." }
  }

  & $pythonExe "ml\proctoring\scripts\extract_video_features.py" `
    --manifest $manifest `
    --output $features `
    --max-frames $MaxFrames `
    --windows-per-video $WindowsPerVideo
  if ($LASTEXITCODE -ne 0) { throw "External video feature extraction failed." }

  & $pythonExe "ml\proctoring\scripts\train_supervised_models.py" `
    --features $features `
    --out-dir $modelDir `
    --xgb-estimators $XgbEstimators `
    --cnn-epochs $CnnEpochs
  if ($LASTEXITCODE -ne 0) { throw "External video model training failed." }

  Write-Host "Completed. Review before promotion:" -ForegroundColor Green
  Write-Host " - $features"
  Write-Host " - $(Join-Path $modelDir 'evaluation_report.json')"
  Write-Host " - $(Join-Path $modelDir 'deduction_rules.json')"
  Write-Host "No existing model was overwritten."
}
finally {
  Pop-Location
}
