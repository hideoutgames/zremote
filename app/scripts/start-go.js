// Expo Go preview launcher (Windows-safe — no cross-env).
//   node scripts/start-go.js          → expo start --go --clear
//   node scripts/start-go.js --export → expo export --platform ios
// Both set EXPO_GO=1 so metro.config.js resolves the src/expoGo shims.

const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const appDir = join(__dirname, '..');
// Run the CLI JS entry through the current node — .cmd shims need a shell
// on Windows (spawn EINVAL) and a shell would mangle quoting.
const expoCli = join(appDir, 'node_modules', 'expo', 'bin', 'cli');

const isExport = process.argv.includes('--export');
const args = isExport
  ? ['export', '--platform', 'ios', '--output-dir', '.expo-go-export']
  : [
      'start',
      '--go',
      '--clear',
      ...process.argv.slice(2).filter(a => a !== '--export'),
    ];

const env = { ...process.env, EXPO_GO: '1' };
const result = spawnSync(process.execPath, [expoCli, ...args], {
  cwd: appDir,
  env,
  stdio: 'inherit',
});
if (result.error) {
  console.error(`expo launch failed: ${result.error.message}`);
}
process.exit(result.status ?? 1);
