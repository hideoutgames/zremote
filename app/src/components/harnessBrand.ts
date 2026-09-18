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

export const svgForPullRequest = (tint?: string): string =>
  tint === undefined
    ? PULL_REQUEST_SVG
    : PULL_REQUEST_SVG.replace(/currentColor/g, tint);
