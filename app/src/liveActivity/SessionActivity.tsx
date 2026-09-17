// ZeronSession Live Activity — Lock Screen banner + Dynamic Island.
// The 'widget' directive marks this component for expo-widgets' layout
// serializer; it may only use @expo/ui/swift-ui primitives and props —
// no app imports, no hooks, no state.
//
// IMPLEMENTED-BUT-UNVERIFIED: first rendered on a Mac/device build.

'widget';

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
  | 'stale';

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
};

const phaseColor = (phase: SessionActivityPhase): string => {
  switch (phase) {
    case 'awaitingInput':
      return '#E5A50A'; // amber
    case 'errored':
      return '#E5484D'; // red
    case 'completed':
      return '#30A46C'; // green
    case 'stale':
      return '#8E8E93'; // dimmed
    default:
      return '#0A84FF'; // accent blue
  }
};

const phaseGlyph = (phase: SessionActivityPhase): SFSymbol => {
  switch (phase) {
    case 'awaitingInput':
      return 'exclamationmark.bubble';
    case 'stopping':
      return 'stop.circle';
    case 'errored':
      return 'xmark.octagon';
    case 'completed':
      return 'checkmark.circle';
    case 'stale':
      return 'wifi.slash';
    default:
      return 'bolt.circle';
  }
};

const progress = (props: SessionActivityProps) =>
  props.tasksDone !== undefined &&
  props.tasksTotal !== undefined &&
  props.tasksTotal > 0 ? (
    <ProgressView
      value={props.tasksDone / props.tasksTotal}
      modifiers={[progressViewStyle('linear'), tint(phaseColor(props.phase))]}
    />
  ) : (
    // indeterminate bar when no task counts exist
    <ProgressView modifiers={[tint(phaseColor(props.phase))]} />
  );

const SessionActivityLayout = (props: SessionActivityProps) => ({
  banner: (
    <HStack modifiers={[padding({ all: 12 })]}>
      <Image
        systemName={phaseGlyph(props.phase)}
        modifiers={[foregroundStyle(phaseColor(props.phase))]}
      />
      <VStack modifiers={[padding({ leading: 8 })]}>
        <Text modifiers={[font({ weight: 'semibold' })]}>{props.title}</Text>
        <HStack>
          <Text modifiers={[foregroundStyle(phaseColor(props.phase))]}>
            {props.phaseLabel}
          </Text>
          {props.showContext && props.hostLabel !== undefined ? (
            <Text modifiers={[foregroundStyle('#8E8E93'), font({ size: 12 })]}>
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
      systemName={phaseGlyph(props.phase)}
      modifiers={[foregroundStyle(phaseColor(props.phase))]}
    />
  ),
  compactTrailing: (
    <Text modifiers={[font({ size: 11 })]}>{props.phaseLabel}</Text>
  ),
  minimal: (
    <Image
      systemName={phaseGlyph(props.phase)}
      modifiers={[foregroundStyle(phaseColor(props.phase))]}
    />
  ),
  expandedCenter: (
    <VStack>
      <Text modifiers={[font({ weight: 'semibold' })]}>{props.title}</Text>
      {props.showContext && props.hostLabel !== undefined ? (
        <Text modifiers={[foregroundStyle('#8E8E93')]}>{props.hostLabel}</Text>
      ) : null}
      {progress(props)}
    </VStack>
  ),
  expandedTrailing: (
    <Text modifiers={[foregroundStyle(phaseColor(props.phase))]}>
      {props.phaseLabel}
    </Text>
  ),
});

export const SessionActivity = createLiveActivity<SessionActivityProps>(
  'ZeronSession',
  SessionActivityLayout,
);
