[CmdletBinding()]
param(
  [ValidateRange(1, 200)]
  [int]$Epochs = 40,

  [ValidateSet(384, 416, 448, 480, 512)]
  [int]$Resolution = 448,

  [ValidateRange(1, 4)]
  [int]$BatchSize = 1,

  [ValidateRange(1, 64)]
  [int]$GradAccumSteps = 16,

  [ValidateRange(0, 8)]
  [int]$Workers = 2,

  [ValidateRange(2, 30)]
  [int]$Patience = 8,

  [ValidateRange(0.50, 0.999)]
  [double]$TargetPrecision = 0.97,

  [int]$Seed = 42,
  [string]$RunName = "rfdetr_nano_grouped_v1",
  [string]$Distro = "Ubuntu",
  [switch]$Resume,
  [switch]$SkipInstall,
  [switch]$SetupOnly
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$linuxRunnerWindows = Join-Path $repoRoot "ml\proctoring\scripts\train_proctor_vision_ultra_wsl.sh"
$modelRoot = Join-Path $repoRoot "data\proctoring\models\proctor_vision_ultra"
$runRoot = Join-Path $modelRoot $RunName
$logRoot = Join-Path $modelRoot "logs"

if (-not (Test-Path -LiteralPath $linuxRunnerWindows)) {
  throw "WSL training runner not found: $linuxRunnerWindows"
}

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$logPath = Join-Path $logRoot "${RunName}_${timestamp}.log"

Write-Host "Checking WSL2 NVIDIA GPU..." -ForegroundColor Cyan
& wsl.exe -d $Distro -- nvidia-smi --query-gpu=name,memory.total,temperature.gpu,driver_version --format=csv,noheader
if ($LASTEXITCODE -ne 0) {
  throw "The NVIDIA GPU is not available in WSL distribution '$Distro'."
}

$escapedRepoRoot = $repoRoot.Replace('\', '\\')
$linuxRepoRoot = (& wsl.exe -d $Distro -- wslpath -a $escapedRepoRoot).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($linuxRepoRoot)) {
  throw "Could not convert the repository path for WSL: $repoRoot"
}
$linuxRunner = "$linuxRepoRoot/ml/proctoring/scripts/train_proctor_vision_ultra_wsl.sh"

$wslArguments = @(
  "-d", $Distro,
  "--", "bash", $linuxRunner,
  "--repo-root", $linuxRepoRoot,
  "--epochs", $Epochs,
  "--resolution", $Resolution,
  "--batch-size", $BatchSize,
  "--grad-accum-steps", $GradAccumSteps,
  "--workers", $Workers,
  "--patience", $Patience,
  "--target-precision", $TargetPrecision.ToString([System.Globalization.CultureInfo]::InvariantCulture),
  "--seed", $Seed,
  "--run-name", $RunName
)
if ($Resume) { $wslArguments += "--resume" }
if ($SkipInstall) { $wslArguments += "--skip-install" }
if ($SetupOnly) { $wslArguments += "--setup-only" }

Write-Host ""
Write-Host "Overnight profile" -ForegroundColor Cyan
Write-Host "  Framework: RF-DETR Nano (DINOv2 + PyTorch Lightning)"
Write-Host "  Epoch cap: $Epochs (early stopping enabled)"
Write-Host "  Resolution: ${Resolution}x${Resolution}"
Write-Host "  Effective batch: $($BatchSize * $GradAccumSteps)"
Write-Host "  Review precision target: $TargetPrecision"
Write-Host "  Log: $logPath"
Write-Host "  Production model will not be overwritten."
Write-Host ""

$transcriptStarted = $false
try {
  Start-Transcript -Path $logPath -Force | Out-Null
  $transcriptStarted = $true
  & wsl.exe @wslArguments
  if ($LASTEXITCODE -ne 0) {
    throw "WSL RF-DETR pipeline failed with exit code $LASTEXITCODE. See $logPath"
  }
}
finally {
  if ($transcriptStarted) {
    Stop-Transcript | Out-Null
  }
}

if ($SetupOnly) {
  Write-Host "RF-DETR GPU setup completed. No training was started." -ForegroundColor Green
} else {
  Write-Host "Overnight vision training completed." -ForegroundColor Green
  Write-Host "Report: $runRoot\proctor_vision_ultra_report.json"
  Write-Host "Checkpoint: $runRoot\checkpoint_best_total.pth"
  Write-Host "Log: $logPath"
  Write-Host "The model remains evaluation-only until its held-out results are reviewed."
}
