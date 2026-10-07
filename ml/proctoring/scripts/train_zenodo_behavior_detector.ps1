[CmdletBinding()]
param(
  [int]$Epochs = 80,
  [int]$ImageSize = 512,
  [int]$Batch = 8,
  [int]$Workers = 4,
  [int]$Patience = 15,
  [string]$Model = "yolo26n.pt",
  [switch]$Resume,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$pythonExe = Join-Path $repoRoot ".venv-proctoring\Scripts\python.exe"
$trainer = Join-Path $repoRoot "ml\proctoring\scripts\train_zenodo_behavior_detector.py"
$datasetRoot = Join-Path $repoRoot "data\proctoring\external_licensed\zenodo_students_behavior"
$project = Join-Path $repoRoot "data\proctoring\models\zenodo_behavior_detector"

if (-not (Test-Path $pythonExe)) { throw "Python environment not found: $pythonExe" }
if (-not (Test-Path $datasetRoot)) { throw "Dataset not found: $datasetRoot" }

Push-Location $repoRoot
try {
  if (-not $SkipInstall) {
    & $pythonExe -m pip install --upgrade ultralytics onnx onnxslim
    if ($LASTEXITCODE -ne 0) { throw "Ultralytics/ONNX dependency installation failed." }
  }

  $arguments = @(
    $trainer,
    "--dataset-root", $datasetRoot,
    "--model", $Model,
    "--epochs", $Epochs,
    "--imgsz", $ImageSize,
    "--batch", $Batch,
    "--workers", $Workers,
    "--patience", $Patience,
    "--project", $project,
    "--name", "yolo26n_external_v1",
    "--device", "cpu"
  )
  if ($Resume) { $arguments += "--resume" }
  & $pythonExe @arguments
  if ($LASTEXITCODE -ne 0) { throw "Zenodo behavior-detector training failed." }

  Write-Host "Training and ONNX export completed." -ForegroundColor Green
  Write-Host "Review: $project\yolo26n_external_v1\proctor_detector_report.json"
  Write-Host "No production model was overwritten."
}
finally {
  Pop-Location
}
