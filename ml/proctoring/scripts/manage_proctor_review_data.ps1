[CmdletBinding()]
param(
  [ValidateSet("Export", "Purge")]
  [string]$Mode = "Export",
  [string]$BatchName = "phase1",
  [string]$Manifest = "",
  [switch]$ConfirmPurge
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$python = Join-Path $repoRoot ".venv-proctoring\Scripts\python.exe"
$manager = Join-Path $PSScriptRoot "manage_proctor_review_labels.py"
if (-not (Test-Path -LiteralPath $python)) { throw "Proctoring Python environment not found: $python" }
Set-Location $repoRoot

if ($Mode -eq "Export") {
  if ($BatchName -notmatch '^[A-Za-z0-9_-]{1,80}$') { throw "BatchName may contain only letters, numbers, underscore, and hyphen." }
  $outputDir = Join-Path $repoRoot "data\proctoring\review_labels\$BatchName"
  & $python $manager export --output-dir $outputDir
  if ($LASTEXITCODE -ne 0) { throw "Review-label export failed with exit code $LASTEXITCODE" }
  Write-Host "Export completed. Use this batch for calibration/training: $outputDir" -ForegroundColor Green
  Write-Host "After training and verification, run Purge with its manifest."
  exit 0
}

if (-not $ConfirmPurge) { throw "Purge requires -ConfirmPurge." }
if (-not $Manifest) { throw "Purge requires -Manifest <path-to-manifest.json>." }
$manifestPath = if ([System.IO.Path]::IsPathRooted($Manifest)) { $Manifest } else { Join-Path $repoRoot $Manifest }
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Manifest not found: $manifestPath" }
& $python $manager purge --manifest $manifestPath --confirm DELETE_REVIEW_LABELS_AFTER_TRAINING
if ($LASTEXITCODE -ne 0) { throw "Review-label purge failed with exit code $LASTEXITCODE" }
Write-Host "Raw review labels and the training export were deleted. The purge receipt was retained." -ForegroundColor Green
