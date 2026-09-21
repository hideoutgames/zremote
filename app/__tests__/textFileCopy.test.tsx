import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import * as Clipboard from 'expo-clipboard';
import { TextFileSheet } from '../src/components/TextFileSheet';
import { FileEditorScreen } from '../src/screens/FileEditorScreen';
import { LocalLogsScreen } from '../src/screens/LocalLogsScreen';
import {
  formatLogStamp,
  installLocalLogWriter,
  LocalLogWriter,
  fileStamp,
} from '../src/zeron/diagnostics/localLogs';
import { memLocalLogFs } from '../src/zeron/testing/memLocalLogFs';
import {
  resetWorkspace,
  workspaceStore,
} from '../src/zeron/state/workspaceStore';
import type { WorkspaceFilesClient } from '../src/zeron/files/filesClient';

jest.mock('../src/zeron/native/fileText', () => ({
  readFileText: jest.fn(async () => 'preview body'),
}));

const clipboard = Clipboard.setStringAsync as jest.Mock;

let tree: TestRenderer.ReactTestRenderer | undefined;

afterEach(() => {
  act(() => {
    tree?.unmount();
  });
  tree = undefined;
  clipboard.mockClear();
  installLocalLogWriter(undefined);
  resetWorkspace();
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

test('attachment text preview copies the file body', async () => {
  await act(async () => {
    tree = TestRenderer.create(
      <TextFileSheet
        title="notes.txt"
        uri="file:///notes.txt"
        onDismiss={() => {}}
      />,
    );
  });
  await flush();
  const copy = tree!.root.findByProps({ testID: 'copy-text' });
  await act(async () => {
    copy.props.onPress();
  });
  expect(clipboard).toHaveBeenCalledWith('preview body');
});

test('workspace text editor copies the buffer and images do not', async () => {
  const client = {
    readFile: async () => ({
      checkoutId: 'co',
      path: 'notes.txt',
      text: 'hello file',
      size: 10,
      encoding: 'utf8' as const,
      truncated: false,
    }),
    readImage: async () => ({
      checkoutId: 'co',
      contentHash: 'h',
      mimeType: 'image/png',
      data: 'aaaa',
      nextOffset: 0,
      size: 4,
      done: true,
    }),
  } as unknown as WorkspaceFilesClient;

  await act(async () => {
    tree = TestRenderer.create(
      <FileEditorScreen
        client={client}
        target={{ chatId: 'c1' }}
        path="notes.txt"
        onClose={() => {}}
      />,
    );
  });
  await flush();
  const copy = tree!.root.findByProps({ testID: 'copy-text' });
  await act(async () => {
    copy.props.onPress();
  });
  expect(clipboard).toHaveBeenCalledWith('hello file');

  act(() => {
    tree?.unmount();
  });
  clipboard.mockClear();
  await act(async () => {
    tree = TestRenderer.create(
      <FileEditorScreen
        client={client}
        target={{ chatId: 'c1' }}
        path="pic.png"
        onClose={() => {}}
        image
      />,
    );
  });
  expect(tree!.root.findAll(n => n.props.testID === 'copy-text')).toHaveLength(
    0,
  );
});

test('local log viewer copies the text file', async () => {
  const at = Date.parse('2026-09-21T18:17:03Z');
  const name = `${fileStamp(at)}.txt`;
  const fs = memLocalLogFs();
  await fs.appendText(`/logs/c1/${name}`, 'run start chat=c1\n');
  installLocalLogWriter(
    new LocalLogWriter({
      fs,
      logsRoot: '/logs',
      enabled: () => true,
      sessionMode: 'doc',
      now: () => at,
    }),
  );
  workspaceStore.setState({
    devices: [],
    spaces: [],
    chats: [
      {
        id: 'c1',
        deviceId: 'host1',
        archived: false,
        createdAt: 1,
        title: 'Demo thread',
      },
    ],
    sessions: {},
    presence: {},
    connection: 'connected',
  });
  await act(async () => {
    tree = TestRenderer.create(<LocalLogsScreen />);
  });
  await flush();
  const folder = tree!.root.findAll(
    n =>
      typeof n.props.accessibilityLabel === 'string' &&
      n.props.accessibilityLabel.includes('Demo thread') &&
      typeof n.props.onPress === 'function',
  )[0];
  expect(folder).toBeDefined();
  await act(async () => {
    folder.props.onPress();
  });
  await flush();
  const when = formatLogStamp(at, Date.now());
  const fileRow = tree!.root.findAll(
    n =>
      n.props.accessibilityLabel === when &&
      typeof n.props.onPress === 'function',
  )[0];
  expect(fileRow).toBeDefined();
  await act(async () => {
    fileRow.props.onPress();
  });
  await flush();
  const copy = tree!.root.findByProps({ testID: 'copy-text' });
  await act(async () => {
    copy.props.onPress();
  });
  expect(clipboard).toHaveBeenCalledWith('run start chat=c1\n');
});
