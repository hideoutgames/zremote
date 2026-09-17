// Ported from zeron@853872d crates/rpc/src/lib.rs (ClientFrame / ServerFrame
// envelopes + the `methods` module) and apps/ios/Zeron/Sync/DeviceRelayClient.swift
// (DeviceRpcPending routing semantics).
//
// ControlRpc ndjson frames: client → server `{id, method, params}` /
// `{id, cancel: true}`; server → client `{id, ok}` / `{id, err}` /
// `{id, item}`* `{id, done: true}`.

/** A client-originated frame. `params` is always sent (the engine's serde
 * rejects a missing field even when every param is optional). */
export interface ClientFrame {
  id: number;
  method?: string;
  params?: unknown;
  cancel?: boolean;
}

/** A server-originated frame. Exactly one of ok/err/item/done is meaningful. */
export interface ServerFrame {
  id: number;
  ok?: unknown;
  err?: string;
  item?: unknown;
  done?: boolean;
}

/** RPC method names — single source of truth for both ends
 * (crates/rpc/src/lib.rs `methods` module, verbatim). */
export const METHODS = {
  WATCH_PREVIEWS: 'WatchPreviews',
  LIST_HARNESSES: 'ListHarnesses',
  GET_TITLE_SETTINGS: 'GetTitleSettings',
  SET_TITLE_SETTINGS: 'SetTitleSettings',
  /** Flip a harness's enablement; replies with the fresh ListHarnesses catalog. */
  SET_HARNESS_ENABLED: 'SetHarnessEnabled',
  LIST_MODELS: 'ListModels',
  LIST_COMMANDS: 'ListCommands',
  QUEUE_COMMAND: 'QueueCommand',
  /** P2P delivery fallback: forward a queued command entry over the device-room link. */
  RELAY_COMMAND: 'RelayCommand',
  /** User-driven delivery retry for a chat with unadopted queued sends. */
  RETRY_DELIVERY: 'RetryDelivery',
  WATCH_DOC_MESSAGES: 'WatchDocMessages',
  /** Pending-message queue watch. `{chatId}` → `{items: QueuedMessage[]}`. */
  WATCH_QUEUE: 'WatchQueue',
  /** Append to the queue. `{chatId, text, attachments?, holdForTurnEnd?}` → `{id}`. */
  QUEUE_MESSAGE: 'QueueMessage',
  /** Retype a queued message; empty text deletes it. `{chatId, id, text}` → `{changed}`. */
  UPDATE_QUEUED_MESSAGE: 'UpdateQueuedMessage',
  /** Acquire a host-authoritative edit lease for one queued row. */
  BEGIN_QUEUED_MESSAGE_EDIT: 'BeginQueuedMessageEdit',
  /** Renew an acquired queue edit lease. */
  RENEW_QUEUED_MESSAGE_EDIT: 'RenewQueuedMessageEdit',
  /** Commit, cancel, discard, or explicitly release an acquired edit. */
  FINISH_QUEUED_MESSAGE_EDIT: 'FinishQueuedMessageEdit',
  /** Reorder. `{chatId, id, toIndex}` → `{changed}`. */
  MOVE_QUEUED_MESSAGE: 'MoveQueuedMessage',
  REMOVE_QUEUED_MESSAGE: 'RemoveQueuedMessage',
  /** Interrupt whatever is running and send this one. `{chatId, id}` → `{sent}`. */
  SEND_QUEUED_MESSAGE_NOW: 'SendQueuedMessageNow',
  /** Steer this row into the live turn without interrupting it. `{chatId, id}` → `{sent}`. */
  STEER_QUEUED_MESSAGE_NOW: 'SteerQueuedMessageNow',
  /** Nudge every open room client to verify liveness NOW. IPC-only. */
  PROBE_SYNC: 'ProbeSync',
  /** Live sync introspection: per-room state, ages, counters. IPC-only. */
  SYNC_STATUS: 'SyncStatus',
  /** Pushed edge-connectivity posture stream. IPC-only. */
  WATCH_CONNECTIVITY: 'WatchConnectivity',
  /** In-flight queued-attachment transfer progress stream. IPC-only. */
  WATCH_TRANSFERS: 'WatchTransfers',
  WATCH_CHATS: 'WatchChats',
  WATCH_DEVICES: 'WatchDevices',
  WATCH_SESSIONS: 'WatchSessions',
  /** Spaces registry (device+folder pairs). */
  WATCH_SPACES: 'WatchSpaces',
  /** Entity mutations against the workspace doc; tagged `{op: …}` params. */
  MUTATE: 'Mutate',
  /** This engine's device identity → `{deviceId}` (IPC-only). */
  LOCAL_DEVICE: 'LocalDevice',
  /** This engine runtime's fixed device and workspace identity. */
  ENGINE_INFO: 'EngineInfo',
  /** Readiness barrier for the engine runtime. */
  ENGINE_READY: 'EngineReady',
  /** Ask a headless IPC owner to drain and exit. */
  STOP_ENGINE: 'StopEngine',
  AUTH_STATUS: 'AuthStatus',
  // AuthRpc mutations (IPC-only).
  SIGN_IN: 'SignIn',
  SIGN_IN_HEADLESS: 'SignInHeadless',
  COMPLETE_SIGN_IN: 'CompleteSignIn',
  SIGN_OUT: 'SignOut',
  LIST_ORGS: 'ListOrgs',
  CREATE_ORG: 'CreateOrg',
  SELECT_ORG: 'SelectOrg',
  /** One-time local→synced profile import: what's importable (unary). */
  LOCAL_IMPORT_STATUS: 'LocalImportStatus',
  /** One-time local→synced profile import: run it (stream of progress). */
  IMPORT_LOCAL_WORKSPACE: 'ImportLocalWorkspace',
  // Repos / worktrees / folders (ControlRpc, relay-forwardable).
  LIST_REPOS: 'ListRepos',
  ADD_REPO: 'AddRepo',
  CLONE_REPO: 'CloneRepo',
  CREATE_REPO: 'CreateRepo',
  LIST_BRANCHES: 'ListBranches',
  LIST_REFS: 'ListRefs',
  LIST_GIT_HISTORY: 'ListGitHistory',
  /** Fuzzy commit-subject / SHA search over the complete public history. */
  SEARCH_GIT_HISTORY: 'SearchGitHistory',
  /** Resolve hosted profile images for a page of Git commit authors. */
  RESOLVE_GIT_AVATARS: 'ResolveGitAvatars',
  /** Update remote-tracking refs without changing HEAD, the index, or files. */
  FETCH_ALL: 'FetchAll',
  SWITCH_REF: 'SwitchRef',
  LIST_FOLDERS: 'ListFolders',
  /** The device's browse roots: home plus mounted drives/volumes. */
  LIST_DRIVES: 'ListDrives',
  /** Fuzzy relative-path search rooted in a known chat or space checkout. */
  SEARCH_FILES: 'SearchFiles',
  // Device-local workspace filesystem operations (relay-forwardable).
  LIST_WORKSPACE_DIRECTORY: 'ListWorkspaceDirectory',
  SEARCH_WORKSPACE_FILES: 'SearchWorkspaceFiles',
  READ_WORKSPACE_IMAGE: 'ReadWorkspaceImage',
  READ_WORKSPACE_FILE: 'ReadWorkspaceFile',
  WRITE_WORKSPACE_FILE: 'WriteWorkspaceFile',
  /** The only streaming method in the workspace-files group. */
  WATCH_WORKSPACE_FILES: 'WatchWorkspaceFiles',
  CREATE_WORKTREE: 'CreateWorktree',
  DELETE_WORKTREE: 'DeleteWorktree',
  // Terminals (ControlRpc, relay-forwardable; SubscribeTerminal streams).
  OPEN_TERMINAL: 'OpenTerminal',
  SUBSCRIBE_TERMINAL: 'SubscribeTerminal',
  WRITE_TERMINAL: 'WriteTerminal',
  RESIZE_TERMINAL: 'ResizeTerminal',
  CLOSE_TERMINAL: 'CloseTerminal',
  /** Checkout-diff stream for the target device's chats (relay-forwardable). */
  WATCH_CHECKOUT_DIFFS: 'WatchCheckoutDiffs',
  /** Current pull request for one checkout, resolved on the checkout's device. */
  WATCH_CHECKOUT_CHANGE_REQUEST: 'WatchCheckoutChangeRequest',
  GET_CHECKOUT_DIFF: 'GetCheckoutDiff',
  GET_CHECKOUT_FILE_DIFF_TEXT: 'GetCheckoutFileDiffText',
  // Agent accounts (ControlRpc, relay-forwardable).
  LIST_AGENT_ACCOUNTS: 'ListAgentAccounts',
  ACTIVATE_AGENT_ACCOUNT: 'ActivateAgentAccount',
  FORGET_AGENT_ACCOUNT: 'ForgetAgentAccount',
  START_AGENT_LOGIN: 'StartAgentLogin',
  COMPLETE_AGENT_LOGIN: 'CompleteAgentLogin',
  POLL_AGENT_LOGIN: 'PollAgentLogin',
  CANCEL_AGENT_LOGIN: 'CancelAgentLogin',
  // Uploads / attachments (ControlRpc, relay-forwardable).
  UPLOAD_CHUNK: 'UploadChunk',
  UPLOAD_COMMIT: 'UploadCommit',
  READ_ATTACHMENT_CHUNK: 'ReadAttachmentChunk',
  /** Lazy full-tool-output fetch from the R2 sidecar. Edge-direct; never relayed. */
  FETCH_TOOL_BLOB: 'FetchToolBlob',
  /** Update status stream (ControlRpc, relay-forwardable). */
  UPDATE_STATUS: 'UpdateStatus',
  /** Download + apply the newest release on the target device. */
  APPLY_UPDATE: 'ApplyUpdate',
} as const;

export type MethodName = (typeof METHODS)[keyof typeof METHODS];

// ── Reply demux (DeviceRpcPending port) ─────────────────────────────────────

export interface RpcHandlers {
  /** Unary: resolve with the `ok` payload (undefined = unexpected reply / err). */
  onOk?: (value: unknown) => void;
  onErr?: (message: string) => void;
  /** Stream: item payload. */
  onItem?: (item: unknown) => void;
  /** Stream: terminal — `error` is a string message, undefined = clean done. */
  onDone?: (error?: string) => void;
}

/**
 * Routes multiplexed ndjson RPC replies — a 1:1 port of Swift
 * `DeviceRpcPending.route`: streams terminate on err/done/unexpected;
 * `ok` on a stream is a readiness ack and keeps it alive; unary resolves on
 * ok, fails on err/unexpected.
 */
export class RpcDemux {
  private unary = new Map<number, RpcHandlers>();
  private streams = new Map<number, RpcHandlers>();

  get unaryCount(): number {
    return this.unary.size;
  }
  get streamCount(): number {
    return this.streams.size;
  }

  /** Whether the request is still waiting (timeout tasks check this). */
  owns(id: number): boolean {
    return this.unary.has(id) || this.streams.has(id);
  }

  register(id: number, handlers: RpcHandlers & { stream?: boolean }): void {
    if (handlers.stream) this.streams.set(id, handlers);
    else this.unary.set(id, handlers);
  }

  fail(id: number, error: string): void {
    const u = this.unary.get(id);
    if (u) {
      this.unary.delete(id);
      u.onErr?.(error);
      return;
    }
    const s = this.streams.get(id);
    if (s) {
      this.streams.delete(id);
      s.onDone?.(error);
    }
  }

  failAll(error: string): void {
    // Remove first: a stream's terminal callback must observe the request
    // already gone (mirrors Swift failAll ordering).
    const unary = [...this.unary.values()];
    const streams = [...this.streams.values()];
    this.unary.clear();
    this.streams.clear();
    for (const h of unary) h.onErr?.(error);
    for (const h of streams) h.onDone?.(error);
  }

  /** Remove a stream the consumer cancelled; true while it was still live. */
  removeStreamForCancellation(id: number): boolean {
    return this.streams.delete(id);
  }

  /** Route one ndjson payload (may carry many lines). Returns the count of
   * frames routed to a pending request. */
  handleNdjson(text: string): number {
    let handled = 0;
    for (const line of text.split('\n')) {
      if (line.length === 0) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof obj !== 'object' || obj === null || Array.isArray(obj))
        continue;
      if (this.route(obj as Record<string, unknown>)) handled += 1;
    }
    return handled;
  }

  private route(object: Record<string, unknown>): boolean {
    const id = object.id;
    if (typeof id !== 'number') return false;

    const stream = this.streams.get(id);
    if (stream) {
      if (typeof object.err === 'string') {
        this.streams.delete(id);
        stream.onDone?.(object.err);
      } else if ('item' in object) {
        try {
          stream.onItem?.(object.item);
        } catch (error) {
          this.streams.delete(id);
          stream.onDone?.(
            error instanceof Error ? error.message : String(error),
          );
        }
      } else if (object.done === true) {
        this.streams.delete(id);
        stream.onDone?.();
      } else if ('ok' in object) {
        // Versioned streams may acknowledge readiness with `ok` before
        // producing items. The pending stream remains live.
      } else {
        this.streams.delete(id);
        stream.onDone?.('unexpected reply');
      }
      return true;
    }

    const unary = this.unary.get(id);
    if (!unary) return false;
    this.unary.delete(id);
    if (typeof object.err === 'string') {
      unary.onErr?.(object.err);
    } else if ('ok' in object) {
      unary.onOk?.(object.ok);
    } else {
      unary.onErr?.('unexpected reply');
    }
    return true;
  }
}
