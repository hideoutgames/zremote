import {
  changeRequestStore,
  effectiveChangeRequest,
  setChangeRequestForChat,
  setDetectedChangeRequestsForChat,
} from '../changeRequestStore';
import type { ChangeRequestSummary } from '../../protocol/types';

const summary = (
  over: Partial<ChangeRequestSummary> = {},
): ChangeRequestSummary => ({
  provider: 'github',
  number: 7,
  title: 'Real title',
  url: 'https://github.com/acme/app/pull/7',
  state: 'open',
  baseRef: 'main',
  headRef: 'feat',
  ...over,
});

afterEach(() => {
  changeRequestStore.setState({
    byChat: {},
    diffByChat: {},
    detectedByChat: {},
  });
});

test('a placeholder checkout does not hide a linked pull request', () => {
  setChangeRequestForChat('c', {
    checkoutId: 'ck',
    deviceId: 'h',
    cwd: '/repo',
    branch: 'feat',
    changeRequest: summary({
      number: 0,
      url: '',
      title: '',
      baseRef: '',
      headRef: '',
    }),
    updatedAt: 't',
  });
  setDetectedChangeRequestsForChat('c', [
    summary({
      number: 4,
      title: 'app',
      url: 'https://github.com/acme/app/pull/4',
      baseRef: '',
      headRef: '',
    }),
  ]);
  expect(
    effectiveChangeRequest(changeRequestStore.getState(), 'c')?.number,
  ).toBe(4);
});

test('a closed checkout yields to an open link from the thread', () => {
  setChangeRequestForChat('c', {
    checkoutId: 'ck',
    deviceId: 'h',
    cwd: '/repo',
    branch: 'feat',
    changeRequest: summary({ state: 'closed' }),
    updatedAt: 't',
  });
  setDetectedChangeRequestsForChat('c', [
    summary({
      number: 8,
      title: 'Follow-up',
      url: 'https://github.com/acme/app/pull/8',
      baseRef: '',
      headRef: '',
    }),
  ]);
  expect(
    effectiveChangeRequest(changeRequestStore.getState(), 'c')?.number,
  ).toBe(8);
});
