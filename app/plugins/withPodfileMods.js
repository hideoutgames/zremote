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

// Some pods declare a minimum iOS lower than the app (e.g.
// react-native-ios-context-menu uses RN's min_ios_version_supported and
// then calls iOS-16+ APIs like MenuElement subtitle). Clamp every pod
// target to the app deployment target.
const POST_INSTALL_DEPLOYMENT_TARGET = [
  '    installer.pods_project.targets.each do |target|',
  '      target.build_configurations.each do |config|',
  "        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = podfile_properties['ios.deploymentTarget'] || '16.4'",
  '      end',
  '    end',
];

/** Append the deployment-target clamp inside the app target's
 * `post_install` hook, idempotently. */
const insertDeploymentTargetClamp = contents => {
  if (contents.includes(POST_INSTALL_DEPLOYMENT_TARGET[1])) return contents;
  const lines = contents.split('\n');
  const idx = lines.findIndex(l =>
    /^\s*post_install do \|installer\|\s*$/.test(l),
  );
  if (idx === -1) {
    throw new Error(
      'withPodfileMods: no `post_install do |installer|` line found in Podfile',
    );
  }
  lines.splice(idx + 1, 0, ...POST_INSTALL_DEPLOYMENT_TARGET);
  return lines.join('\n');
};

module.exports = config =>
  withDangerousMod(config, [
    'ios',
    async cfg => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfile, 'utf8');
      fs.writeFileSync(podfile, insertDeploymentTargetClamp(insert(contents)));
      return cfg;
    },
  ]);
