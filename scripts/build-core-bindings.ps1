# Compile the engine-free core on Windows and regenerate its Swift/C API.
# This validates host compilation; it does not build an iOS or Android app.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'rust-environment.ps1')
$manifest = Join-Path $repoRoot 'native\core\Cargo.toml'
python (Join-Path $PSScriptRoot 'run-local.py') --phase rust -- cargo build --locked --manifest-path $manifest -p zeron-mobile --lib --bin uniffi-bindgen --features bindgen
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$generated = Join-Path $repoRoot 'native\artifacts\generated'
$headers = Join-Path $repoRoot 'native\ffi\include'
New-Item -ItemType Directory -Force -Path $generated, $headers | Out-Null
$bindgen = Join-Path $env:CARGO_TARGET_DIR 'debug\uniffi-bindgen.exe'
$library = Join-Path $env:CARGO_TARGET_DIR 'debug\zeron_mobile.dll'
Push-Location (Join-Path $repoRoot 'native\core')
try {
    & $bindgen generate --library $library --language swift --no-format --out-dir $generated
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}
python (Join-Path $PSScriptRoot 'normalize-native-bindings.py') --generated $generated
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'Regenerated Swift declarations and C headers from the compiled native core.'
