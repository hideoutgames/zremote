// Host software update (crates/engine/src/rpc.rs ApplyUpdate,
// crates/update Updater::apply). The engine's forward deadline for this
// method is 15 minutes: the reply arrives only after the release is
// downloaded and the symlink is swapped. A shorter client timeout closes
// the device-room socket, and the host aborts the in-flight task.

import type { UpdateStatus } from '../protocol/types';

/** Match `forward_deadline(ApplyUpdate)` so the phone does not abort the host. */
export const APPLY_UPDATE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * After ApplyUpdate returns, the service restarts (~800ms later) and the
 * new process publishes `currentVersion`. Stop waiting if that never arrives.
 */
export const APPLY_RESTART_WAIT_MS = 90_000;

/** Pause before reopening UpdateStatus after the stream ends (host restart). */
export const UPDATE_STATUS_RETRY_MS = 1_000;

/**
 * The restarted host reports the applied version as `currentVersion`
 * immediately. The 6-hour checker is not required, and `updateAvailable`
 * may still be set on a stale frame.
 */
export const updateInstalled = (
  status: UpdateStatus,
  version: string,
): boolean => status.currentVersion === version;
