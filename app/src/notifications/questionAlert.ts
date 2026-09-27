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

/**
 * App-detected questions (AskQuestion and the other unbrokered ask tools)
 * never flip the session row, so the edge cannot push for them. Notify when
 * a new question id appears after the first observation of that chat.
 * Host `input` questions already get an APNs alert once the app is not
 * active — don't schedule a second local one. Leaving the foreground
 * delivers a question that was suppressed because that thread was on screen.
 */
export const shouldNotifyOpenQuestion = (a: {
  baseline: boolean;
  alreadyNotified: boolean;
  questionId: string | undefined;
  prevQuestionId: string | undefined;
  kind: 'input' | 'tool' | 'text' | undefined;
  appState: string;
  selectedChatId: string | undefined;
  chatId: string;
  leavingForeground: boolean;
}): boolean => {
  if (a.baseline || a.alreadyNotified || a.questionId === undefined)
    return false;
  // The panel is gone. A foreground APNs alert for an `input` question was
  // already swallowed by the presentation handler while this thread was open.
  if (a.leavingForeground) return true;
  if (a.questionId === a.prevQuestionId) return false;
  if (a.kind === 'input' && a.appState !== 'active') return false;
  return shouldPresentBanner({
    appState: a.appState,
    selectedChatId: a.selectedChatId,
    notificationChatId: a.chatId,
  });
};
