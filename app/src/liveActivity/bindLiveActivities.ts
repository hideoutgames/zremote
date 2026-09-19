// Runtime wiring: workspace/session stores → LiveActivityManager, push
// token registration → edge registry. expo-widgets imports are confined to
// this file so the manager + planning stay Jest-testable.
//
// IMPLEMENTED-BUT-UNVERIFIED on device: ActivityKit behavior needs a Mac
// build (docs/NATIVE_MODULES.md).

import { addPushToStartTokenListener, after } from 'expo-widgets';
import { SessionActivity } from './SessionActivity';
import type { SessionActivityProps } from './SessionActivity';
import {
  LiveActivityManager,
  type LiveActivityDriver,
  type LiveActivityHandle,
} from './liveActivityManager';
import { activityAccent } from './activityAccent';
import { planAwaitingReview } from './planAwaitingReview';
import {
  registerLiveActivityToken,
  unregisterLiveActivityToken,
} from '../zeron/transport/liveActivityRegistry';
import type { TokenSource } from '../zeron/transport/tokenSource';
import { workspaceStore } from '../zeron/state/workspaceStore';
import { getSessionStore, runPhase } from '../zeron/state/sessionStores';
import { changeRequestStore } from '../zeron/state/changeRequestStore';
import { threadPrDot } from '../components/prBadge';
import { uiPrefsStore } from '../zeron/state/uiPrefs';
import type { RunPhase } from '../zeron/state/sessionStores';
import { createLog } from '../zeron/log';

const log = createLog();

const driver: LiveActivityDriver = {
  start: (props, url, staleDate) =>
    SessionActivity.start(
      props,
      url,
      staleDate,
    ) as unknown as LiveActivityHandle,
  getInstances: () =>
    SessionActivity.getInstances() as unknown as LiveActivityHandle[],
  after: date => after(date),
};

const phaseFor = (
  phase: RunPhase,
  planReady: boolean,
): SessionActivityProps['phase'] => {
  if (planReady) return 'planReady';
  switch (phase) {
    case 'awaitingInput':
      return 'awaitingInput';
    case 'stopping':
      return 'stopping';
    case 'stale':
      return 'stale';
    case 'errored':
      return 'errored';
    case 'idle':
      return 'completed';
    default:
      return 'working';
  }
};

export type BindDeps = {
  edgeUrl: string;
  tokenSource: TokenSource;
  orgId: string;
  /** this phone's peer device id — binds the token at the edge. */
  phoneDeviceId: string;
  /** currently-selected session (deep-link / presentation). */
  selectedChatId(): string | undefined;
};

const lastToken = new Map<string, string>();

/** Returns an unbind function. Subscribes to workspace + session stores +
 * uiPrefs so phase/plan/PR updates land and settings toggles apply. */
export const bindLiveActivities = (deps: BindDeps): (() => void) => {
  try {
    return bindLiveActivitiesUnsafe(deps);
  } catch (e) {
    log.warn(`live activities bind failed: ${e}`);
    return () => {};
  }
};

const bindLiveActivitiesUnsafe = (deps: BindDeps): (() => void) => {
  const mgr = new LiveActivityManager(driver, {
    onPushToken: (chatId, token) => {
      lastToken.set(chatId, token);
      registerLiveActivityToken(deps.edgeUrl, deps.tokenSource, deps.orgId, {
        chatId,
        token,
        kind: 'activity',
        device: deps.phoneDeviceId,
      }).catch(e => log.warn(`live-activity register: ${e}`));
    },
    onUnregister: chatId => {
      const token = lastToken.get(chatId);
      lastToken.delete(chatId);
      if (token === undefined) return;
      unregisterLiveActivityToken(deps.edgeUrl, deps.tokenSource, deps.orgId, {
        chatId,
        token,
        kind: 'activity',
        device: deps.phoneDeviceId,
      }).catch(e => log.warn(`live-activity unregister: ${e}`));
    },
    selectedChatId: deps.selectedChatId,
  });

  let pushToStart: { remove(): void } = { remove() {} };
  try {
    pushToStart = addPushToStartTokenListener(e => {
      registerLiveActivityToken(deps.edgeUrl, deps.tokenSource, deps.orgId, {
        chatId: '*',
        token: e.activityPushToStartToken,
        kind: 'push_to_start',
        device: deps.phoneDeviceId,
      }).catch(err => log.warn(`push-to-start register: ${err}`));
    });
  } catch (e) {
    log.warn(`push-to-start listener: ${e}`);
  }

  let seenIds = new Set<string>();
  let sessionUnsubs: (() => void)[] = [];

  const tick = (): void => {
    try {
      tickUnsafe();
    } catch (e) {
      log.warn(`live activities tick: ${e}`);
    }
  };

  const tickUnsafe = (): void => {
    if (!uiPrefsStore.getState().liveActivitiesEnabled) {
      mgr.endAll();
      seenIds = new Set();
      return;
    }
    const { sessions, chats, devices, spaces } = workspaceStore.getState();
    const showContext = uiPrefsStore.getState().liveActivityShowHost;
    const now = Date.now();
    const nextIds = new Set(Object.keys(sessions));
    for (const id of seenIds) {
      if (!nextIds.has(id)) mgr.apply(id, null);
    }
    seenIds = nextIds;
    for (const session of Object.values(sessions)) {
      const chat = chats.find(c => c.id === session.chatId);
      const s = getSessionStore(session.chatId).getState();
      const rawPhase = runPhase(s, session, chat, deps.phoneDeviceId, now);
      const planReady = planAwaitingReview(s.entries, rawPhase);
      const phase = phaseFor(rawPhase, planReady);
      const host = devices.find(d => d.id === session.deviceId);
      const space =
        chat?.spaceId !== undefined
          ? spaces.find(sp => sp.id === chat.spaceId)
          : undefined;
      const prTone = threadPrDot(
        changeRequestStore.getState().byChat[session.chatId]?.changeRequest,
      );
      const accent = activityAccent({
        awaitingInput: rawPhase === 'awaitingInput',
        planReady,
        prTone,
      });
      mgr.apply(session.chatId, {
        chatId: session.chatId,
        title: chat?.title ?? 'Session',
        hostLabel:
          showContext && host !== undefined
            ? `${host.name}${space !== undefined ? ` · ${space.name}` : ''}`
            : undefined,
        phase,
        phaseLabel: phase,
        startedAt: (session.startedAt ?? now) / 1000,
        showContext,
        accentColor: accent.color,
        glyph: accent.glyph,
      });
    }
  };

  const resubSessions = (): void => {
    for (const u of sessionUnsubs) u();
    sessionUnsubs = Object.keys(workspaceStore.getState().sessions).map(id =>
      getSessionStore(id).subscribe(tick),
    );
  };

  const unsub = workspaceStore.subscribe(() => {
    resubSessions();
    tick();
  });
  const unsubPrefs = uiPrefsStore.subscribe(tick);
  const unsubCr = changeRequestStore.subscribe(tick);
  resubSessions();
  tick();
  return () => {
    unsub();
    unsubPrefs();
    unsubCr();
    for (const u of sessionUnsubs) u();
    pushToStart.remove();
    mgr.endAll();
  };
};
