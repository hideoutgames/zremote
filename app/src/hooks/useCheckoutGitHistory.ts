// ListGitHistory for the session checkout. Used by the PR Discussion and
// Commits tabs — repo history on the host, not a GitHub PR commit list.

import { useEffect, useReducer } from 'react';
import { useRuntime } from '../app/runtimeContext';
import { useChat } from '../zeron/state/workspaceStore';
import {
  gitHistoryClient,
  historyReducer,
  type HistoryState,
} from '../zeron/history/history';

const idle: HistoryState = {
  commits: [],
  query: '',
  loading: false,
};

export const useCheckoutGitHistory = (chatId: string): HistoryState => {
  const runtime = useRuntime();
  const chat = useChat(chatId);
  const cwd = chat?.cwd;
  const deviceId = chat?.deviceId;
  const [state, dispatch] = useReducer(historyReducer, idle);

  useEffect(() => {
    if (
      runtime === null ||
      deviceId === undefined ||
      cwd === undefined ||
      cwd === ''
    ) {
      return;
    }
    let cancelled = false;
    dispatch({ type: 'loading' });
    gitHistoryClient(runtime.relayFor(deviceId))
      .list(cwd, 0, 100)
      .then(page => {
        if (!cancelled) dispatch({ type: 'page', page, append: false });
      })
      .catch(e => {
        if (!cancelled)
          dispatch({ type: 'error', message: String(e?.message ?? e) });
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, deviceId, cwd]);

  return state;
};
