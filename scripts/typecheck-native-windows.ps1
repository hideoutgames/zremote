# Host typechecking against the real generated C ABI and pinned Keychain API.
# Windows uses SkipKeychain's upstream unsupported-platform implementation;
# this check does not exercise iOS Keychain or Android Keystore behavior.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'swift-environment.ps1')
$env:ZREMOTE_CORE_ONLY = '0'
if ($env:ZREMOTE_RESOURCE_PROFILE -ne 'shared') {
    python (Join-Path $PSScriptRoot 'run-local.py') --phase swift -- powershell.exe -NoProfile -File $PSCommandPath
    exit $LASTEXITCODE
}
$checkRoot = Join-Path $env:LOCALAPPDATA 'ZRemote\cache\native-swift-typecheck'
$keychain = Join-Path $zremoteTools 'skip-keychain\Sources\SkipKeychain\SkipKeychain.swift'
$headers = Join-Path $repoRoot 'native\ffi\include'
$keychainRevision = git -C (Join-Path $zremoteTools 'skip-keychain') rev-parse HEAD
if ($keychainRevision -ne '57ec073652c7d307217b4ceb11fce989f38afc66') { throw 'Expected SkipKeychain 0.3.4 sources' }
git -C (Join-Path $zremoteTools 'skip-keychain') diff --quiet HEAD -- Sources/SkipKeychain/SkipKeychain.swift
if ($LASTEXITCODE -ne 0) { throw 'SkipKeychain source has local changes' }
foreach ($required in @($keychain, (Join-Path $headers 'zeron_coreFFI.h'), (Join-Path $headers 'module.modulemap'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing native typecheck input: $required" }
}
New-Item -ItemType Directory -Force -Path $checkRoot | Out-Null
$coreFiles = @(Get-ChildItem (Join-Path $repoRoot 'Sources\ZRemoteCore') -Recurse -Filter '*.swift' | ForEach-Object FullName)
& swiftc -emit-module -parse-as-library -swift-version 6 -sdk $env:SDKROOT -module-name ZRemoteCore -emit-module-path (Join-Path $checkRoot 'ZRemoteCore.swiftmodule') $coreFiles
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& swiftc -emit-module -parse-as-library -swift-version 5 -sdk $env:SDKROOT -module-name SkipKeychain -emit-module-path (Join-Path $checkRoot 'SkipKeychain.swiftmodule') $keychain
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$nativeFiles = @(Get-ChildItem (Join-Path $repoRoot 'Sources\ZRemoteNative') -Recurse -Filter '*.swift' | ForEach-Object FullName)
$bindingPath = Join-Path $repoRoot 'Sources\ZRemoteNative\Generated\zeron_core.swift'
$bindingHash = (Get-FileHash -LiteralPath $bindingPath -Algorithm SHA256).Hash
& swiftc -typecheck -swift-version 6 -sdk $env:SDKROOT -module-name ZRemoteNative -I $checkRoot -I $headers $nativeFiles
$checkExit = $LASTEXITCODE
if ((Get-FileHash -LiteralPath $bindingPath -Algorithm SHA256).Hash -ne $bindingHash) { throw 'Generated bindings changed during typecheck; result is stale' }
exit $checkExit
