import { demoDevices, demoPaths, demoRegistryRows } from '../src/demo/fixtures';

test('demo fixtures use generic host and harbor-notes project names', () => {
  expect(demoDevices.live.name).toBe('Studio MacBook Pro');
  expect(demoDevices.live.name.includes('Torea')).toBe(false);
  expect(demoPaths.babylon).toBe('/demo/code/harbor-notes');
  const blob = JSON.stringify(demoRegistryRows(Date.now()));
  expect(blob).not.toMatch(/Torea/);
  expect(blob).not.toMatch(/babylon-slate/i);
  expect(blob).not.toMatch(/Babylon/);
  expect(blob).toMatch(/harbor-notes/);
  expect(blob).toMatch(/Harbor notes/);
});
