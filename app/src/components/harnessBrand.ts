// Desktop `harness_brand_icon` map (crates/ui/src/pickers.rs) — wire harness
// ids to the vendored Zeron brand marks. Unknown ids have no mark.

import type { HarnessBrandKey } from './harnessMarks';
import { HARNESS_BRAND_SVG, PULL_REQUEST_SVG } from './harnessMarks';

const HARNESS_TO_BRAND: Record<string, HarnessBrandKey> = {
  'claude-code': 'claude',
  claude: 'claude',
  mock: 'claude',
  codex: 'openai',
  cursor: 'cursor',
  grok: 'grok',
  hermes: 'hermes',
  pi: 'pi',
  devin: 'devin',
  opencode: 'opencode',
  antigravity: 'antigravity',
};

/** Rasterized marks for native UIMenu ItemImage (SVG/Skia cannot go there). */
const HARNESS_BRAND_PNG: Record<HarnessBrandKey, number> = {
  claude: require('../../assets/harness/claude-mark.png'),
  openai: require('../../assets/harness/openai-mark.png'),
  cursor: require('../../assets/harness/cursor-mark.png'),
  grok: require('../../assets/harness/grok-mark.png'),
  hermes: require('../../assets/harness/hermes-mark.png'),
  pi: require('../../assets/harness/pi-mark.png'),
  devin: require('../../assets/harness/devin-mark.png'),
  opencode: require('../../assets/harness/opencode-mark.png'),
  antigravity: require('../../assets/harness/antigravity-mark.png'),
};

export const brandKeyForHarness = (
  harnessId: string | undefined,
): HarnessBrandKey | undefined =>
  harnessId === undefined ? undefined : HARNESS_TO_BRAND[harnessId];

export const svgForHarness = (
  harnessId: string | undefined,
  tint?: string,
): string | undefined => {
  const key = brandKeyForHarness(harnessId);
  if (key === undefined) return undefined;
  const raw = HARNESS_BRAND_SVG[key];
  return tint === undefined ? raw : raw.replace(/currentColor/g, tint);
};

export const imageForHarness = (
  harnessId: string | undefined,
): number | undefined => {
  const key = brandKeyForHarness(harnessId);
  return key === undefined ? undefined : HARNESS_BRAND_PNG[key];
};

export const svgForPullRequest = (tint?: string): string =>
  tint === undefined
    ? PULL_REQUEST_SVG
    : PULL_REQUEST_SVG.replace(/currentColor/g, tint);
