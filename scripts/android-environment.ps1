# Dot-source to use the user-local toolchain without changing machine settings.
$zremoteToolRoot = Join-Path $env:LOCALAPPDATA 'ZRemote\toolchains'
$env:JAVA_HOME = Join-Path $zremoteToolRoot 'jdk-21.0.12.1+1'
$env:ANDROID_HOME = Join-Path $zremoteToolRoot 'android-sdk'
$env:GRADLE_USER_HOME = Join-Path $env:LOCALAPPDATA 'ZRemote\cache\gradle'
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$zremoteToolRoot\gradle-9.2.1\bin;$env:PATH"
