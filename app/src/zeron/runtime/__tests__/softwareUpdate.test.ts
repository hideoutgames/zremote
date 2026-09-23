import {
  isRemoteApplyUnsupported,
  remoteApplySupported,
  updateInstalled,
} from '../softwareUpdate';
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

describe('remoteApplySupported', () => {
  // crates/update managed_updates_supported: symlink-managed installs exist
  // only on Unix — Windows hosts always refuse ApplyUpdate.
  test('is false on Windows hosts only', () => {
    expect(remoteApplySupported('windows')).toBe(false);
    expect(remoteApplySupported('macos')).toBe(true);
    expect(remoteApplySupported('linux')).toBe(true);
    expect(remoteApplySupported('darwin')).toBe(true);
    expect(remoteApplySupported('')).toBe(true);
  });
});

describe('isRemoteApplyUnsupported', () => {
  test('matches the host bail for non-managed installs', () => {
    expect(
      isRemoteApplyUnsupported(
        'this install is not update-managed — the desktop app updates from its UI; source builds update via git',
      ),
    ).toBe(true);
    expect(isRemoteApplyUnsupported('updates unavailable')).toBe(false);
    expect(isRemoteApplyUnsupported("The device didn't respond")).toBe(false);
  });
});
