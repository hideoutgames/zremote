// Project + worktree chips inside the composer glass. Project lists spaces
// on the current host (machine name is a checked, non-switching row —
// setChatHost is not implemented). Worktree keeps today's ListRefs /
// SwitchRef / CreateWorktree menu.

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as DropdownMenu from 'zeego/dropdown-menu';
import type { AppRuntime } from '../zeron/runtime/appRuntime';
import type { Chat, DeviceRow, RepoRef, Space } from '../zeron/protocol/types';
import type { RunPhase } from '../zeron/state/sessionStores';
import { checkoutChangeAllowed, type CheckoutChoice } from './checkoutRules';
import { createWorktree, listRefs, switchRef } from '../zeron/runtime/catalog';
import {
  setChatCheckout,
  setChatSpace,
} from '../zeron/runtime/workspaceActions';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { Icon } from './Icon';

export interface CheckoutChipsProps {
  runtime: AppRuntime;
  chat: Chat;
  host: DeviceRow | undefined;
  phase: RunPhase;
  repoPath?: string;
  spaces: readonly Space[];
  projectLabel: string;
  worktreeLabel: string;
}

const ChipTrigger = ({
  label,
  enabled,
  accessibilityLabel,
}: {
  label: string;
  enabled: boolean;
  accessibilityLabel: string;
}) => {
  const theme = useTheme();
  return (
    <Pressable
      disabled={!enabled}
      style={styles.chip}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !enabled }}
    >
      <Text
        style={[
          styles.chipText,
          { color: enabled ? theme.text : theme.sendInactive },
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
  );
};

export function CheckoutChips({
  runtime,
  chat,
  host,
  phase,
  repoPath,
  spaces,
  projectLabel,
  worktreeLabel,
}: CheckoutChipsProps) {
  const [refs, setRefs] = useState<RepoRef[] | undefined>(undefined);
  const [wtOpen, setWtOpen] = useState(false);

  useEffect(() => {
    if (!wtOpen || host === undefined || repoPath === undefined) return;
    let live = true;
    listRefs(runtime, host.id, repoPath).then(r => {
      if (live) setRefs(r ?? []);
    });
    return () => {
      live = false;
    };
  }, [wtOpen, runtime, host, repoPath]);

  const applyWorktree = useCallback(
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
          setChatCheckout(runtime, chat.id, choice.worktreePath, choice.ref);
          return;
        }
        if (repoPath === undefined) return;
        const err = await switchRef(runtime, host.id, repoPath, choice.ref);
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

  const hostSpaces =
    host === undefined ? [] : spaces.filter(s => s.deviceId === host.id);

  return (
    <View style={styles.row}>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <ChipTrigger
            label={projectLabel}
            enabled={enabled}
            accessibilityLabel={t('checkout.project')}
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          {host !== undefined ? (
            <DropdownMenu.Item key="machine" disabled>
              <DropdownMenu.ItemTitle>{host.name}</DropdownMenu.ItemTitle>
            </DropdownMenu.Item>
          ) : null}
          {hostSpaces.map(s => (
            <DropdownMenu.Item
              key={s.id}
              onSelect={() => {
                if (!enabled) return;
                setChatSpace(runtime, chat.id, s.id, s.path);
              }}
            >
              <DropdownMenu.ItemTitle>
                {s.name !== undefined && s.name !== '' ? s.name : s.path}
                {s.id === chat.spaceId ? ` · ${t('checkout.currentHost')}` : ''}
              </DropdownMenu.ItemTitle>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <DropdownMenu.Root onOpenChange={setWtOpen}>
        <DropdownMenu.Trigger>
          <ChipTrigger
            label={worktreeLabel}
            enabled={enabled}
            accessibilityLabel={t('checkout.label')}
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          {(refs ?? []).map(r => (
            <DropdownMenu.Item
              key={r.name}
              onSelect={() =>
                applyWorktree({
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
                applyWorktree({ kind: 'newWorktree', base: r.name }).catch(
                  () => {},
                )
              }
            >
              <DropdownMenu.ItemTitle>
                {t('checkout.newWorktree').replace('{base}', r.name)}
              </DropdownMenu.ItemTitle>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 28,
    maxWidth: 120,
  },
  chipText: { fontSize: 12, flexShrink: 1 },
});
