param(
  [ValidateSet("menu", "mythos", "lab", "docs")]
  [string]$Action = "menu"
)

$ErrorActionPreference = "Stop"

$Root = "C:\Users\Admin\Desktop\AI-guided REST API fuzzer"
$MythosPath = $Root
$LabPath = Join-Path $Root "cloud-brain-scope-lab"
$DocsPath = Join-Path $Root "docs\WORKSPACE-BOUNDARIES.md"

function Test-RequiredPaths {
  $missing = @()
  if (-not (Test-Path $MythosPath)) { $missing += $MythosPath }
  if (-not (Test-Path $LabPath)) { $missing += $LabPath }
  if (-not (Test-Path $DocsPath)) { $missing += $DocsPath }
  if ($missing.Count -gt 0) {
    Write-Host "Missing required paths:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    exit 1
  }
}

function Run-Mythos {
  Write-Host ""
  Write-Host "Starting Mythos CLI (interactive target prompt)..." -ForegroundColor Cyan
  Set-Location $MythosPath
  npm start
}

function Run-Lab {
  Write-Host ""
  Write-Host "Starting Cloud Brain Scope Lab (frontend + backend)..." -ForegroundColor Cyan
  Set-Location $LabPath
  npm run dev
}

function Open-Docs {
  Write-Host ""
  Write-Host "Opening workspace boundaries doc..." -ForegroundColor Cyan
  Set-Location $Root
  Start-Process $DocsPath
}

function Show-Menu {
  while ($true) {
    Write-Host ""
    Write-Host "==============================================" -ForegroundColor DarkGray
    Write-Host "AI Guided Security Workspace Launcher" -ForegroundColor Green
    Write-Host "==============================================" -ForegroundColor DarkGray
    Write-Host "1) Run Mythos CLI (fuzzer core)"
    Write-Host "2) Run Cloud Brain Scope Lab"
    Write-Host "3) Open workspace boundaries doc"
    Write-Host "4) Exit"
    Write-Host ""
    $choice = Read-Host "Pick an option"
    switch ($choice) {
      "1" { Run-Mythos }
      "2" { Run-Lab }
      "3" { Open-Docs }
      "4" { break }
      default { Write-Host "Invalid option. Choose 1-4." -ForegroundColor Yellow }
    }
  }
}

Test-RequiredPaths

switch ($Action) {
  "mythos" { Run-Mythos; break }
  "lab"    { Run-Lab; break }
  "docs"   { Open-Docs; break }
  default  { Show-Menu; break }
}
