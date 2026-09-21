// Settings → desktop → Software Update: ApplyUpdate uses the host's
// 15-minute budget, the row throbs until the restarted host reports the
// new version, and a refusal is shown instead of a silent log.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, Alert, Text } from 'react-native';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { workspaceStore } from '../src/zeron/state/workspaceStore';
import { authStore } from '../src/zeron/state/authStore';
import { resetCatalog } from '../src/zeron/state/catalogStore';
import { uiPrefsStore } from '../src/zeron/state/uiPrefs';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import { METHODS } from '../src/zeron/protocol/rpc';
import type { DeviceRow, UpdateStatus } from '../src/zeron/protocol/types';
import {
  APPLY_RESTART_WAIT_MS,
  APPLY_UPDATE_TIMEOUT_MS,
} from '../src/zeron/runtime/softwareUpdate';

const device: DeviceRow = {
  id: 'host1',
  name: 'Studio Mac',
  platform: 'darwin',
  capabilities: ['terminal'],
  version: '0.2.72',
};

const available: UpdateStatus = {
  currentVersion: '0.2.72',
  latestVersion: '0.2.73',
  updateAvailable: true,
};

interface StatusStream {
  items: AsyncIterable<UpdateStatus>;
  cancel(): void;
}

/** Watch-shaped feed: the current frame is delivered on subscribe, then
 * every later `push`. */
const createFeed = () => {
  let current: UpdateStatus | undefined;
  const listeners = new Set<(status: UpdateStatus) => void>();
  return {
    push(status: UpdateStatus) {
      current = status;
      for (const listener of listeners) listener(status);
    },
    stream(): StatusStream {
      const queue: UpdateStatus[] = [];
      let wake: (() => void) | undefined;
      let finished = false;
      const enqueue = (status: UpdateStatus) => {
        queue.push(status);
        const resolve = wake;
        wake = undefined;
        resolve?.();
      };
      if (current !== undefined) enqueue(current);
      listeners.add(enqueue);
      const cancel = () => {
        finished = true;
        listeners.delete(enqueue);
        const resolve = wake;
        wake = undefined;
        resolve?.();
      };
      const items: AsyncIterable<UpdateStatus> = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              for (;;) {
                if (queue.length > 0) {
                  return { value: queue.shift() as UpdateStatus, done: false };
                }
                if (finished) return { value: undefined, done: true };
                await new Promise<void>(resolve => {
                  wake = resolve;
                  if (queue.length > 0 || finished) {
                    wake = undefined;
                    resolve();
                  }
                });
              }
            },
            async return() {
              cancel();
              return { value: undefined, done: true };
            },
          };
        },
      };
      return { items, cancel };
    },
  };
};

const flattenText = (c: unknown): string => {
  if (c == null || typeof c === 'boolean') return '';
  if (typeof c === 'string' || typeof c === 'number') return String(c);
  if (Array.isArray(c)) return c.map(flattenText).join('');
  if (typeof c === 'object' && c !== null && 'props' in c) {
    return flattenText((c as { props: { children?: unknown } }).props.children);
  }
  return '';
};

const allText = (root: TestRenderer.ReactTestInstance): string =>
  root
    .findAllByType(Text)
    .map(n => flattenText(n.props.children))
    .filter(s => s !== '')
    .join(' | ');

const spinnerCount = (root: TestRenderer.ReactTestInstance): number =>
  root
    .findAllByType(ActivityIndicator)
    .filter(n => n.props.testID === 'software-update-spinner').length;

let tree: TestRenderer.ReactTestRenderer | undefined;

const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

jest.useFakeTimers();

beforeEach(() => {
  authStore.setState({
    status: {
      state: 'signedIn',
      user: { id: 'u1', email: 'andre@example.com' },
      orgId: 'org',
    },
  });
  workspaceStore.setState({
    devices: [device],
    spaces: [],
    chats: [],
    sessions: {},
    presence: { host1: Date.now() },
    connection: 'connected',
    lastSyncAt: undefined,
  });
  uiPrefsStore.setState({
    newThreadComposerBackground: undefined,
    newThreadBackgroundEffect: 'none',
    colorScheme: 'system',
    sessionBackgroundBlur: false,
    voiceInputMode: 'dictation',
    voiceModelId: null,
    cleanupModelId: null,
    cleanupPromptOverride: null,
  });
  resetCatalog();
});

afterEach(() => {
  act(() => {
    tree?.unmount();
  });
  tree = undefined;
  jest.clearAllTimers();
  jest.restoreAllMocks();
  resetCatalog();
});

const renderDevicePage = async (
  call: jest.Mock,
  feed: ReturnType<typeof createFeed>,
) => {
  const runtime = {
    relayFor: () => ({
      call,
      stream: () => Promise.resolve(feed.stream()),
    }),
  } as unknown as AppServices['runtime'];
  const services: AppServices = {
    auth: null as never,
    runtime,
    openSession: () => {},
    signOut: async () => {},
  };
  await act(async () => {
    tree = TestRenderer.create(
      <AppServicesContext.Provider value={services}>
        <SettingsScreen onClose={() => {}} />
      </AppServicesContext.Provider>,
    );
  });
  const row = tree!.root.findByProps({ testID: 'settings-device-host1' });
  await act(async () => {
    row.props.onPress();
  });
  await flush();
  return tree!;
};

const pressApply = async (mounted: TestRenderer.ReactTestRenderer) => {
  const alert = jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _message, buttons) => {
      const apply = buttons?.find(button => button.text === 'Apply');
      apply?.onPress?.();
    });
  const row = mounted.root.findByProps({ testID: 'settings-software-update' });
  await act(async () => {
    row.props.onPress();
  });
  await flush();
  alert.mockRestore();
};

test('Apply waits out the download and clears when the new version is running', async () => {
  const feed = createFeed();
  feed.push(available);
  let resolveApply: (value: {
    ok: boolean;
    version: string;
  }) => void = () => {};
  const call = jest.fn(
    (method: string, _params: unknown, _opts?: { timeoutMs?: number }) => {
      if (method === METHODS.APPLY_UPDATE) {
        return new Promise(resolve => {
          resolveApply = resolve;
        });
      }
      if (method === METHODS.LIST_HARNESSES) return Promise.resolve([]);
      if (method === METHODS.LIST_AGENT_ACCOUNTS) {
        return Promise.resolve({ accounts: [], warnings: [] });
      }
      return Promise.resolve(undefined);
    },
  );
  const mounted = await renderDevicePage(call, feed);
  expect(allText(mounted.root)).toContain('Apply');

  await pressApply(mounted);

  expect(call).toHaveBeenCalledWith(
    METHODS.APPLY_UPDATE,
    {},
    {
      timeoutMs: APPLY_UPDATE_TIMEOUT_MS,
    },
  );
  expect(allText(mounted.root)).toContain('Updating…');
  expect(allText(mounted.root)).not.toContain('Apply');
  expect(spinnerCount(mounted.root)).toBe(1);
  expect(
    mounted.root.findByProps({ testID: 'settings-software-update' }).props
      .onPress,
  ).toBeUndefined();

  await act(async () => {
    resolveApply({ ok: true, version: '0.2.73' });
  });
  await flush();
  expect(allText(mounted.root)).toContain('Updating…');
  expect(spinnerCount(mounted.root)).toBe(1);

  await act(async () => {
    feed.push({
      currentVersion: '0.2.73',
      latestVersion: '0.2.73',
      updateAvailable: false,
    });
  });
  await flush();
  expect(allText(mounted.root)).toContain('Up to Date');
  expect(allText(mounted.root)).not.toContain('Updating…');
  expect(spinnerCount(mounted.root)).toBe(0);
});

test('a host refusal stops the throbber and shows the error', async () => {
  const feed = createFeed();
  feed.push(available);
  let rejectApply: (error: Error) => void = () => {};
  const call = jest.fn((method: string) => {
    if (method === METHODS.APPLY_UPDATE) {
      return new Promise((_resolve, reject) => {
        rejectApply = reject;
      });
    }
    if (method === METHODS.LIST_HARNESSES) return Promise.resolve([]);
    if (method === METHODS.LIST_AGENT_ACCOUNTS) {
      return Promise.resolve({ accounts: [], warnings: [] });
    }
    return Promise.resolve(undefined);
  });
  const mounted = await renderDevicePage(call, feed);
  await pressApply(mounted);

  const message =
    'this install is not update-managed — the desktop app updates from its UI';
  await act(async () => {
    rejectApply(new Error(message));
  });
  await flush();

  const text = allText(mounted.root);
  expect(text).toContain(message);
  expect(text).toContain('Apply');
  expect(text).not.toContain('Updating…');
  expect(spinnerCount(mounted.root)).toBe(0);
  expect(
    mounted.root.findByProps({ testID: 'settings-software-update' }).props
      .onPress,
  ).toEqual(expect.any(Function));
});

test('the throbber stops if the restarted host never reports the new version', async () => {
  const feed = createFeed();
  feed.push(available);
  let resolveApply: (value: {
    ok: boolean;
    version: string;
  }) => void = () => {};
  const call = jest.fn((method: string) => {
    if (method === METHODS.APPLY_UPDATE) {
      return new Promise(resolve => {
        resolveApply = resolve;
      });
    }
    if (method === METHODS.LIST_HARNESSES) return Promise.resolve([]);
    if (method === METHODS.LIST_AGENT_ACCOUNTS) {
      return Promise.resolve({ accounts: [], warnings: [] });
    }
    return Promise.resolve(undefined);
  });
  const mounted = await renderDevicePage(call, feed);
  await pressApply(mounted);
  await act(async () => {
    resolveApply({ ok: true, version: '0.2.73' });
  });
  await flush();
  expect(allText(mounted.root)).toContain('Updating…');

  await act(async () => {
    jest.advanceTimersByTime(APPLY_RESTART_WAIT_MS);
  });
  await flush();

  expect(allText(mounted.root)).toContain('Apply');
  expect(allText(mounted.root)).toContain('Update Available');
  expect(allText(mounted.root)).not.toContain('Updating…');
  expect(spinnerCount(mounted.root)).toBe(0);
});
