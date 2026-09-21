import { updateInstalled } from '../softwareUpdate';
import type { UpdateStatus } from '../../protocol/types';

const status = (patch: Partial<UpdateStatus>): UpdateStatus => ({
  currentVersion: '0.2.72',
  updateAvailable: false,
  ...patch,
});

describe('updateInstalled', () => {
  test('matches the version ApplyUpdate returned', () => {
    expect(
      updateInstalled(
        status({ currentVersion: '0.2.73', latestVersion: '0.2.73' }),
        '0.2.73',
      ),
    ).toBe(true);
  });

  test('is false while the host is still on the old version', () => {
    expect(
      updateInstalled(
        status({
          currentVersion: '0.2.72',
          latestVersion: '0.2.73',
          updateAvailable: true,
        }),
        '0.2.73',
      ),
    ).toBe(false);
  });

  test('does not wait for the update-available flag to clear', () => {
    expect(
      updateInstalled(
        status({
          currentVersion: '0.2.73',
          latestVersion: '0.2.74',
          updateAvailable: true,
        }),
        '0.2.73',
      ),
    ).toBe(true);
  });
});
