// Live Activity accent: icon + color from session/PR/plan state.
// Precedence: question > plan-ready > open PR > merged PR > running/draft/none.

export const ACTIVITY_COLORS = {
  running: '#FFFFFF',
  openPr: '#30D158',
  mergedPr: '#BF5AF2',
  question: '#0A84FF',
  planReady: '#E5A50A',
} as const;

export type ActivityAccentKind =
  | 'question'
  | 'planReady'
  | 'openPr'
  | 'mergedPr'
  | 'running';

export type ActivityAccent = {
  kind: ActivityAccentKind;
  color: string;
  glyph: string;
};

export const activityAccent = (flags: {
  awaitingInput: boolean;
  planReady: boolean;
  prTone: 'draft' | 'open' | 'merged' | null;
}): ActivityAccent => {
  if (flags.awaitingInput)
    return {
      kind: 'question',
      color: ACTIVITY_COLORS.question,
      glyph: 'questionmark.bubble.fill',
    };
  if (flags.planReady)
    return {
      kind: 'planReady',
      color: ACTIVITY_COLORS.planReady,
      glyph: 'doc.text.fill',
    };
  if (flags.prTone === 'open')
    return {
      kind: 'openPr',
      color: ACTIVITY_COLORS.openPr,
      glyph: 'arrow.triangle.pull',
    };
  if (flags.prTone === 'merged')
    return {
      kind: 'mergedPr',
      color: ACTIVITY_COLORS.mergedPr,
      glyph: 'checkmark.seal.fill',
    };
  return {
    kind: 'running',
    color: ACTIVITY_COLORS.running,
    glyph: 'circle.fill',
  };
};
