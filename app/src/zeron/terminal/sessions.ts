// In-memory PTY tabs keyed by chatId. Detach on sheet dismiss keeps the
// host shell alive; reopening resubscribes from lastSeq instead of
// OpenTerminal'ing a new one.

import type { TerminalClient } from './client';
import type { AnsiScreen } from './ansi';

export interface TerminalTab {
  client: TerminalClient;
  screen: AnsiScreen;
  exited: boolean;
  exitCode?: number;
}

const tabsByChat = new Map<string, TerminalTab[]>();

export const loadTerminalTabs = (chatId: string): TerminalTab[] =>
  tabsByChat.get(chatId) ?? [];

export const saveTerminalTabs = (
  chatId: string,
  tabs: readonly TerminalTab[],
): void => {
  if (tabs.length === 0) tabsByChat.delete(chatId);
  else tabsByChat.set(chatId, [...tabs]);
};

export const resetTerminalTabsForTests = (): void => {
  tabsByChat.clear();
};
