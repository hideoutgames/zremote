import {
  getSessionStore,
  recordFailedSend,
  dismissFailedSend,
  resetSessionStores,
} from '../sessionStores';
import { draftStore, resetDrafts } from '../draftStore';

beforeEach(() => {
  resetSessionStores();
  resetDrafts();
});

test('recordFailedSend auto-restores an empty draft; dismiss drops the banner', () => {
  recordFailedSend('c1', {
    messageId: 'm1',
    text: 'hello',
    at: 1,
    started: 1,
    commandId: 'cmd',
    status: 'rejected',
  });
  expect(draftStore.getState().byChat.c1?.text).toBe('hello');
  expect(getSessionStore('c1').getState().failedSends).toHaveLength(1);
  dismissFailedSend('c1', 'm1');
  expect(getSessionStore('c1').getState().failedSends).toEqual([]);
  expect(draftStore.getState().byChat.c1?.text).toBe('hello');
});
