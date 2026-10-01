# Process-scoped portable toolchain; does not modify the user's PATH.
# Dot-source before invoking the resource runner / cargo on Windows.
$ErrorActionPreference = 'Stop'
$rustBin = Join-Path $env:LOCALAPPDATA 'ZRemote\toolchains\rust-1.98.1-gnu\bin'
$mingwBin = Join-Path $env:LOCALAPPDATA 'ZRemote\toolchains\llvm-mingw-20260922-msvcrt-x86_64\bin'
if (!(Test-Path -LiteralPath (Join-Path $rustBin 'rustc.exe'))) {
    throw 'Portable Rust 1.98.1 GNU is not installed in the ZRemote toolchain directory.'
}
if (!(Test-Path -LiteralPath (Join-Path $mingwBin 'x86_64-w64-mingw32-clang.exe'))) {
    throw 'Portable LLVM-MinGW 20260922 MSVCRT is not installed in the ZRemote toolchain directory.'
}
$env:PATH = "$rustBin;$mingwBin;$env:PATH"
$env:CARGO_HOME = Join-Path $env:LOCALAPPDATA 'ZRemote\cache\cargo-home'
$env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA 'ZRemote\cache\cargo'
$env:CARGO_BUILD_JOBS = '1'
$env:CARGO_PROFILE_DEV_DEBUG = '0'
$env:CARGO_PROFILE_TEST_DEBUG = '0'
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = Join-Path $mingwBin 'x86_64-w64-mingw32-clang.exe'
$rustRuntime = [System.IO.Path]::GetFullPath((Join-Path $rustBin '..\lib\rustlib\x86_64-pc-windows-gnu\lib\self-contained'))
# LLVM lld handles the large UniFFI executable's relocations; Rust supplies its
# matching GCC unwind runtime, which LLVM-MinGW does not package.
$env:RUSTFLAGS = '-C link-self-contained=yes -L native=' + $rustRuntime
$env:CC = Join-Path $mingwBin 'x86_64-w64-mingw32-clang.exe'
$env:CXX = Join-Path $mingwBin 'x86_64-w64-mingw32-clang++.exe'
$env:AR = Join-Path $mingwBin 'llvm-ar.exe'
