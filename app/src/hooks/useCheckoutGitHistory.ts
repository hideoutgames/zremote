// ListGitHistory for the session checkout. Used by the PR commits tab —
// repo history on the host, not a GitHub pull-request commit list.

import { useCallback, useEffect, useReducer, useRef } from 'react';
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

export const useCheckoutGitHistory = (
  chatId: string,
): HistoryState & { loadMore: () => void } => {
  const runtime = useRuntime();
  const chat = useChat(chatId);
  const cwd = chat?.cwd;
  const deviceId = chat?.deviceId;
  const [state, dispatch] = useReducer(historyReducer, idle);
  const nextCursor = useRef<number | undefined>(undefined);
  const loadMoreRef = useRef<() => void>(() => {});

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
    let pending = false;
    nextCursor.current = undefined;
    const load = (cursor: number, append: boolean): void => {
      if (cancelled || pending) return;
      pending = true;
      dispatch({ type: 'loading' });
      gitHistoryClient(runtime.relayFor(deviceId))
        .list(cwd, cursor, 100)
        .then(page => {
          if (cancelled) return;
          nextCursor.current = page.nextCursor;
          dispatch({ type: 'page', page, append });
        })
        .catch(e => {
          if (cancelled) return;
          dispatch({ type: 'error', message: String(e?.message ?? e) });
        })
        .finally(() => {
          pending = false;
        });
    };
    load(0, false);
    loadMoreRef.current = () => {
      if (nextCursor.current === undefined) return;
      load(nextCursor.current, true);
    };
    return () => {
      cancelled = true;
    };
  }, [runtime, deviceId, cwd]);

  const loadMore = useCallback(() => {
    loadMoreRef.current();
  }, []);

  return { ...state, loadMore };
};
