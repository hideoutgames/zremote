import type { Theme } from '../theme';
import type { PrBadgeModel } from './prBadge';

export const prToneColor = (
  theme: Theme,
  badge: Pick<PrBadgeModel, 'tone' | 'state'>,
): string => {
  if (badge.state === 'closed') return theme.textSecondary;
  if (badge.tone === 'merged') return theme.prMerged;
  if (badge.tone === 'draft') return theme.prDraft;
  return theme.prOpen;
};

export const prToneFill = (
  theme: Theme,
  badge: Pick<PrBadgeModel, 'tone' | 'state'>,
): string =>
  `${prToneColor(theme, badge)}${theme.scheme === 'dark' ? '2E' : '24'}`;
