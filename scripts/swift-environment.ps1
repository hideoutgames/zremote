# Dot-source to use the user-local official Swift/Windows SDK/VC archives.
$zremoteTools = Join-Path $env:LOCALAPPDATA 'ZRemote\toolchains'
$zremoteSwift = Join-Path $zremoteTools 'swift-portable'
$zremoteCompiler = Join-Path $zremoteSwift 'Toolchains\6.4.0+NoAsserts\usr\bin'
$zremoteSDK = Join-Path $zremoteSwift 'Platforms\6.4.0\Windows.platform\Developer\SDKs\Windows.sdk'
$zremoteVC = Join-Path $zremoteTools 'vc-tools\Contents\VC\Tools\MSVC\14.44.35207'
$zremoteWindowsHeaders = Join-Path $zremoteTools 'windows-sdk\c\Include\10.0.28000.0'
$zremoteWindowsLibraries = Join-Path $zremoteTools 'windows-sdk-libs\c'
foreach ($zremoteRequired in @($zremoteCompiler, $zremoteSDK, $zremoteVC, $zremoteWindowsHeaders, $zremoteWindowsLibraries)) {
    if (-not (Test-Path -LiteralPath $zremoteRequired -PathType Container)) {
        throw "Required portable toolchain directory missing: $zremoteRequired"
    }
}
$env:Path = "$zremoteSwift;$zremoteCompiler;$zremoteVC\bin\Hostx64\x64;$env:Path"
$env:SDKROOT = $zremoteSDK
$env:INCLUDE = "$zremoteVC\include;$zremoteWindowsHeaders\ucrt;$zremoteWindowsHeaders\shared;$zremoteWindowsHeaders\um;$zremoteWindowsHeaders\winrt"
$env:LIB = "$zremoteVC\lib\onecore\x64;$zremoteVC\lib\x64;$zremoteWindowsLibraries\ucrt\x64;$zremoteWindowsLibraries\um\x64"
$env:ZREMOTE_CORE_ONLY = '1'
