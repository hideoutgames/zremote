// Local question-banner policy: working → awaitingInput while the app is
// active and that thread is not selected. Lock-screen coverage is the
// edge APNs producer (patch 0003).

import { shouldPresentBanner } from './presentation';

export const QUESTION_ALERT_BODY = 'The agent needs your input';

export const isQuestionFlip = (
  prevStatus: string | undefined,
  status: string,
): boolean => prevStatus === 'working' && status === 'awaitingInput';

export const shouldLocalQuestionBanner = (a: {
  prevStatus: string | undefined;
  status: string;
  appState: string;
  selectedChatId: string | undefined;
  chatId: string;
}): boolean => {
  if (a.appState !== 'active') return false;
  if (!isQuestionFlip(a.prevStatus, a.status)) return false;
  return shouldPresentBanner({
    appState: a.appState,
    selectedChatId: a.selectedChatId,
    notificationChatId: a.chatId,
  });
};
