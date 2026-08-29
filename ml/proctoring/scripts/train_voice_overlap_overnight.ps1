[CmdletBinding()]
param(
  [int]$WindowsPerRun = 50000,
  [int]$VoxConverseLimit = 200,
  [int]$SeedCount = 24,
  [string]$RunRoot = "data\proctoring\models\voice_overlap_overnight",
  [switch]$PromoteToBrowser,
  [switch]$ForceRetrain
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$pythonExe = Join-Path $repoRoot ".venv-proctoring\Scripts\python.exe"
$trainer = Join-Path $repoRoot "ml\proctoring\scripts\train_voice_overlap_model.py"
$runRootAbs = Join-Path $repoRoot $RunRoot
$logPath = Join-Path $runRootAbs "overnight.log"

if (-not (Test-Path $pythonExe)) {
  throw "Proctoring Python environment not found: $pythonExe"
}
New-Item -ItemType Directory -Path $runRootAbs -Force | Out-Null

"Started $(Get-Date -Format o)" | Set-Content -Path $logPath
for ($seed = 1; $seed -le $SeedCount; $seed++) {
  $runDir = Join-Path $runRootAbs ("seed_{0:D3}" -f $seed)
  New-Item -ItemType Directory -Path $runDir -Force | Out-Null
  $seedArtifacts = @(
    (Join-Path $runDir "voice_overlap_model.joblib"),
    (Join-Path $runDir "voice_overlap_browser.json"),
    (Join-Path $runDir "voice_overlap_metrics.json")
  )
  $seedComplete = @($seedArtifacts | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -eq 0
  if ($seedComplete -and -not $ForceRetrain) {
    "[$((Get-Date).ToString('o'))] seed=$seed already complete; skipping" | Tee-Object -FilePath $logPath -Append
    continue
  }
  $started = Get-Date
  "[$($started.ToString('o'))] seed=$seed starting" | Tee-Object -FilePath $logPath -Append
  & $pythonExe -W "ignore" $trainer `
    --seed $seed `
    --windows $WindowsPerRun `
    --voxconverse-limit $VoxConverseLimit `
    --output-dir $runDir 2>&1 | Tee-Object -FilePath (Join-Path $runDir "train.log")
  if ($LASTEXITCODE -ne 0) {
    "[$((Get-Date).ToString('o'))] seed=$seed failed" | Tee-Object -FilePath $logPath -Append
    continue
  }
  "[$((Get-Date).ToString('o'))] seed=$seed completed" | Tee-Object -FilePath $logPath -Append
}

$metricFiles = for ($seed = 1; $seed -le $SeedCount; $seed++) {
  $runDir = Join-Path $runRootAbs ("seed_{0:D3}" -f $seed)
  $metricPath = Join-Path $runDir "voice_overlap_metrics.json"
  $modelPath = Join-Path $runDir "voice_overlap_model.joblib"
  $browserPath = Join-Path $runDir "voice_overlap_browser.json"
  if ((Test-Path -LiteralPath $metricPath) -and
      (Test-Path -LiteralPath $modelPath) -and
      (Test-Path -LiteralPath $browserPath)) {
    Get-Item -LiteralPath $metricPath
  }
}
$ranked = foreach ($metricFile in $metricFiles) {
  $metrics = Get-Content $metricFile.FullName -Raw | ConvertFrom-Json
  [pscustomobject]@{
    Path = $metricFile.DirectoryName
    RocAuc = [double]$metrics.roc_auc
    Accuracy = [double]$metrics.classification_report.accuracy
    SampleCount = [int]$metrics.sample_count
  }
}
if (-not $ranked) {
  throw "No successful training runs found. See $logPath"
}
$best = $ranked | Sort-Object RocAuc, Accuracy -Descending | Select-Object -First 1
$promoted = Join-Path $runRootAbs "promoted"
New-Item -ItemType Directory -Path $promoted -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $best.Path "voice_overlap_model.joblib") -Destination (Join-Path $promoted "voice_overlap_model.joblib") -Force
Copy-Item -LiteralPath (Join-Path $best.Path "voice_overlap_browser.json") -Destination (Join-Path $promoted "voice_overlap_browser.json") -Force
Copy-Item -LiteralPath (Join-Path $best.Path "voice_overlap_metrics.json") -Destination (Join-Path $promoted "voice_overlap_metrics.json") -Force

$summary = [pscustomobject]@{
  selected_run = $best.Path
  roc_auc = $best.RocAuc
  accuracy = $best.Accuracy
  sample_count = $best.SampleCount
  run_count = @($ranked).Count
  promoted_dir = $promoted
  completed_at = (Get-Date).ToString('o')
}
$summary | ConvertTo-Json | Set-Content (Join-Path $promoted "promotion_summary.json")
if ($PromoteToBrowser) {
  $browserTarget = Join-Path $repoRoot "app\web_assessment_react\public\assets\generated\voice_overlap_model.json"
  Copy-Item (Join-Path $promoted "voice_overlap_browser.json") $browserTarget -Force
  Write-Host "Promoted browser model: $browserTarget" -ForegroundColor Green
}
$summary | Format-List
