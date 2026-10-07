[CmdletBinding()]
param(
  [int]$AudioWindowsPerRun = 50000,
  [int]$AudioVoxConverseLimit = 200,
  [int]$AudioSeedCount = 24,
  [int]$VideoMaxFrames = 120,
  [int]$VideoWindowsPerVideo = 12,
  [int]$VideoXgbEstimators = 2000,
  [int]$VideoCnnEpochs = 300,
  [switch]$PromoteAudioToBrowser
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$videoTrainer = Join-Path $repoRoot "ml\proctoring\scripts\retrain_proctor_max.ps1"
$audioTrainer = Join-Path $repoRoot "ml\proctoring\scripts\train_voice_overlap_overnight.ps1"

Push-Location $repoRoot
try {
  Write-Host "=== VIDEO ANTI-CHEATING MODEL ===" -ForegroundColor Cyan
  & powershell -ExecutionPolicy Bypass -File $videoTrainer `
    -SkipDependencyInstall `
    -MaxFrames $VideoMaxFrames `
    -WindowsPerVideo $VideoWindowsPerVideo `
    -XgbEstimators $VideoXgbEstimators `
    -CnnEpochs $VideoCnnEpochs
  if ($LASTEXITCODE -ne 0) { throw "Video proctor training failed." }

  Write-Host "=== VOICE OVERLAP MODEL ===" -ForegroundColor Cyan
  $audioArgs = @(
    "-ExecutionPolicy", "Bypass", "-File", $audioTrainer,
    "-WindowsPerRun", $AudioWindowsPerRun,
    "-VoxConverseLimit", $AudioVoxConverseLimit,
    "-SeedCount", $AudioSeedCount
  )
  if ($PromoteAudioToBrowser) { $audioArgs += "-PromoteToBrowser" }
  & powershell @audioArgs
  if ($LASTEXITCODE -ne 0) { throw "Voice-overlap training failed." }

  Write-Host "Completed both video and audio training pipelines." -ForegroundColor Green
  Write-Host "Video output: data\proctoring\models\supervised"
  Write-Host "Audio output: data\proctoring\models\voice_overlap_overnight\promoted"
}
finally {
  Pop-Location
}
