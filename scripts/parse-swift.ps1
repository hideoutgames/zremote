param([Parameter(Mandatory = $true)][string[]]$Path)
$ErrorActionPreference = 'Stop'
$toolRoot = Join-Path $env:LOCALAPPDATA 'ZRemote\toolchains\swift-portable'
$swiftBin = Join-Path $toolRoot 'Toolchains\6.4.0+NoAsserts\usr\bin'
$compiler = Join-Path $swiftBin 'swiftc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    throw 'Swift compiler unavailable. Install Swift 6.4 or set up the documented portable toolchain.'
}
$priorPath = $env:PATH
try {
    $env:PATH = "$toolRoot;$swiftBin;$priorPath"
    foreach ($source in $Path) {
        $absolute = (Resolve-Path -LiteralPath $source).Path
        & $compiler -frontend -parse $absolute
        if ($LASTEXITCODE -ne 0) { throw "Swift syntax failed: $source" }
        Write-Output "Parsed $source"
    }
} finally {
    $env:PATH = $priorPath
}
