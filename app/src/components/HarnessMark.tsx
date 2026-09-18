import React from 'react';
import { BrandMark } from './BrandMark';
import { svgForHarness } from './harnessBrand';

export function HarnessMark({
  harnessId,
  size = 16,
  color,
}: {
  harnessId: string | undefined;
  size?: number;
  color?: string;
}) {
  return <BrandMark svg={svgForHarness(harnessId, color)} size={size} />;
}
