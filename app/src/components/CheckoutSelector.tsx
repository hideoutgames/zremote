// CheckoutSelector — the `Space · host · branch ▾` pill above the composer
// glass. Menu lists the host's refs (worktree-backed refs tagged), plus a
// "New worktree" entry gated on host ≥ MIN_VERSION_RUN_WORKTREE
// (checkoutRules.checkoutChangeAllowed). Reassignment mirrors desktop:
//   plain ref  → SwitchRef on the host, then setChatCheckout(cwd, branch);
//   worktree   → setChatCheckout(worktreePath, ref) — no git checkout;
//   new        → CreateWorktree then the same retarget.
// Disabled while a run is live/stopping.

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import * as DropdownMenu from 'zeego/dropdown-menu';
import type { AppRuntime } from '../zeron/runtime/appRuntime';
import type { Chat, DeviceRow, RepoRef } from '../zeron/protocol/types';
import type { RunPhase } from '../zeron/state/sessionStores';
import { checkoutChangeAllowed, type CheckoutChoice } from './checkoutRules';
import { createWorktree, listRefs, switchRef } from '../zeron/runtime/catalog';
import { setChatCheckout } from '../zeron/runtime/workspaceActions';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { Icon } from './Icon';

export interface CheckoutSelectorProps {
  runtime: AppRuntime;
  chat: Chat;
  host: DeviceRow | undefined;
  phase: RunPhase;
  /** The chat's space path (repo root for ListRefs/CreateWorktree). */
  repoPath?: string;
  label: string;
}

export function CheckoutSelector({
  runtime,
  chat,
  host,
  phase,
  repoPath,
  label,
}: CheckoutSelectorProps) {
  const theme = useTheme();
  const [refs, setRefs] = useState<RepoRef[] | undefined>(undefined);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || host === undefined || repoPath === undefined) return;
    let live = true;
    listRefs(runtime, host.id, repoPath).then(r => {
      if (live) setRefs(r ?? []);
    });
    return () => {
      live = false;
    };
  }, [open, runtime, host, repoPath]);

  const apply = useCallback(
    async (choice: CheckoutChoice) => {
      if (host === undefined) return;
      const verdict = checkoutChangeAllowed(phase, choice, host);
      if (!verdict.allowed) {
        Alert.alert(
          verdict.reason === 'busy'
            ? t('checkout.busy')
            : t('checkout.worktreeUnsupported').replace('{host}', host.name),
        );
        return;
      }
      if (choice.kind === 'ref') {
        if (choice.worktreePath !== undefined) {
          // Worktree-backed ref: retarget the chat — no git checkout.
          setChatCheckout(runtime, chat.id, choice.worktreePath, choice.ref);
          return;
        }
        if (repoPath === undefined) return;
        const err = await switchRef(runtime, host.id, repoPath, choice.ref);
        // git's error (dirty tree etc.) surfaces verbatim.
        if (err !== undefined) {
          Alert.alert(t('checkout.switchFailed'), err);
          return;
        }
        setChatCheckout(runtime, chat.id, repoPath, choice.ref);
        return;
      }
      if (repoPath === undefined) return;
      const path = await createWorktree(
        runtime,
        host.id,
        repoPath,
        choice.base,
      );
      if (path === undefined) {
        Alert.alert(t('checkout.worktreeFailed'));
        return;
      }
      setChatCheckout(runtime, chat.id, path, choice.base);
    },
    [runtime, chat.id, host, phase, repoPath],
  );

  const enabled =
    phase !== 'working' && phase !== 'awaitingInput' && phase !== 'stopping';

  return (
    <DropdownMenu.Root onOpenChange={setOpen}>
      <DropdownMenu.Trigger>
        <Pressable
          disabled={!enabled}
          style={styles.pill}
          hitSlop={6}
          accessibilityLabel={t('checkout.label')}
        >
          <Text
            style={[
              styles.label,
              { color: enabled ? theme.textSecondary : theme.sendInactive },
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
          <Icon
            name="chevron.down"
            size={10}
            color={enabled ? theme.textSecondary : theme.sendInactive}
          />
        </Pressable>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {(refs ?? []).map(r => (
          <DropdownMenu.Item
            key={r.name}
            onSelect={() =>
              apply({
                kind: 'ref',
                ref: r.name,
                worktreePath: r.worktreePath,
              }).catch(() => {})
            }
          >
            <DropdownMenu.ItemTitle>
              {r.current
                ? t('checkout.current').replace('{branch}', r.name)
                : r.worktreePath !== undefined
                ? `${r.name} (${t('checkout.worktree')})`
                : r.name}
            </DropdownMenu.ItemTitle>
          </DropdownMenu.Item>
        ))}
        {(refs ?? []).map(r => (
          <DropdownMenu.Item
            key={`wt-${r.name}`}
            onSelect={() =>
              apply({ kind: 'newWorktree', base: r.name }).catch(() => {})
            }
          >
            <DropdownMenu.ItemTitle>
              {t('checkout.newWorktree').replace('{base}', r.name)}
            </DropdownMenu.ItemTitle>
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'center',
    paddingVertical: 2,
  },
  label: { fontSize: 12, maxWidth: 260 },
});
