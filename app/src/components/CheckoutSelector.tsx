// Compose-only Desktop / Project / checkout-mode / Branch dropdowns, shown
// between the composer grabber and the text input. Session composers omit
// this row; host, cwd, and branch live on the thread Details sheet.

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import * as DropdownMenu from './menus/dropdown-menu';
import type { AppRuntime } from '../zeron/runtime/appRuntime';
import type { Chat, DeviceRow, RepoRef, Space } from '../zeron/protocol/types';
import { listRefs } from '../zeron/runtime/catalog';
import { checkoutChangeAllowed } from './checkoutRules';
import { ComposerMenuChip } from './ComposerMenuChip';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';

export const DEFAULT_COMPOSE_BRANCH = 'main';
export const CHECKOUT_CHIP_MAX_CHARS = 16;

export const displayCheckoutLabel = (label: string): string =>
  label.length > CHECKOUT_CHIP_MAX_CHARS
    ? `${label.slice(0, CHECKOUT_CHIP_MAX_CHARS)}…`
    : label;

export interface CheckoutChipsProps {
  runtime: AppRuntime;
  chat: Chat;
  host: DeviceRow | undefined;
  repoPath?: string;
  spaces: readonly Space[];
  projectLabel: string;
  checkoutModeLabel: string;
  branchLabel: string;
  machineLabel: string;
  hosts?: readonly DeviceRow[];
  newWorktree: boolean;
  onSelectHost?: (device: DeviceRow) => void;
  onSelectSpace?: (space: Space | undefined) => void;
  onSelectRef?: (ref: RepoRef) => void;
  onSelectCurrentCheckout?: () => void;
  onSelectNewWorktree?: (base: string) => void;
  onResolvedBranch?: (name: string) => void;
}

const ChipTrigger = ({
  label,
  accessibilityLabel,
}: {
  label: string;
  accessibilityLabel: string;
}) => {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={label}
      collapsable={false}
    >
      <ComposerMenuChip
        label={displayCheckoutLabel(label)}
        color={theme.text}
        chevronColor={theme.textSecondary}
        limitWidth={false}
      />
    </View>
  );
};

const resolveDefaultBranch = (refs: readonly RepoRef[]): string =>
  refs.find(r => r.current)?.name ??
  refs.find(r => r.name === DEFAULT_COMPOSE_BRANCH)?.name ??
  refs[0]?.name ??
  DEFAULT_COMPOSE_BRANCH;

export function CheckoutChips({
  runtime,
  chat,
  host,
  repoPath,
  spaces,
  projectLabel,
  checkoutModeLabel,
  branchLabel,
  machineLabel,
  hosts,
  newWorktree,
  onSelectHost,
  onSelectSpace,
  onSelectRef,
  onSelectCurrentCheckout,
  onSelectNewWorktree,
  onResolvedBranch,
}: CheckoutChipsProps) {
  const [refs, setRefs] = useState<RepoRef[] | undefined>(undefined);

  useEffect(() => {
    if (host === undefined || repoPath === undefined) {
      setRefs(undefined);
      return;
    }
    let live = true;
    try {
      listRefs(runtime, host.id, repoPath)
        .then(r => {
          if (!live) return;
          const next = r ?? [];
          setRefs(next);
          onResolvedBranch?.(resolveDefaultBranch(next));
        })
        .catch(() => {
          if (live) setRefs([]);
        });
    } catch {
      setRefs([]);
    }
    return () => {
      live = false;
    };
  }, [runtime, host, repoPath, onResolvedBranch]);

  const hostSpaces =
    host === undefined ? [] : spaces.filter(s => s.deviceId === host.id);
  const hasProject = repoPath !== undefined;
  const wtVerdict = checkoutChangeAllowed(
    'idle',
    { kind: 'newWorktree', base: branchLabel },
    host,
  );

  return (
    <ScrollView
      horizontal
      testID="compose-checkout"
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      style={styles.scroll}
      contentContainerStyle={styles.bar}
    >
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <ChipTrigger
            label={machineLabel}
            accessibilityLabel={t('checkout.desktop')}
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          {(hosts ?? []).map(d => (
            <DropdownMenu.Item key={d.id} onSelect={() => onSelectHost?.(d)}>
              <DropdownMenu.ItemTitle>{d.name}</DropdownMenu.ItemTitle>
              {d.id === host?.id ? (
                <DropdownMenu.ItemIcon ios={{ name: 'checkmark' }} />
              ) : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <ChipTrigger
            label={projectLabel}
            accessibilityLabel={t('checkout.project')}
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item
            key="no-project"
            onSelect={() => onSelectSpace?.(undefined)}
          >
            <DropdownMenu.ItemTitle>
              {t('newSession.noProject')}
            </DropdownMenu.ItemTitle>
            {chat.spaceId === undefined ? (
              <DropdownMenu.ItemIcon ios={{ name: 'checkmark' }} />
            ) : null}
          </DropdownMenu.Item>
          {hostSpaces.map(s => (
            <DropdownMenu.Item key={s.id} onSelect={() => onSelectSpace?.(s)}>
              <DropdownMenu.ItemTitle>
                {s.name !== undefined && s.name !== '' ? s.name : s.path}
              </DropdownMenu.ItemTitle>
              {s.id === chat.spaceId ? (
                <DropdownMenu.ItemIcon ios={{ name: 'checkmark' }} />
              ) : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <ChipTrigger
            label={checkoutModeLabel}
            accessibilityLabel={t('checkout.label')}
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          {hasProject ? (
            <>
              <DropdownMenu.Item
                key="current"
                onSelect={() => onSelectCurrentCheckout?.()}
              >
                <DropdownMenu.ItemTitle>
                  {t('newSession.checkout.current')}
                </DropdownMenu.ItemTitle>
                {!newWorktree ? (
                  <DropdownMenu.ItemIcon ios={{ name: 'checkmark' }} />
                ) : null}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                key="new-wt"
                onSelect={() => {
                  if (!wtVerdict.allowed) return;
                  onSelectNewWorktree?.(branchLabel);
                }}
              >
                <DropdownMenu.ItemTitle>
                  {wtVerdict.allowed
                    ? t('newSession.checkout.newWorktree')
                    : t('checkout.worktreeUnsupported').replace(
                        '{host}',
                        host?.name ?? t('newSession.host'),
                      )}
                </DropdownMenu.ItemTitle>
                {newWorktree ? (
                  <DropdownMenu.ItemIcon ios={{ name: 'checkmark' }} />
                ) : null}
              </DropdownMenu.Item>
            </>
          ) : (
            <DropdownMenu.Item key="need-project" onSelect={() => {}}>
              <DropdownMenu.ItemTitle>
                {t('checkout.pickProject')}
              </DropdownMenu.ItemTitle>
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <ChipTrigger
            label={branchLabel}
            accessibilityLabel={t('checkout.branch')}
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          {hasProject && (refs ?? []).length > 0 ? (
            (refs ?? []).map(r => (
              <DropdownMenu.Item key={r.name} onSelect={() => onSelectRef?.(r)}>
                <DropdownMenu.ItemTitle>
                  {r.current
                    ? t('checkout.current').replace('{branch}', r.name)
                    : r.worktreePath !== undefined
                    ? `${r.name} (${t('checkout.worktree')})`
                    : r.name}
                </DropdownMenu.ItemTitle>
                {r.name === branchLabel ? (
                  <DropdownMenu.ItemIcon ios={{ name: 'checkmark' }} />
                ) : null}
              </DropdownMenu.Item>
            ))
          ) : (
            <DropdownMenu.Item key="need-branch" onSelect={() => {}}>
              <DropdownMenu.ItemTitle>
                {hasProject
                  ? DEFAULT_COMPOSE_BRANCH
                  : t('checkout.pickProject')}
              </DropdownMenu.ItemTitle>
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    alignSelf: 'stretch',
    minWidth: 0,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 8,
  },
});
