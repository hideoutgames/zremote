# ZRemote - Expo Go server launcher (Windows).
# Double-clicked via the Start-menu shortcut created by
# install-start-shortcut.ps1. Keeps the window open on failure.
param(
    [switch]$Tunnel
)

$Host.UI.RawUI.WindowTitle = "ZRemote - Expo Go server"

$appDir = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $appDir

Write-Host "Scan the QR in Expo Go. Press r to reload, Ctrl+C to stop."

if ($Tunnel) {
    npm run start:go -- --tunnel
} else {
    npm run start:go
}

if ($LASTEXITCODE -ne 0) {
    Read-Host "Server exited with an error - press Enter to close"
}
