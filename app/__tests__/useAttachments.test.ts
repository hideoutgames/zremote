import * as DocumentPicker from 'expo-document-picker';
import { InteractionManager } from 'react-native';
import {
  afterAttachMenuDismissed,
  pickFilesForChat,
  PICKER_MENU_DELAY_MS,
  stageDocumentPickerResult,
} from '../src/hooks/useAttachments';
import {
  draftStore,
  resetDrafts,
  stageAttachments,
} from '../src/zeron/state/draftStore';
import { MAX_ATTACHMENT_BYTES } from '../src/zeron/attachments/validate';

const getDocumentAsync = DocumentPicker.getDocumentAsync as jest.Mock;

const file = (name: string, size = 10) => ({
  name,
  uri: `file:///${name}`,
  mimeType: 'text/plain',
  size,
});

beforeEach(() => {
  resetDrafts();
  getDocumentAsync.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('stageDocumentPickerResult stages every returned asset', () => {
  const result = stageDocumentPickerResult('c1', {
    canceled: false,
    assets: [file('a.txt'), file('b.pdf'), file('c.json')],
  });
  expect(result.rejected).toEqual([]);
  expect(result.staged.map(a => a.name)).toEqual(['a.txt', 'b.pdf', 'c.json']);
  expect(draftStore.getState().byChat.c1.attachments.map(a => a.name)).toEqual([
    'a.txt',
    'b.pdf',
    'c.json',
  ]);
});

test('an oversized sibling is rejected without dropping valid files', () => {
  const result = stageDocumentPickerResult('c1', {
    canceled: false,
    assets: [
      file('ok.txt'),
      file('huge.bin', MAX_ATTACHMENT_BYTES + 1),
      file('also.txt'),
    ],
  });
  expect(result.rejected).toEqual([{ name: 'huge.bin', reason: 'tooLarge' }]);
  expect(result.staged.map(a => a.name)).toEqual(['ok.txt', 'also.txt']);
  expect(draftStore.getState().byChat.c1.attachments.map(a => a.name)).toEqual([
    'ok.txt',
    'also.txt',
  ]);
});

test('canceled or missing assets stage nothing', () => {
  expect(
    stageDocumentPickerResult('c1', { canceled: true, assets: null }).staged,
  ).toEqual([]);
  expect(
    stageDocumentPickerResult('c1', { canceled: false, assets: null }).staged,
  ).toEqual([]);
  expect(draftStore.getState().byChat.c1).toBeUndefined();
});

test('pickFilesForChat requests multiple */* files and stages all assets', async () => {
  getDocumentAsync.mockResolvedValue({
    canceled: false,
    assets: [file('one.md'), file('two.md')],
  });
  const result = await pickFilesForChat('c1');
  expect(getDocumentAsync).toHaveBeenCalledWith({
    type: ['*/*'],
    multiple: true,
    copyToCacheDirectory: true,
  });
  expect(result.staged.map(a => a.name)).toEqual(['one.md', 'two.md']);
});

test('stageAttachments concatenates batches instead of replacing', () => {
  stageAttachments('c1', [
    {
      kind: 'file',
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 1,
      localUri: 'file:///a.txt',
    },
  ]);
  stageAttachments('c1', [
    {
      kind: 'file',
      name: 'b.txt',
      mimeType: 'text/plain',
      size: 1,
      localUri: 'file:///b.txt',
    },
    {
      kind: 'file',
      name: 'c.txt',
      mimeType: 'text/plain',
      size: 1,
      localUri: 'file:///c.txt',
    },
  ]);
  expect(draftStore.getState().byChat.c1.attachments.map(a => a.name)).toEqual([
    'a.txt',
    'b.txt',
    'c.txt',
  ]);
});

test('afterAttachMenuDismissed waits for interactions and the menu delay', async () => {
  jest.useFakeTimers();
  const runAfter = jest
    .spyOn(InteractionManager, 'runAfterInteractions')
    .mockImplementation(task => {
      const fn = typeof task === 'function' ? task : task?.gen;
      fn?.();
      return {
        then: onF => onF?.() as never,
        done: () => {},
        cancel: () => {},
      };
    });
  const run = jest.fn().mockResolvedValue('ok');
  const pending = afterAttachMenuDismissed(run);
  expect(run).not.toHaveBeenCalled();
  jest.advanceTimersByTime(PICKER_MENU_DELAY_MS - 1);
  expect(run).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  await expect(pending).resolves.toBe('ok');
  runAfter.mockRestore();
  jest.useRealTimers();
});
