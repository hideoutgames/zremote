// Terminal — tabs of PTY shells on the chat's host. Rendering is a justified
// specialist renderer: AnsiScreen (pure, tested) produces a cell grid, drawn
// as monospace Text runs per row. Input: a hidden TextInput captures
// keystrokes; a key bar supplies Esc/Ctrl/arrows/Tab/Ctrl-C byte sequences.
// Reconnects resume via `afterSeq` (never a new shell); detach keeps the PTY
// alive; CloseTerminal only from the confirmed "Close shell" action.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useRuntime } from '../app/runtimeContext';
import { useChat } from '../zeron/state/workspaceStore';
import { TerminalClient, openTerminal } from '../zeron/terminal/client';
import { AnsiScreen, base64Decode, type Cell } from '../zeron/terminal/ansi';
import type { TerminalEvent } from '../zeron/protocol/types';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { Icon } from '../components/Icon';
import { Glass } from '../components/Glass';

// xterm 16-color palette (dim + bright).
const PALETTE16 = [
  '#000000',
  '#CC0000',
  '#4E9A06',
  '#C4A000',
  '#3465A4',
  '#75507B',
  '#06989A',
  '#D3D7CF',
  '#555753',
  '#EF2929',
  '#8AE234',
  '#FCE94F',
  '#729FCF',
  '#AD7FA8',
  '#34E2E2',
  '#EEEEEC',
];

const cellColor = (
  c: number | [number, number, number] | undefined,
): string | undefined => {
  if (c === undefined) return undefined;
  if (Array.isArray(c)) return `rgb(${c[0]},${c[1]},${c[2]})`;
  if (c < 16) return PALETTE16[c];
  // xterm 256: 16-231 color cube, 232-255 grayscale.
  if (c < 232) {
    const v = c - 16;
    const step = (n: number) => (n === 0 ? 0 : 55 + n * 40);
    return `rgb(${step(Math.floor(v / 36))},${step(
      Math.floor((v % 36) / 6),
    )},${step(v % 6)})`;
  }
  const g = 8 + (c - 232) * 10;
  return `rgb(${g},${g},${g})`;
};

const cellStyle = (cell: Cell, defaultFg: string) => {
  const s = cell.style;
  const fg = cellColor(s.fg) ?? defaultFg;
  const bg = cellColor(s.bg);
  return {
    color: s.inverse ? bg ?? '#000' : fg,
    backgroundColor: s.inverse ? fg : bg,
    fontWeight: s.bold ? ('700' as const) : ('400' as const),
    opacity: s.dim ? 0.6 : 1,
    fontStyle: s.italic ? ('italic' as const) : ('normal' as const),
    textDecorationLine: s.underline
      ? ('underline' as const)
      : ('none' as const),
  };
};

/** Collapse a row into same-style runs for fewer Text nodes. */
const rowRuns = (row: Cell[], defaultFg: string) => {
  const runs: { text: string; style: ReturnType<typeof cellStyle> }[] = [];
  let cur: Cell | undefined;
  for (const cell of row) {
    const st = cellStyle(cell, defaultFg);
    const prev = runs[runs.length - 1];
    if (
      prev !== undefined &&
      cur !== undefined &&
      JSON.stringify(prev.style) === JSON.stringify(st)
    ) {
      prev.text += cell.ch;
    } else {
      runs.push({ text: cell.ch, style: st });
      cur = cell;
    }
  }
  return runs;
};

const CHAR_W = 7.8; // monospace 13pt advance, measured
const CHAR_H = 17;

const KEY_BYTES: Record<string, number[]> = {
  esc: [0x1b],
  tab: [0x09],
  up: [0x1b, 0x5b, 0x41],
  down: [0x1b, 0x5b, 0x42],
  right: [0x1b, 0x5b, 0x43],
  left: [0x1b, 0x5b, 0x44],
  ctrlc: [0x03],
};

const KEY_BAR: {
  key: string;
  label: string;
  icon?: SFSymbol;
}[] = [
  { key: 'esc', label: 'esc' },
  { key: 'ctrl', label: 'ctrl' },
  { key: 'tab', label: '⇥' },
  { key: 'left', label: 'left', icon: 'arrow.left' },
  { key: 'down', label: 'down', icon: 'arrow.down' },
  { key: 'up', label: 'up', icon: 'arrow.up' },
  { key: 'right', label: 'right', icon: 'arrow.right' },
  { key: 'ctrlc', label: '^C' },
];

interface Tab {
  client: TerminalClient;
  screen: AnsiScreen;
  exited: boolean;
  exitCode?: number;
}

export function TerminalScreen({ chatId }: { chatId: string }) {
  const theme = useTheme();
  const runtime = useRuntime();
  const chat = useChat(chatId);
  const { width, height } = useWindowDimensions();
  const [viewport, setViewport] = useState(() => ({
    cols: Math.max(20, Math.floor((width - 16) / CHAR_W)),
    rows: Math.max(6, Math.floor((height - 220) / CHAR_H)),
  }));
  const cols = viewport.cols;
  const rows = viewport.rows;
  const onScreenLayout = useCallback((e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    const next = {
      cols: Math.max(20, Math.floor(w / CHAR_W)),
      rows: Math.max(6, Math.floor(h / CHAR_H)),
    };
    setViewport(prev =>
      prev.cols === next.cols && prev.rows === next.rows ? prev : next,
    );
  }, []);

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState(0);
  const [ctrl, setCtrl] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const inputRef = useRef<TextInput>(null);
  // Bumping forces a re-render after PTY data mutates the screen model.
  const [, setFrame] = useState(0);
  const bump = useCallback(() => setFrame(f => f + 1), []);

  const spawn = useCallback(() => {
    if (runtime === null || chat?.deviceId === undefined) return;
    const relay = runtime.relayFor(chat.deviceId);
    openTerminal(relay, chatId, cols, rows)
      .then(session => {
        const screen = new AnsiScreen(cols, rows);
        const tab: Tab = {
          client: undefined as never,
          screen,
          exited: false,
        };
        const client = new TerminalClient(
          relay,
          session,
          (e: TerminalEvent) => {
            if (e.type === 'data') {
              screen.write(base64Decode(e.data));
            } else {
              tab.exited = true;
              tab.exitCode = e.exitCode;
            }
            bump();
          },
        );
        tab.client = client;
        client.subscribe().catch(e => setError(String(e?.message ?? e)));
        client.resize(cols, rows);
        setTabs(prev => [...prev, tab]);
        setActive(tabs.length);
      })
      .catch(e => setError(String(e?.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, chat?.deviceId, chatId, cols, rows, bump]);

  // First tab opens on mount.
  useEffect(() => {
    if (tabs.length === 0) spawn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resize → debounced ResizeTerminal on the live client.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  useEffect(() => {
    for (const tb of tabsRef.current) {
      if (!tb.exited) tb.client.resize(cols, rows);
    }
  }, [cols, rows]);

  // Leaving the screen detaches (PTY stays alive on the host).
  useEffect(
    () => () => {
      for (const tb of tabsRef.current) tb.client.detach();
    },
    [],
  );

  const tab = tabs[active];
  const send = useCallback(
    (bytes: number[]) => tab?.client.input(Uint8Array.from(bytes)),
    [tab],
  );

  const onKeyText = useCallback(
    (text: string) => {
      if (text === '' || tab === undefined) return;
      const bytes: number[] = [];
      for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0;
        if (ctrl && cp >= 0x61 && cp <= 0x7a) bytes.push(cp - 0x60);
        else bytes.push(...new TextEncoder().encode(ch));
      }
      tab.client.input(Uint8Array.from(bytes));
      if (ctrl) setCtrl(false);
    },
    [tab, ctrl],
  );

  const onKeyPress = useCallback(
    (e: { nativeEvent: { key: string } }) => {
      if (e.nativeEvent.key === 'Backspace') send([0x7f]);
      else if (e.nativeEvent.key === 'Enter') send([0x0d]);
    },
    [send],
  );

  const confirmClose = useCallback(() => {
    if (tab === undefined) return;
    Alert.alert(t('terminal.closeShell'), undefined, [
      { text: t('session.cancel'), style: 'cancel' },
      {
        text: t('terminal.close'),
        style: 'destructive',
        onPress: () => {
          const idx = active;
          tab.client.close().catch(() => {});
          setTabs(prev => prev.filter((_, i) => i !== idx));
          setActive(Math.max(0, idx - 1));
        },
      },
    ]);
  }, [tab, active]);

  const screen = tab?.screen;
  // Scrollback + visible grid as one virtualized list; follow-tail unless the
  // user scrolls up more than the re-engage band (~2 rows).
  const lineData =
    screen === undefined ? [] : [...screen.scrollback, ...screen.grid];
  const cursorRow = (screen?.scrollback.length ?? 0) + (screen?.y ?? 0);
  const listRef = useRef<LegendListRef>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (follow.current) listRef.current?.scrollToEnd({ animated: false });
  });
  const onScroll = useCallback(
    (e: {
      nativeEvent: {
        contentOffset: { y: number };
        contentSize: { height: number };
        layoutMeasurement: { height: number };
      };
    }) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      follow.current =
        contentSize.height - contentOffset.y - layoutMeasurement.height <
        CHAR_H * 2;
    },
    [],
  );
  return (
    <View style={[styles.root, styles.termBg]}>
      <View style={styles.tabBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
          style={styles.tabScroll}
        >
          {tabs.map((tb, i) => {
            const shell = tb.client.handle.session.shell;
            const selected = i === active;
            const a11y = tb.exited
              ? `${shell} ${i + 1}, ${t('terminal.exit').replace(
                  '{code}',
                  String(tb.exitCode ?? '?'),
                )}`
              : `${shell} ${i + 1}`;
            return (
              <Pressable
                key={i}
                onPress={() => setActive(i)}
                accessibilityRole="button"
                accessibilityLabel={a11y}
                accessibilityState={{ selected }}
                style={[styles.tab, tb.exited ? styles.tabExited : undefined]}
              >
                <Text
                  style={[
                    styles.tabLabel,
                    selected ? styles.tabLabelActive : undefined,
                    { color: selected ? theme.accent : theme.text },
                  ]}
                  maxFontSizeMultiplier={1.6}
                >
                  {shell}
                </Text>
                {selected && !tb.exited ? (
                  <Pressable
                    onPress={confirmClose}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('terminal.closeShell')}
                    style={styles.tabClose}
                  >
                    <Icon name="xmark" size={12} color={theme.textSecondary} />
                  </Pressable>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable
          onPress={spawn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('terminal.new')}
          style={styles.iconBtn}
        >
          <Icon name="plus" size={16} color={theme.text} />
        </Pressable>
      </View>

      {/* Screen — monospace rows of styled runs; tap focuses the hidden input */}
      <Pressable
        style={styles.screen}
        onLayout={onScreenLayout}
        onPress={() => inputRef.current?.focus()}
        accessibilityLabel={t('terminal.screen')}
      >
        <LegendList
          ref={listRef}
          data={lineData}
          estimatedItemSize={CHAR_H}
          keyExtractor={(_, i) => `${i}`}
          onScroll={onScroll}
          scrollEventThrottle={16}
          renderItem={({ item: row, index: y }) => (
            <Text style={styles.termRow} selectable={false}>
              {rowRuns(row, '#EEEEEC').map((r, i) => (
                <Text key={i} style={[styles.termRun, r.style]}>
                  {r.text}
                </Text>
              ))}
              {screen?.cursorVisible && y === cursorRow ? (
                <Text style={[styles.termRun, styles.cursor]}> </Text>
              ) : null}
            </Text>
          )}
          ListFooterComponent={
            tab?.exited ? (
              <Text style={[styles.exited, { color: theme.textSecondary }]}>
                {t('terminal.exit').replace(
                  '{code}',
                  String(tab.exitCode ?? '?'),
                )}
              </Text>
            ) : null
          }
        />
      </Pressable>

      {error !== undefined ? (
        <Text style={[styles.errLine, { color: theme.danger }]}>{error}</Text>
      ) : null}

      {/* Hidden input capturing keystrokes */}
      <TextInput
        ref={inputRef}
        style={styles.hiddenInput}
        value=""
        onChangeText={onKeyText}
        onKeyPress={onKeyPress}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        accessibilityLabel={t('terminal.input')}
      />

      <Glass style={styles.keyBar}>
        {KEY_BAR.map(spec => {
          const selected = spec.key === 'ctrl' && ctrl;
          return (
            <Pressable
              key={spec.key}
              onPress={() => {
                if (spec.key === 'ctrl') setCtrl(v => !v);
                else send([...(KEY_BYTES[spec.key] ?? [])]);
              }}
              accessibilityRole="button"
              accessibilityLabel={spec.label}
              accessibilityState={{ selected }}
              style={[
                styles.keyBtn,
                selected ? { backgroundColor: theme.accent } : null,
              ]}
            >
              {spec.icon !== undefined ? (
                <Icon
                  name={spec.icon}
                  size={16}
                  color={selected ? '#fff' : theme.text}
                />
              ) : (
                <Text
                  style={[
                    styles.keyLabel,
                    { color: selected ? '#fff' : theme.text },
                  ]}
                >
                  {spec.label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  termBg: { backgroundColor: '#000' },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 4,
    paddingVertical: 4,
  },
  tabScroll: { flex: 1 },
  tabs: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    minHeight: 36,
  },
  tabExited: { opacity: 0.45 },
  tabLabel: { fontSize: 15, fontWeight: '400' },
  tabLabelActive: { fontWeight: '600' },
  tabClose: {
    minWidth: 24,
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    minWidth: 44,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screen: { flex: 1, padding: 8 },
  termRow: { flexDirection: 'row', height: CHAR_H },
  termRun: { fontFamily: 'monospace', fontSize: 13 },
  cursor: { backgroundColor: '#EEEEEC' },
  exited: { fontFamily: 'monospace', fontSize: 13, paddingTop: 8 },
  errLine: { fontSize: 12, paddingHorizontal: 12 },
  hiddenInput: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  keyBar: {
    flexDirection: 'row',
    marginHorizontal: 8,
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  keyBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  keyLabel: { fontSize: 13, fontWeight: '600' },
});
