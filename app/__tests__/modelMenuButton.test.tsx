import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ModelMenuButton } from '../src/components/ModelMenuButton';
import { imageForHarness } from '../src/components/harnessBrand';
import { t } from '../src/i18n/strings';
import { darkTheme, lightTheme } from '../src/theme';

const sourceUri = (source: unknown): string => {
  if (source !== undefined && typeof source === 'object' && source !== null) {
    if ('testUri' in source)
      return String((source as { testUri: string }).testUri);
    if ('uri' in source) return String((source as { uri?: string }).uri);
  }
  return String(source);
};

test('imageForHarness maps known ids and ignores unknown', () => {
  expect(sourceUri(imageForHarness('claude-code'))).toContain('claude-mark');
  expect(sourceUri(imageForHarness('codex'))).toContain('openai-mark');
  expect(imageForHarness('unknown-harness')).toBeUndefined();
  expect(imageForHarness(undefined)).toBeUndefined();
});

test('ModelMenuButton lists models with provider images and More', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <ModelMenuButton
        harnessId="claude-code"
        modelLabel="Sonnet"
        items={[
          {
            harness: 'claude-code',
            model: 'sonnet',
            label: 'Sonnet',
            harnessName: 'Claude',
          },
          {
            harness: 'codex',
            model: 'gpt-5',
            label: 'GPT-5',
            harnessName: 'Codex',
          },
        ]}
        onPick={() => {}}
        onMore={() => {}}
      />,
    );
  });
  const titles = tree!.root.findAllByType(Text).flatMap(n => {
    const c = n.props.children;
    return typeof c === 'string' ? [c] : [];
  });
  expect(titles).toContain('Sonnet');
  expect(titles).toContain('GPT-5');
  expect(titles).toContain(t('picker.more'));
  const images = tree!.root.findAll(
    n => n.props.testID === 'DropdownItemImage',
  );
  const uris = images
    .map(n => sourceUri(n.props.source))
    .filter(u => u !== 'undefined');
  expect(uris.some(u => u.includes('claude-mark'))).toBe(true);
  expect(uris.some(u => u.includes('openai-mark'))).toBe(true);
  const tint = new Set([darkTheme.text, lightTheme.text]);
  for (const image of images) {
    expect(image.props.width).toBe(18);
    expect(image.props.height).toBe(18);
    expect(image.props.ios.style.renderingMode).toBe('alwaysTemplate');
    expect(tint.has(image.props.ios.style.tint)).toBe(true);
  }
  await act(async () => {
    tree?.unmount();
  });
});
