import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ModelMenuButton } from '../src/components/ModelMenuButton';
import { imageForHarness } from '../src/components/harnessBrand';
import { t } from '../src/i18n/strings';

test('imageForHarness maps known ids and ignores unknown', () => {
  expect(imageForHarness('claude-code')).toEqual(expect.any(Number));
  expect(imageForHarness('codex')).toEqual(expect.any(Number));
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
  const titles = tree!.root
    .findAll(n => n.type === 'Text')
    .map(n => n.props.children);
  expect(titles).toContain('Sonnet');
  expect(titles).toContain('GPT-5');
  expect(titles).toContain(t('picker.more'));
  expect(
    tree!.root.findAll(n => n.props.testID === 'DropdownItemImage'),
  ).toHaveLength(2);
  await act(async () => {
    tree?.unmount();
  });
});
