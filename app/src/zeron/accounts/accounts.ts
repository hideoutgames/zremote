// Agent accounts — per-device account manager (accounts run on the chosen
// HOST device; app WorkOS auth is never reused here). Shapes:
// crates/proto/src/entities.rs L764-865; dispatch rpc.rs L2228-2288.
// Desktop rules (crates/ui/src/settings/accounts.rs): usage meters
// indigo → amber ≥80% → red ≥95% (L35-44), compact reset time
// (format_reset L100-114), provider cards in PROVIDERS order (L116-121).

import { METHODS } from '../protocol/rpc';
import type { RelayLike } from '../attachments/upload';
import type {
  AgentAccountsSnapshot,
  AgentLoginPoll,
  AgentLoginStart,
} from '../protocol/types';

export const USAGE_WARN_FRACTION = 0.8;
export const USAGE_CRITICAL_FRACTION = 0.95;

export type UsageLevel = 'normal' | 'warn' | 'critical';

export const usageLevel = (fraction: number): UsageLevel =>
  fraction >= USAGE_CRITICAL_FRACTION
    ? 'critical'
    : fraction >= USAGE_WARN_FRACTION
    ? 'warn'
    : 'normal';

/** Desktop's format_reset (accounts.rs L105): clock time <22h, weekday <7d,
 * else "Mon d". Caller prefixes "resets ". */
export const formatReset = (
  resetsAt: string | undefined,
  now: number,
): string | undefined => {
  if (resetsAt === undefined) return undefined;
  const at = new Date(resetsAt);
  const diffH = (at.getTime() - now) / 3_600_000;
  const time = at.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (diffH < 22) return `resets ${time}`;
  if (diffH < 24 * 7)
    return `resets ${at.toLocaleDateString([], { weekday: 'short' })}`;
  return `resets ${at.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })}`;
};

/** Provider cards in desktop order (accounts.rs PROVIDERS). */
export const PROVIDERS = [
  { harness: 'claude', name: 'Claude Code', cli: 'claude' },
  { harness: 'codex', name: 'Codex', cli: 'codex' },
  { harness: 'cursor', name: 'Cursor', cli: 'cursor-agent' },
] as const;

export const agentAccountsClient = (relay: RelayLike) => ({
  list: (forceUsage = false) =>
    relay.call<AgentAccountsSnapshot>(METHODS.LIST_AGENT_ACCOUNTS, {
      forceUsage,
    }),
  activate: (harness: string, accountId: string) =>
    relay.call<AgentAccountsSnapshot>(METHODS.ACTIVATE_AGENT_ACCOUNT, {
      harness,
      accountId,
    }),
  forget: (harness: string, accountId: string) =>
    relay.call<AgentAccountsSnapshot>(METHODS.FORGET_AGENT_ACCOUNT, {
      harness,
      accountId,
    }),
  startLogin: (harness: string) =>
    relay.call<AgentLoginStart>(METHODS.START_AGENT_LOGIN, { harness }),
  completeLogin: (loginId: string, code: string) =>
    relay.call<AgentAccountsSnapshot>(METHODS.COMPLETE_AGENT_LOGIN, {
      loginId,
      code,
    }),
  pollLogin: (loginId: string) =>
    relay.call<AgentLoginPoll>(METHODS.POLL_AGENT_LOGIN, { loginId }),
  cancelLogin: (loginId: string) =>
    relay.call(METHODS.CANCEL_AGENT_LOGIN, { loginId }),
});
