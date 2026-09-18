# Creates Start-menu shortcut(s) for the ZRemote Expo Go server.
# Generates app/assets/brand/zremote.ico from logos/AppIcon.png first
# (shortcuts need .ico, and the source logo is a PNG).
param(
    [switch]$Tunnel
)

$ErrorActionPreference = 'Stop'

$appDir  = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoDir = (Resolve-Path (Join-Path $appDir "..")).Path
$icoPath = Join-Path $appDir "assets\brand\zremote.ico"
$srcLogo = Join-Path $repoDir "logos\AppIcon.png"

if (-not (Test-Path $srcLogo)) {
    throw "Source logo not found: $srcLogo"
}

# 256x256 PNG wrapped in a minimal ICO container (ICO = header + PNG payload).
$nodeScript = @"
const fs = require('fs');
const sharp = require('$($appDir -replace '\\','/')/node_modules/sharp');
sharp('$($srcLogo -replace '\\','/')')
  .resize(256, 256)
  .png()
  .toBuffer()
  .then(png => {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    const entry = Buffer.alloc(16);
    entry.writeUInt8(0, 0);
    entry.writeUInt8(0, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(22, 12);
    fs.writeFileSync('$($icoPath -replace '\\','/')', Buffer.concat([header, entry, png]));
  })
  .catch(e => { console.error(e); process.exit(1); });
"@
& node -e $nodeScript
if ($LASTEXITCODE -ne 0) { throw "ICO generation failed" }

$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$launcher  = Join-Path $appDir "scripts\start-go.ps1"
$shell     = New-Object -ComObject WScript.Shell

function New-Shortcut($name, $extraArgs) {
    $lnkPath = Join-Path $startMenu "$name.lnk"
    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath = "powershell.exe"
    $lnk.Arguments = "-NoExit -ExecutionPolicy Bypass -File `"$launcher`"$extraArgs"
    $lnk.WorkingDirectory = $appDir
    $lnk.IconLocation = $icoPath
    $lnk.Save()
    return $lnkPath
}

$main = New-Shortcut "ZRemote Expo Go Server" ""
Write-Host "Created: $main"
if ($Tunnel) {
    $tun = New-Shortcut "ZRemote Expo Go Server (tunnel)" " -Tunnel"
    Write-Host "Created: $tun"
}
Write-Host "In Start, search 'ZRemote', right-click -> Pin to Start"
