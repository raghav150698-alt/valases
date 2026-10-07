[CmdletBinding()]
param(
  [int]$Epochs = 80,
  [int]$ImageSize = 512,
  [int]$Batch = 8,
  [int]$Workers = 4,
  [int]$Patience = 15,
  [string]$Model = "yolo26n.pt",
  [string]$RunName = "yolo26n_external_v1",
  [string]$Distro = "Ubuntu",
  [switch]$Resume,
  [switch]$SkipInstall,
  [switch]$SetupOnly
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$linuxRunnerWindows = Join-Path $repoRoot "ml\proctoring\scripts\train_zenodo_behavior_detector_wsl.sh"

if (-not (Test-Path -LiteralPath $linuxRunnerWindows)) {
  throw "WSL training runner not found: $linuxRunnerWindows"
}

Write-Host "Checking WSL2 NVIDIA GPU..." -ForegroundColor Cyan
& wsl.exe -d $Distro -- nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
if ($LASTEXITCODE -ne 0) {
  throw "The NVIDIA GPU is not available in WSL distribution '$Distro'."
}

if (-not $SkipInstall) {
  & wsl.exe -d $Distro -- python3 -c "import ensurepip, venv"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing Ubuntu Python environment support (first run only)..." -ForegroundColor Cyan
    & wsl.exe -d $Distro -u root -- apt-get update
    if ($LASTEXITCODE -ne 0) { throw "Ubuntu package index update failed." }
    & wsl.exe -d $Distro -u root -- apt-get install -y python3-venv python3-pip libgl1
    if ($LASTEXITCODE -ne 0) { throw "Ubuntu Python environment package installation failed." }
  }
}

$escapedRepoRoot = $repoRoot.Replace('\', '\\')
$linuxRepoRoot = (& wsl.exe -d $Distro -- wslpath -a $escapedRepoRoot).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($linuxRepoRoot)) {
  throw "Could not convert the repository path for WSL: $repoRoot"
}
$linuxRunner = "$linuxRepoRoot/ml/proctoring/scripts/train_zenodo_behavior_detector_wsl.sh"

$wslArguments = @(
  "-d", $Distro,
  "--", "bash", $linuxRunner,
  "--repo-root", $linuxRepoRoot,
  "--epochs", $Epochs,
  "--image-size", $ImageSize,
  "--batch", $Batch,
  "--workers", $Workers,
  "--patience", $Patience,
  "--model", $Model,
  "--run-name", $RunName
)
if ($Resume) { $wslArguments += "--resume" }
if ($SkipInstall) { $wslArguments += "--skip-install" }
if ($SetupOnly) { $wslArguments += "--setup-only" }

Write-Host "Starting WSL GPU pipeline..." -ForegroundColor Cyan
& wsl.exe @wslArguments
if ($LASTEXITCODE -ne 0) {
  throw "WSL GPU pipeline failed with exit code $LASTEXITCODE."
}

if ($SetupOnly) {
  Write-Host "GPU setup completed. No training was started." -ForegroundColor Green
} else {
  Write-Host "GPU training and ONNX export completed." -ForegroundColor Green
  Write-Host "Review: $repoRoot\data\proctoring\models\zenodo_behavior_detector\$RunName\proctor_detector_report.json"
  Write-Host "No production model was overwritten."
}
