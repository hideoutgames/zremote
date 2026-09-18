// Local config plugin (docs/COMPATIBILITY.md "Native project strategy" #2):
// the fork's Podfile carries `pod 'SDWebImage', :modular_headers => true`
// for react-native-nitro-web-image. Re-encodes that customization into CNG,
// and adds the loro-swift binding as its own plain-Swift pod (see
// modules/react-native-loro/vendor/LoroSwift.podspec for why it is separate).
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const LINES = [
  "  pod 'SDWebImage', :modular_headers => true",
  "  pod 'LoroSwift', :path => '../modules/react-native-loro/vendor'",
];

/** Insert the extra pods inside the app target, idempotently. */
const insert = contents => {
  const lines = contents.split('\n');
  const idx = lines.findIndex(l => /^\s*target\s+'[^']+'\s+do\s*$/.test(l));
  if (idx === -1) {
    throw new Error(
      'withPodfileMods: no `target ... do` line found in Podfile',
    );
  }
  const missing = LINES.filter(l => !contents.includes(l.trim()));
  lines.splice(idx + 1, 0, ...missing);
  return lines.join('\n');
};

module.exports = config =>
  withDangerousMod(config, [
    'ios',
    async cfg => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfile, 'utf8');
      fs.writeFileSync(podfile, insert(contents));
      return cfg;
    },
  ]);
