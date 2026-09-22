// ZeronSession Live Activity — Lock Screen banner + Dynamic Island.
// The 'widget' directive marks SessionActivityLayout's body for
// expo-widgets' babel plugin, which stringifies it for the widget
// extension's JS runtime. It may only use @expo/ui/swift-ui primitives and
// props — no app imports, no hooks, no state.
//
// IMPLEMENTED-BUT-UNVERIFIED: first rendered on a Mac/device build.

import { createLiveActivity } from 'expo-widgets';
import {
  HStack,
  Image,
  ProgressView,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import type { SFSymbol } from 'sf-symbols-typescript';
import {
  font,
  foregroundStyle,
  padding,
  progressViewStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';

export type SessionActivityPhase =
  | 'working'
  | 'awaitingInput'
  | 'stopping'
  | 'errored'
  | 'completed'
  | 'stale'
  | 'planReady';

export type SessionActivityProps = {
  /** Activity identity — dedupe key, not rendered. */
  chatId: string;
  title: string;
  /** host · project; omitted entirely when `showContext` is false. */
  hostLabel?: string;
  phase: SessionActivityPhase;
  phaseLabel: string;
  /** unix seconds. */
  startedAt: number;
  tasksDone?: number;
  tasksTotal?: number;
  /** Privacy default: when false only title + phase render. */
  showContext: boolean;
  /** Per-agent accent (question / plan / PR / running). */
  accentColor?: string;
  glyph?: string;
  /** Overflow activity: leftover agent titles listed in the expanded view. */
  overflowTitles?: string[];
};

// Helpers live INSIDE the component: expo-widgets stores the component's
// function source and re-evaluates it in the widget extension's JS context,
// where only @expo/ui globals exist — references to module-scope functions
// throw and the activity renders a red box. Exported for the
// self-containment test only.
export const SessionActivityLayout = (props: SessionActivityProps) => {
  'widget';

  const phaseColor = (phase: SessionActivityPhase): string => {
    switch (phase) {
      case 'awaitingInput':
        return '#0A84FF';
      case 'planReady':
        return '#E5A50A';
      case 'errored':
        return '#E5484D';
      case 'completed':
        return '#30D158';
      case 'stale':
        return '#8E8E93';
      default:
        return '#FFFFFF';
    }
  };
  const phaseGlyph = (phase: SessionActivityPhase): SFSymbol => {
    switch (phase) {
      case 'awaitingInput':
        return 'questionmark.bubble.fill';
      case 'planReady':
        return 'doc.text.fill';
      case 'stopping':
        return 'stop.circle';
      case 'errored':
        return 'xmark.octagon';
      case 'completed':
        return 'checkmark.circle';
      case 'stale':
        return 'wifi.slash';
      default:
        return 'circle.fill';
    }
  };
  const colorOf = (p: SessionActivityProps): string =>
    p.accentColor ?? phaseColor(p.phase);
  const glyphOf = (p: SessionActivityProps): SFSymbol =>
    (p.glyph as SFSymbol | undefined) ?? phaseGlyph(p.phase);
  const progress = (p: SessionActivityProps) =>
    p.tasksDone !== undefined &&
    p.tasksTotal !== undefined &&
    p.tasksTotal > 0 ? (
      <ProgressView
        value={p.tasksDone / p.tasksTotal}
        modifiers={[progressViewStyle('linear'), tint(colorOf(p))]}
      />
    ) : (
      // indeterminate bar when no task counts exist
      <ProgressView modifiers={[tint(colorOf(p))]} />
    );

  return {
    banner: (
      <HStack modifiers={[padding({ all: 12 })]}>
        <Image
          systemName={glyphOf(props)}
          modifiers={[foregroundStyle(colorOf(props))]}
        />
        <VStack modifiers={[padding({ leading: 8 })]}>
          <Text modifiers={[font({ weight: 'semibold' })]}>{props.title}</Text>
          <HStack>
            <Text modifiers={[foregroundStyle(colorOf(props))]}>
              {props.phaseLabel}
            </Text>
            {props.showContext && props.hostLabel !== undefined ? (
              <Text
                modifiers={[foregroundStyle('#8E8E93'), font({ size: 12 })]}
              >
                {` · ${props.hostLabel}`}
              </Text>
            ) : null}
          </HStack>
          {progress(props)}
        </VStack>
        <Spacer />
      </HStack>
    ),
    compactLeading: (
      <Image
        systemName={glyphOf(props)}
        modifiers={[foregroundStyle(colorOf(props))]}
      />
    ),
    compactTrailing: (
      <Text modifiers={[font({ size: 11 })]}>{props.phaseLabel}</Text>
    ),
    minimal: (
      <Image
        systemName={glyphOf(props)}
        modifiers={[foregroundStyle(colorOf(props))]}
      />
    ),
    expandedCenter: (
      <VStack>
        {props.overflowTitles !== undefined &&
        props.overflowTitles.length > 0 ? (
          <>
            {props.overflowTitles.map(title => (
              <Text key={title} modifiers={[font({ weight: 'semibold' })]}>
                {title}
              </Text>
            ))}
          </>
        ) : (
          <>
            <Text modifiers={[font({ weight: 'semibold' })]}>
              {props.title}
            </Text>
            {props.showContext && props.hostLabel !== undefined ? (
              <Text modifiers={[foregroundStyle('#8E8E93')]}>
                {props.hostLabel}
              </Text>
            ) : null}
            {progress(props)}
          </>
        )}
      </VStack>
    ),
    expandedTrailing: (
      <Text modifiers={[foregroundStyle(colorOf(props))]}>
        {props.phaseLabel}
      </Text>
    ),
  };
};

export const SessionActivity = createLiveActivity<SessionActivityProps>(
  'ZeronSession',
  SessionActivityLayout,
);
