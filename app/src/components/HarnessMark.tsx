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
  const svg = svgForHarness(harnessId, color);
  if (svg === undefined) return null;
  return <BrandMark svg={svg} size={size} />;
}
