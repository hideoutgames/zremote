// Windows iOS prebuild runner (docs/COMPATIBILITY.md "Native project
// strategy"): `npx expo prebuild --platform ios` skips iOS on win32
// (@expo/cli resolveOptions.ensureValidPlatforms). The skip exists because
// `pod install` can't run here — but with `--no-install` the template copy +
// config-plugin mods are pure JS and DO run on Windows. This loader patches
// just that check in memory (node_modules untouched, process.platform left
// alone so native modules like sharp still resolve win32 binaries).
//
// Usage: node scripts/prebuild-ios-windows.js [--clean]
const Module = require('node:module');
const fs = require('node:fs');

const origJs = Module._extensions['.js'];
Module._extensions['.js'] = function (module, filename) {
  if (/prebuild[\\/]resolveOptions\.js$/.test(filename)) {
    const src = fs
      .readFileSync(filename, 'utf8')
      .replaceAll(
        "process.platform === 'win32'",
        'false /* prebuild-ios-windows */',
      );
    module._compile(src, filename);
    return;
  }
  origJs(module, filename);
};

const extra = process.argv.slice(2);
process.argv = [
  process.argv[0],
  'expo',
  'prebuild',
  '--platform',
  'ios',
  '--no-install',
  ...extra,
];
require('expo/bin/cli');
