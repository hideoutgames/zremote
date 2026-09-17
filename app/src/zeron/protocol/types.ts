// Ported from zeron@853872d crates/proto/src/agent.rs, crates/proto/src/entities.rs,
// crates/doc/src/commands.rs, crates/doc/src/parts.rs, crates/doc/src/queue.rs,
// edge/src/session-doc/control-types.ts, apps/ios/Zeron/Models/Entities.swift,
// apps/ios/Zeron/Models/MessageQueue.swift, crates/engine/src/registry.rs.
// Wire types only — camelCase JSON mirrors serde rename_all = "camelCase".

/** Harness ids are kebab-case on the wire; unknown ids pass through. */
export type KnownHarnessId =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'devin'
  | 'grok'
  | 'hermes'
  | 'pi'
  | 'opencode'
  | 'antigravity'
  | 'mock';
export type HarnessId = KnownHarnessId | (string & {});

export type KnownReasoningLevel =
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra'
  | 'ultracode'
  | 'ultrathink';
export type ReasoningLevel = KnownReasoningLevel | (string & {});

export type SandboxLevel =
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access';
export type SteeringMode = 'step-boundary' | 'turn-boundary';

export interface WorktreeSpec {
  repoPath: string;
  base: string;
}

/** agent.rs RunRequest. `worktree` and `harness` are skip_serializing_if:
 * they must be OMITTED (not null) when unset. */
export interface RunRequest {
  prompt: string;
  harness?: HarnessId;
  model?: string | null;
  reasoning?: ReasoningLevel | null;
  modelOptions: Record<string, unknown>;
  cwd: string;
  sandbox: SandboxLevel;
  autoApprove: boolean;
  resume?: string | null;
  attachments?: string[];
  worktree?: WorktreeSpec;
}

/** agent.rs UserInputQuestion — options are plain strings (see the
 * Entities.swift comment: object options NEVER decoded). */
export interface UserInputQuestion {
  id: string;
  header: string;
  question: string;
  options: string[];
  multiSelect?: boolean;
}

export interface UserInputAnswer {
  questionId: string;
  labels: string[];
}

/** agent.rs ContextUsage — replicated on the session doc's `meta` map. */
export interface ContextUsage {
  tokens?: number | null;
  window?: number | null;
}

// ── Harness/model catalog (engine/src/registry.rs + agent.rs) ───────────────

export interface HarnessDescriptor {
  id: HarnessId;
  name: string;
  supportsSteering?: boolean;
  steeringMode?: SteeringMode;
  reasoningLevels?: ReasoningLevel[];
  installed?: boolean;
  enabled?: boolean;
}

export interface ModelOptionChoice {
  id: string;
  label: string;
}

export interface ModelOption {
  id: string;
  label: string;
  choices: ModelOptionChoice[];
  defaultChoice: string;
}

export interface Model {
  id: string;
  label: string;
  description?: string;
  reasoningLevels: ReasoningLevel[];
  options: ModelOption[];
}

// ── Registry entities (entities.rs rows, epoch-millis fields on the wire) ───

export interface DeviceRow {
  id: string;
  name: string;
  platform: string;
  lastSeenAt?: number;
  createdAt?: number;
  version?: string;
  capabilities: string[];
}

export interface Space {
  id: string;
  deviceId: string;
  path: string;
  name?: string;
  gitDetected: boolean;
  gitCheckedAt?: number;
  checkoutId?: string;
  createdAt: number;
}

export interface ChatConfig {
  harness: string;
  model?: string;
  reasoning?: string;
  modelOptions: Record<string, unknown>;
  sandbox?: string;
}

export interface Chat {
  id: string;
  deviceId: string;
  title?: string;
  archived: boolean;
  cwd?: string;
  branch?: string;
  checkoutId?: string;
  config?: ChatConfig;
  lastMessagePreview?: string;
  lastMessageAt?: number;
  createdAt: number;
  spaceId?: string;
  lastSeenAt?: number;
  /** Room generation (docs/chat2-sync.md M2): absent/1 = s2, 2 = chat2. */
  roomGen?: number;
}

export type SessionStatus = 'idle' | 'working' | 'awaitingInput' | 'errored';

export interface SessionRow {
  chatId: string;
  deviceId: string;
  status: SessionStatus;
  startedAt?: number;
  updatedAt: number;
}

export interface RepoRef {
  name: string;
  current: boolean;
  worktreePath?: string;
}

export interface FolderEntry {
  name: string;
  isDir: boolean;
  isRepo: boolean;
}

export interface FolderListing {
  path: string;
  entries: FolderEntry[];
  truncated: boolean;
}

/** entities.rs engine capabilities (the five declared in Entities.swift). */
export const EngineCapability = {
  messageQueueV1: 'message-queue-v1',
  messageQueueActionsV1: 'message-queue-actions-v1',
  messageQueueAttachmentsV1: 'message-queue-attachments-v1',
  messageQueueCleanAttachmentTextV1: 'message-queue-clean-attachment-text-v1',
  messageQueueEditLeaseV1: 'message-queue-edit-lease-v1',
} as const;
export type EngineCapability =
  (typeof EngineCapability)[keyof typeof EngineCapability];

// ── Session doc entities (doc/src/parts.rs + schema.rs) ─────────────────────

export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'streaming' | 'complete' | 'aborted';
export type SubagentStatus = 'running' | 'done' | 'failed';

export interface ToolDiff {
  path: string;
  oldText?: string;
  newText: string;
}

export interface ToolDiffStat {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * Render-only tool call as stored in the doc — the Rust `ToolCall` enum is
 * `#[serde(tag = "kind", rename_all = "camelCase")]`, so doc rows carry
 * `{kind: "exec"|"readFile"|…}`. Unknown tags pass through (render-parts
 * policy: store an unknown shape rather than erase a rendered call).
 */
export type RenderToolCall =
  | { kind: 'exec'; command: string; background?: boolean }
  | { kind: 'readFile'; path: string }
  | { kind: 'writeFile'; path: string }
  | { kind: 'editFile'; path: string }
  | {
      kind: 'applyPatch';
      path?: string;
      changes?: { path: string; kind: 'add' | 'delete' | 'update' }[];
    }
  | { kind: 'search'; pattern: string; path?: string }
  | { kind: 'glob'; pattern: string }
  | { kind: 'webFetch'; url: string }
  | { kind: 'webSearch'; query: string }
  | { kind: 'todo'; items: { text: string; done: boolean }[] }
  | { kind: 'mcp'; server?: string; tool: string }
  | { kind: 'unknown'; name: string }
  | ({ kind: string } & Record<string, unknown>);

export type MessagePart =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'reasoning'; id: string; text: string }
  | {
      kind: 'tool';
      id: string;
      call: RenderToolCall;
      /** `isError` presence in the doc IS the resolution marker. */
      isError?: boolean;
      resolved: boolean;
      output?: string;
      outputRef?: string;
      outputBytes?: number;
      diff?: ToolDiff;
      diffRef?: string;
      diffStats?: ToolDiffStat[];
      subagentRef?: string;
      subagentStatus?: SubagentStatus;
      subagentTail?: string;
    }
  | {
      kind: 'input';
      id: string;
      requestId: string;
      questions: UserInputQuestion[];
      resolved: boolean;
    }
  | { kind: 'error'; id: string; message: string }
  | { kind: 'image'; id: string; path: string; name: string; mimeType: string };

export interface MessageEntry {
  id: string;
  role: MessageRole;
  parts: MessagePart[];
  createdAt: number;
  deviceId: string;
  status?: MessageStatus;
  continuationOf?: string;
}

// ── Command ledger (doc/src/commands.rs) ────────────────────────────────────

export type SessionCommandKind = 'run' | 'steer' | 'interrupt' | 'respondInput';
export type SessionCommandStatus =
  | 'pending'
  | 'applied'
  | 'rejected'
  | 'expired'
  | 'superseded'
  | 'cancelled';

export type SessionCommandPayload =
  | { kind: 'run'; request: RunRequest; messageId: string }
  | { kind: 'steer'; prompt: string; messageId?: string | null }
  | { kind: 'interrupt' }
  | { kind: 'respondInput'; requestId: string; answers: UserInputAnswer[] };

export interface CommandBasedOn {
  turnId?: string | null;
  frontier?: string | null;
}

export interface SessionCommandEntry {
  id: string;
  kind: SessionCommandKind;
  payload: SessionCommandPayload;
  issuedBy: string;
  issuedAt: number;
  basedOn?: CommandBasedOn;
  expiresAt?: number;
  status: SessionCommandStatus;
  resolution?: string;
}

export const COMMAND_DEFAULT_TTL_MS = 86_400_000;

// ── Pending-message queue (doc/src/queue.rs + MessageQueue.swift) ───────────

export type QueueDeliveryGate =
  | {
      kind: 'editing';
      leaseId: string;
      ownerDeviceId: string;
      ownerInstanceId: string;
      acquiredAtMs: number;
      expiresAtMs: number;
      baseTextHash: string;
    }
  | {
      kind: 'reviewRequired';
      previousLeaseId: string;
      ownerDeviceId: string;
      sinceMs: number;
      baseTextHash: string;
    };

export interface QueuedMessage {
  id: string;
  text: string;
  attachments?: string[];
  holdForTurnEnd?: boolean;
  issuedBy: string;
  issuedAt: number;
  editedAt?: number;
  deliveryGate?: QueueDeliveryGate;
}
