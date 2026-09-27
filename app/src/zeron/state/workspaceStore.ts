// Synchronized workspace state (docs/ARCHITECTURE.md "Synchronized domain
// state"): a zustand store fed ONLY by AppRuntime's re-projections of the
// RegistryDoc. One instance per signed-in account — `bind`/`reset` are used
// by the runtime; views use the hooks.
//
// Hooks select the raw slices and derive with useMemo — selector functions
// must return stable references or useSyncExternalStore loops.

import { useEffect, useMemo } from 'react';
import { createStore, useStore } from 'zustand';
import {
  archivedChats,
  chatsInSpace,
  overviewChats,
  reuseWorkspaceProjection,
  type WorkspaceProjection,
} from '../doc/workspaceProjection';
import {
  chatIndicator,
  effectiveStatus,
  isPresenceFresh,
  type ChatIndicator,
} from '../protocol/entities';
import type { Chat, DeviceRow, SessionRow, Space } from '../protocol/types';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface WorkspaceState {
  devices: DeviceRow[];
  spaces: Space[];
  chats: Chat[];
  sessions: Record<string, SessionRow>;
  /** deviceId → last presence beat (ms). */
  presence: Record<string, number>;
  connection: ConnectionState;
  lastSyncAt?: number;
}

const EMPTY: WorkspaceState = {
  devices: [],
  spaces: [],
  chats: [],
  sessions: {},
  presence: {},
  connection: 'connecting',
};

export const createWorkspaceStore = () =>
  createStore<WorkspaceState>(() => EMPTY);

/** The account-scoped singleton the runtime drives. */
export const workspaceStore = createWorkspaceStore();

/** Values from the last bind. Presence beats mutate the runtime's object
 *  in place, so reference equality cannot tell a beat from a no-op. */
let presenceValues: Record<string, number> = {};

const presenceChanged = (next: Record<string, number>): boolean => {
  const prevKeys = Object.keys(presenceValues);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return true;
  for (const key of nextKeys)
    if (presenceValues[key] !== next[key]) return true;
  return false;
};

/** Runtime entry point: replace the projected workspace. */
export const bindWorkspace = (
  projection: WorkspaceProjection,
  presence: Record<string, number>,
  connection: ConnectionState,
  at = Date.now(),
): void => {
  const prev = workspaceStore.getState();
  const reused = reuseWorkspaceProjection(prev, projection);
  const presenceDirty = presenceChanged(presence);
  if (
    reused.devices === prev.devices &&
    reused.spaces === prev.spaces &&
    reused.chats === prev.chats &&
    reused.sessions === prev.sessions &&
    !presenceDirty &&
    connection === prev.connection
  ) {
    return;
  }
  const nextPresence = presenceDirty ? { ...presence } : prev.presence;
  if (presenceDirty) presenceValues = nextPresence;
  workspaceStore.setState({
    devices: reused.devices,
    spaces: reused.spaces,
    chats: reused.chats,
    sessions: reused.sessions,
    presence: nextPresence,
    connection,
    lastSyncAt: at,
  });
};

export const resetWorkspace = (): void => {
  presenceValues = {};
  workspaceStore.setState(EMPTY);
};

// ── Hooks ──────────────────────────────────────────────────────────────

const EMPTY_DEVICES: DeviceRow[] = [];
const EMPTY_SESSIONS: Record<string, SessionRow> = {};

/** List helpers only read spaces and chats. Subscribing to sessions would
 *  re-render every thread row on a presence heartbeat. */
const useSpaceChatProjection = (): WorkspaceProjection => {
  const spaces = useStore(workspaceStore, s => s.spaces);
  const chats = useStore(workspaceStore, s => s.chats);
  return useMemo(
    () => ({
      devices: EMPTY_DEVICES,
      spaces,
      chats,
      sessions: EMPTY_SESSIONS,
    }),
    [spaces, chats],
  );
};

export const useOverviewChats = (): Chat[] => {
  const w = useSpaceChatProjection();
  return useMemo(() => overviewChats(w), [w]);
};

export const useChatsInSpace = (spaceId: string): Chat[] => {
  const w = useSpaceChatProjection();
  return useMemo(() => chatsInSpace(w, spaceId), [w, spaceId]);
};

export const useArchivedChats = (spaceId?: string): Chat[] => {
  const w = useSpaceChatProjection();
  return useMemo(() => archivedChats(w, spaceId), [w, spaceId]);
};

export const useChat = (chatId: string): Chat | undefined =>
  useStore(workspaceStore, s => s.chats.find(c => c.id === chatId));

/** Shared 1s clock. Every subscriber's selector runs on each tick, but
 *  zustand only re-renders when the derived value changes — a row showing
 *  "2d" re-renders once a day, not once a second, and high-in-the-tree
 *  subscribers stop re-rendering whole screens on every tick. */
const nowStore = createStore<{ now: number }>(() => ({ now: Date.now() }));
let nowTimer: ReturnType<typeof setInterval> | undefined;

export const useDerivedNow = <T>(derive: (now: number) => T): T => {
  useEffect(() => {
    nowStore.setState({ now: Date.now() });
    if (nowTimer === undefined) {
      nowTimer = setInterval(
        () => nowStore.setState({ now: Date.now() }),
        1000,
      );
      // RN returns a number; Node/Jest returns a Timeout — unref so a live
      // timer never blocks worker teardown.
      (nowTimer as { unref?: () => void }).unref?.();
    }
  }, []);
  return useStore(nowStore, s => derive(s.now));
};

/** Indicator with a 1s-ticking `now` so staleness updates live.
 *  Subscribes to the chat object and the status string — an `updatedAt`
 *  heartbeat keeps the same status and must not re-render the row. */
export const useIndicator = (chatId: string): ChatIndicator => {
  const chat = useStore(workspaceStore, s =>
    s.chats.find(c => c.id === chatId),
  );
  const status = useStore(workspaceStore, s => s.sessions[chatId]?.status);
  return useDerivedNow(now => {
    if (chat === undefined) return 'idle';
    const row = workspaceStore.getState().sessions[chatId];
    const stamped =
      row !== undefined && status !== undefined && row.status !== status
        ? { ...row, status }
        : row;
    return chatIndicator(chat, effectiveStatus(stamped, now));
  });
};

/** Ticking presence freshness so TTL expiry updates without a new beat. */
export const useDeviceOnline = (deviceId: string): boolean => {
  const at = useStore(workspaceStore, s => s.presence[deviceId]);
  return useDerivedNow(now => isPresenceFresh(at, now));
};

export const useHostForChat = (chatId: string): DeviceRow | undefined =>
  useStore(workspaceStore, s => {
    const chat = s.chats.find(c => c.id === chatId);
    return chat === undefined
      ? undefined
      : s.devices.find(d => d.id === chat.deviceId);
  });

export const useEffectiveStatus = (chatId: string) =>
  useStore(workspaceStore, s =>
    effectiveStatus(s.sessions[chatId], Date.now()),
  );
