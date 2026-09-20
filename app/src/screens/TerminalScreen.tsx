// Terminal — tabs of PTY shells on the chat's host. Rendering is a justified
// specialist renderer: AnsiScreen (pure, tested) produces a cell grid, drawn
// as Menlo Text runs per row. Input: a hidden TextInput captures
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
import {
  loadTerminalTabs,
  saveTerminalTabs,
  type TerminalTab,
} from '../zeron/terminal/sessions';
import { createTerminalFocus } from '../zeron/terminal/focus';
import type { TerminalEvent } from '../zeron/protocol/types';
import { t } from '../i18n/strings';
import { Icon } from '../components/Icon';

export const TERM_FONT = 'Menlo';

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

const CHAR_W = 7.8; // Menlo 13pt advance
const CHAR_H = 16;
const FG = '#EEEEEC';
const TAB_FG = '#A0A0A0';
const TAB_ACTIVE = '#F5F5F5';

const KEY_BYTES: Record<string, number[]> = {
  esc: [0x1b],
  tab: [0x09],
  up: [0x1b, 0x5b, 0x41],
  down: [0x1b, 0x5b, 0x42],
  right: [0x1b, 0x5b, 0x43],
  left: [0x1b, 0x5b, 0x44],
  ctrlc: [0x03],
};

const KEY_BAR_MARGIN_BOTTOM = 8;

const KEY_BAR: {
  key: string;
  label: string;
  icon?: SFSymbol;
}[] = [
  { key: 'esc', label: 'ESC' },
  { key: 'ctrl', label: 'CTRL' },
  { key: 'tab', label: 'TAB' },
  { key: 'left', label: '←', icon: 'arrow.left' },
  { key: 'down', label: '↓', icon: 'arrow.down' },
  { key: 'up', label: '↑', icon: 'arrow.up' },
  { key: 'right', label: '→', icon: 'arrow.right' },
  { key: 'ctrlc', label: '^C' },
];

const shellLabel = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function TerminalScreen({ chatId }: { chatId: string }) {
  const runtime = useRuntime();
  const chat = useChat(chatId);
  const { width } = useWindowDimensions();
  const [viewport, setViewport] = useState(() => ({
    cols: Math.max(20, Math.floor((width - 16) / CHAR_W)),
    rows: 24,
  }));
  const cols = viewport.cols;
  const rows = viewport.rows;
  const inputRef = useRef<TextInput>(null);
  const focus = useRef(createTerminalFocus(() => inputRef.current)).current;
  useEffect(() => () => focus.dispose(), [focus]);
  const onScreenLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width: w, height: h } = e.nativeEvent.layout;
      if (w <= 0 || h <= 0) return;
      const next = {
        cols: Math.max(20, Math.floor(w / CHAR_W)),
        rows: Math.max(6, Math.floor(h / CHAR_H)),
      };
      setViewport(prev =>
        prev.cols === next.cols && prev.rows === next.rows ? prev : next,
      );
      setLayoutReady(true);
      focus.focusInput();
    },
    [focus],
  );

  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [active, setActive] = useState(0);
  const [ctrl, setCtrl] = useState(false);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [layoutReady, setLayoutReady] = useState(false);
  const tabsRef = useRef<TerminalTab[]>([]);
  // Bumping forces a re-render after PTY data mutates the screen model.
  const [, setFrame] = useState(0);
  const bump = useCallback(() => setFrame(f => f + 1), []);
  const restoredRef = useRef(false);

  const commitTabs = useCallback(
    (next: TerminalTab[], activeIndex?: number) => {
      tabsRef.current = next;
      saveTerminalTabs(chatId, next);
      setTabs(next);
      if (activeIndex !== undefined) setActive(activeIndex);
    },
    [chatId],
  );

  const spawn = useCallback(() => {
    if (runtime === null || chat?.deviceId === undefined) {
      setError(t('terminal.unavailable'));
      return;
    }
    const relay = runtime.relayFor(chat.deviceId);
    openTerminal(relay, chatId, cols, rows)
      .then(session => {
        const screen = new AnsiScreen(cols, rows);
        const tab: TerminalTab = {
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
        const next = [...tabsRef.current, tab];
        commitTabs(next, next.length - 1);
      })
      .catch(e => setError(String(e?.message ?? e)));
  }, [runtime, chat?.deviceId, chatId, cols, rows, bump, commitTabs]);

  // Restore detached tabs for this chat, then wait for layout before
  // OpenTerminal so a first shell is not sized to a collapsed sheet.
  useEffect(() => {
    if (runtime === null || chat?.deviceId === undefined) {
      setError(t('terminal.unavailable'));
      return;
    }
    const existing = loadTerminalTabs(chatId);
    if (existing.length > 0 && !restoredRef.current) {
      restoredRef.current = true;
      tabsRef.current = existing;
      setTabs(existing);
      setActive(0);
      for (const tb of existing) {
        if (!tb.exited)
          tb.client.subscribe().catch(e => setError(String(e?.message ?? e)));
      }
    }
  }, [runtime, chat?.deviceId, chatId]);

  useEffect(() => {
    if (runtime === null || chat?.deviceId === undefined) return;
    if (!layoutReady) return;
    if (tabsRef.current.length === 0) spawn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, chat?.deviceId, layoutReady]);

  // Resize the local grid and the host PTY together.
  useEffect(() => {
    for (const tb of tabsRef.current) {
      tb.screen.resize(cols, rows);
      if (!tb.exited) tb.client.resize(cols, rows);
    }
    bump();
  }, [cols, rows, bump]);

  // Leaving the screen detaches (PTY stays alive on the host).
  useEffect(
    () => () => {
      for (const tb of tabsRef.current) tb.client.detach();
      saveTerminalTabs(chatId, tabsRef.current);
    },
    [chatId],
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

  const onSubmitEditing = useCallback(() => send([0x0d]), [send]);

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
          const next = tabsRef.current.filter((_, i) => i !== idx);
          commitTabs(next, Math.max(0, idx - 1));
        },
      },
    ]);
  }, [tab, active, commitTabs]);

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
  const cwd =
    tab?.client.handle.session.cwd !== undefined
      ? shellLabel(tab.client.handle.session.cwd)
      : undefined;
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
            const shell = shellLabel(tb.client.handle.session.shell);
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
                style={[
                  styles.tab,
                  selected ? styles.tabActive : undefined,
                  tb.exited ? styles.tabExited : undefined,
                ]}
              >
                <Text
                  style={[
                    styles.tabLabel,
                    { color: selected ? TAB_ACTIVE : TAB_FG },
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
                    <Icon name="xmark" size={11} color={TAB_FG} />
                  </Pressable>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
        {cwd !== undefined ? (
          <Text style={styles.cwd} numberOfLines={1}>
            {cwd}
          </Text>
        ) : null}
        <Pressable
          onPress={spawn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('terminal.new')}
          style={styles.iconBtn}
        >
          <Icon name="plus" size={14} color={TAB_FG} />
        </Pressable>
      </View>

      {/* Screen — Menlo rows of styled runs; tap focuses the overlay input */}
      <View
        testID="terminal-screen"
        style={styles.screen}
        onLayout={onScreenLayout}
        accessibilityLabel={t('terminal.screen')}
      >
        <LegendList
          ref={listRef}
          testID="terminal-list"
          data={lineData}
          estimatedItemSize={CHAR_H}
          keyExtractor={(_, i) => `${i}`}
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="none"
          onTouchEnd={focus.focusInput}
          renderItem={({ item: row, index: y }) => (
            <Text style={styles.termRow} selectable={false}>
              {rowRuns(row, FG).map((r, i) => (
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
              <Text style={styles.exited}>
                {t('terminal.exit').replace(
                  '{code}',
                  String(tab.exitCode ?? '?'),
                )}
              </Text>
            ) : null
          }
        />
        <TextInput
          ref={inputRef}
          testID="terminal-input"
          style={styles.hiddenInput}
          pointerEvents="none"
          value=""
          onChangeText={onKeyText}
          onKeyPress={onKeyPress}
          onSubmitEditing={onSubmitEditing}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          autoFocus={false}
          blurOnSubmit={false}
          caretHidden
          showSoftInputOnFocus
          keyboardAppearance="dark"
          accessibilityLabel={t('terminal.input')}
        />
      </View>

      {tabs.length === 0 ? (
        <Text style={styles.empty}>{error ?? t('terminal.unavailable')}</Text>
      ) : null}

      <View testID="terminal-key-bar" style={styles.keyBarSticky}>
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.keyBar}
        >
          {KEY_BAR.map(spec => {
            const selected = spec.key === 'ctrl' && ctrl;
            const on = selected || pressedKey === spec.key;
            return (
              <Pressable
                key={spec.key}
                onPressIn={() => setPressedKey(spec.key)}
                onPressOut={() => setPressedKey(null)}
                unstable_pressDelay={0}
                onPress={() => {
                  if (spec.key === 'ctrl') setCtrl(v => !v);
                  else send([...(KEY_BYTES[spec.key] ?? [])]);
                  focus.focusInput();
                }}
                accessibilityRole="button"
                accessibilityLabel={spec.label}
                accessibilityState={{ selected }}
                style={[styles.keyBtn, on ? styles.keyBtnOn : null]}
              >
                {spec.icon !== undefined ? (
                  <Icon name={spec.icon} size={14} color={on ? '#000' : FG} />
                ) : (
                  <Text
                    style={[
                      styles.keyLabel,
                      on ? styles.keyLabelOn : styles.keyLabelOff,
                    ]}
                  >
                    {spec.label}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  termBg: { backgroundColor: '#000' },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 4,
    minHeight: 32,
    backgroundColor: '#1A1A1A',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
  },
  tabScroll: { flex: 1 },
  tabs: { flexDirection: 'row', alignItems: 'center' },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    minHeight: 32,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#333',
  },
  tabActive: { backgroundColor: '#000' },
  tabExited: { opacity: 0.45 },
  tabLabel: { fontFamily: TERM_FONT, fontSize: 12 },
  tabClose: {
    minWidth: 22,
    minHeight: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cwd: {
    fontFamily: TERM_FONT,
    fontSize: 11,
    color: TAB_FG,
    maxWidth: 96,
    paddingHorizontal: 8,
  },
  iconBtn: {
    minWidth: 36,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screen: {
    flex: 1,
    paddingHorizontal: 8,
    paddingTop: 6,
    position: 'relative',
  },
  termRow: { flexDirection: 'row', height: CHAR_H },
  termRun: { fontFamily: TERM_FONT, fontSize: 13 },
  cursor: { backgroundColor: FG },
  exited: {
    fontFamily: TERM_FONT,
    fontSize: 13,
    paddingTop: 8,
    color: TAB_FG,
  },
  empty: {
    fontFamily: TERM_FONT,
    fontSize: 13,
    textAlign: 'center',
    padding: 24,
    color: TAB_FG,
  },
  hiddenInput: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.01,
  },
  keyBarSticky: {
    backgroundColor: '#161616',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#333',
    marginBottom: KEY_BAR_MARGIN_BOTTOM,
  },
  keyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 4,
    minHeight: 40,
  },
  keyBtn: {
    minWidth: 40,
    minHeight: 32,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: '#2A2A2A',
  },
  keyBtnOn: { backgroundColor: FG },
  keyLabel: { fontFamily: TERM_FONT, fontSize: 11, fontWeight: '600' },
  keyLabelOff: { color: FG },
  keyLabelOn: { color: '#000' },
});
