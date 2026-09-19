// Compose-only repo / origin / machine dropdowns, shown between the
// composer grabber and the text input. Session composers omit this row;
// host, cwd, and branch live on the thread Details sheet.

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as DropdownMenu from 'zeego/dropdown-menu';
import type { AppRuntime } from '../zeron/runtime/appRuntime';
import type { Chat, DeviceRow, RepoRef, Space } from '../zeron/protocol/types';
import { listRefs } from '../zeron/runtime/catalog';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { Icon } from './Icon';

export interface CheckoutChipsProps {
  runtime: AppRuntime;
  chat: Chat;
  host: DeviceRow | undefined;
  repoPath?: string;
  spaces: readonly Space[];
  projectLabel: string;
  worktreeLabel: string;
  machineLabel: string;
  hosts?: readonly DeviceRow[];
  onSelectHost?: (device: DeviceRow) => void;
  onSelectSpace?: (space: Space | undefined) => void;
  onSelectRef?: (ref: RepoRef) => void;
  onSelectNewWorktree?: (base: string) => void;
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
    <Pressable
      style={[styles.chip, { backgroundColor: theme.inputBackground }]}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={[styles.chipText, { color: theme.text }]} numberOfLines={1}>
        {label}
      </Text>
      <Icon name="chevron.down" size={10} color={theme.textSecondary} />
    </Pressable>
  );
};

export function CheckoutChips({
  runtime,
  chat,
  host,
  repoPath,
  spaces,
  projectLabel,
  worktreeLabel,
  machineLabel,
  hosts,
  onSelectHost,
  onSelectSpace,
  onSelectRef,
  onSelectNewWorktree,
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

  const hostSpaces =
    host === undefined ? [] : spaces.filter(s => s.deviceId === host.id);

  return (
    <View style={styles.bar} testID="compose-checkout">
      <View style={styles.slot}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <ChipTrigger
              label={projectLabel}
              accessibilityLabel={t('checkout.repo')}
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
      </View>

      <View style={styles.slot}>
        <DropdownMenu.Root onOpenChange={setWtOpen}>
          <DropdownMenu.Trigger>
            <ChipTrigger
              label={worktreeLabel}
              accessibilityLabel={t('checkout.origin')}
            />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            {(refs ?? []).map(r => (
              <DropdownMenu.Item key={r.name} onSelect={() => onSelectRef?.(r)}>
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
                onSelect={() => onSelectNewWorktree?.(r.name)}
              >
                <DropdownMenu.ItemTitle>
                  {t('checkout.newWorktree').replace('{base}', r.name)}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </View>

      <View style={styles.slot}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <ChipTrigger
              label={machineLabel}
              accessibilityLabel={t('checkout.machine')}
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 8,
  },
  slot: { flex: 1, minWidth: 0 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 32,
    maxWidth: '100%',
    minWidth: 0,
    paddingHorizontal: 10,
    borderRadius: 16,
    width: '100%',
  },
  chipText: { fontSize: 13, flexShrink: 1, fontWeight: '500' },
});
