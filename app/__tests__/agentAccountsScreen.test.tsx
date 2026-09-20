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
import { demoAccounts } from '../src/demo/fixtures';

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
      return demoAccounts();
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
