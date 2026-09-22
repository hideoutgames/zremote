// AgentAccountsScreen: filled settings-cell cards, ListAgentAccounts with
// forceUsage on mount, meters from usageWindows.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { AgentAccountsScreen } from '../src/screens/AgentAccountsScreen';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import { settingsCellBackground } from '../src/components/settings/SettingsList';
import { darkTheme, lightTheme } from '../src/theme';
import { METHODS } from '../src/zeron/protocol/rpc';
import * as WebBrowser from 'expo-web-browser';
import { TextInput } from 'react-native';
import type { AgentAccountsSnapshot } from '../src/zeron/protocol/types';

const sampleAccounts = (): AgentAccountsSnapshot => ({
  accounts: [
    {
      id: 'acct-claude',
      harness: 'claude-code',
      email: 'demo@example.test',
      planLabel: 'Demo plan',
      active: true,
      usageWindows: [
        { label: 'Session', usedFraction: 0.18 },
        {
          label: 'Weekly',
          usedFraction: 0.42,
          resetsAt: '2026-01-15T18:30:00Z',
        },
      ],
      displayName: 'Demo User',
      authKind: 'oauth',
      switchable: true,
      savedAt: 1_760_000_000_000,
    },
  ],
  warnings: [],
});

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

let tree: TestRenderer.ReactTestRenderer | undefined;

const renderScreen = async (runtime: AppServices['runtime']) => {
  const services: AppServices = {
    auth: null as never,
    runtime,
    openSession: () => {},
    signOut: async () => {},
  };
  await act(async () => {
    tree = TestRenderer.create(
      <AppServicesContext.Provider value={services}>
        <AgentAccountsScreen deviceId="host1" />
      </AppServicesContext.Provider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return tree!;
};

beforeEach(() => {
  (WebBrowser.openBrowserAsync as jest.Mock).mockClear();
});

afterEach(() => {
  act(() => {
    tree?.unmount();
  });
  tree = undefined;
});

test('provider cards use the settings cell fill, not an outline', async () => {
  const mounted = await renderScreen(null);
  const cards = mounted.root.findAll(
    n => n.props.testID === 'agent-account-card' && typeof n.type === 'string',
  );
  expect(cards.length).toBe(3);
  const fills = [
    settingsCellBackground(lightTheme),
    settingsCellBackground(darkTheme),
  ];
  for (const card of cards) {
    const style = StyleSheet.flatten(card.props.style);
    expect(fills).toContain(style.backgroundColor);
    expect(style.borderWidth ?? 0).toBe(0);
  }
});

test('mount lists accounts with forceUsage and renders meters', async () => {
  const call = jest.fn(
    async (method: string, params: { forceUsage?: boolean }) => {
      expect(method).toBe(METHODS.LIST_AGENT_ACCOUNTS);
      expect(params.forceUsage).toBe(true);
      return sampleAccounts();
    },
  );
  const runtime = {
    relayFor: () => ({ call }),
  } as never;
  const mounted = await renderScreen(runtime);
  expect(call).toHaveBeenCalledTimes(1);
  const text = allText(mounted.root);
  expect(text).toContain('Demo User');
  expect(text).toContain('Session');
  expect(text).toContain('18%');
  expect(text).toContain('Weekly');
  expect(text).toContain('42%');
  expect(
    mounted.root.findAll(
      n => n.props.testID === 'agent-usage-meter' && typeof n.type === 'string',
    ).length,
  ).toBe(2);
});

const pressByLabel = (root: TestRenderer.ReactTestInstance, label: string) => {
  const btn = root.find(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  );
  return btn.props.onPress as () => void;
};

test('add account sends the engine harness id and completes a paste-code login', async () => {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const call = jest.fn(
    async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === METHODS.LIST_AGENT_ACCOUNTS)
        return { accounts: [], warnings: [] };
      if (method === METHODS.START_AGENT_LOGIN)
        return {
          loginId: 'login-1',
          url: 'https://provider.example/login',
          mode: 'paste-code',
        };
      if (method === METHODS.COMPLETE_AGENT_LOGIN) return {};
      if (method === METHODS.CANCEL_AGENT_LOGIN) return {};
      throw new Error(`unexpected ${method}`);
    },
  );
  const runtime = { relayFor: () => ({ call }) } as never;
  const mounted = await renderScreen(runtime);

  await act(async () => {
    pressByLabel(mounted.root, 'Add account Claude Code')();
    await Promise.resolve();
  });
  expect(call).toHaveBeenCalledWith(METHODS.START_AGENT_LOGIN, {
    harness: 'claude-code',
  });
  // The provider page opens once so the user can copy the code.
  expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(1);
  expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
    'https://provider.example/login',
  );

  const input = mounted.root.findByType(TextInput);
  await act(async () => {
    input.props.onChangeText('  code-abc  ');
  });
  await act(async () => {
    pressByLabel(mounted.root, 'Complete sign-in')();
    await Promise.resolve();
  });
  expect(call).toHaveBeenCalledWith(METHODS.COMPLETE_AGENT_LOGIN, {
    loginId: 'login-1',
    code: 'code-abc',
  });
  // Post-login re-list probes usage (forceUsage).
  const listCalls = calls.filter(c => c.method === METHODS.LIST_AGENT_ACCOUNTS);
  expect(listCalls.length).toBe(2);
  expect(listCalls[1].params).toEqual({ forceUsage: true });
});

test('browser-mode login polls and only re-opens a changed url', async () => {
  let polls = 0;
  const call = jest.fn(
    async (method: string, _params: Record<string, unknown>) => {
      if (method === METHODS.LIST_AGENT_ACCOUNTS)
        return { accounts: [], warnings: [] };
      if (method === METHODS.START_AGENT_LOGIN)
        return {
          loginId: 'login-2',
          url: 'https://provider.example/a',
          mode: 'browser',
        };
      if (method === METHODS.POLL_AGENT_LOGIN) {
        polls += 1;
        return {
          status: 'pending',
          url:
            polls < 3
              ? 'https://provider.example/a'
              : 'https://provider.example/b',
        };
      }
      if (method === METHODS.CANCEL_AGENT_LOGIN) return {};
      throw new Error(`unexpected ${method}`);
    },
  );
  const runtime = { relayFor: () => ({ call }) } as never;
  const mounted = await renderScreen(runtime);

  jest.useFakeTimers();
  try {
    await act(async () => {
      pressByLabel(mounted.root, 'Add account Claude Code')();
    });
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(1);

    // Three poll ticks: the repeated URL does not re-open; the changed one
    // opens exactly once more.
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(polls).toBeGreaterThanOrEqual(3);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(2);
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(
      'https://provider.example/b',
    );
  } finally {
    jest.useRealTimers();
  }

  // Unmounting mid-flow cancels the host-side login.
  const cancelCalls = call.mock.calls.filter(
    c => c[0] === METHODS.CANCEL_AGENT_LOGIN,
  );
  expect(cancelCalls.length).toBe(0);
  await act(async () => {
    tree?.unmount();
    tree = undefined;
  });
  expect(
    call.mock.calls.filter(c => c[0] === METHODS.CANCEL_AGENT_LOGIN).length,
  ).toBe(1);
});
