// Screen-space new-thread background treatments. Pattern cells are measured
// in view points and the source image is sampled through cover-fit inside
// the shader, so a large wallpaper is not filtered down to a faint tint.
// SKSL is generated from the same glyph / Bayer tables the TS helpers use
// so tests pin both. Dither is the original 2-point ordered 4-level quantize.

export const BACKGROUND_EFFECT_MAX_EDGE = 2048;

/** Five-column bitmap glyphs, one column/row of spacing. Mirrors desktop. */
export const ASCII_GLYPHS: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 4, 0],
  [0, 4, 0, 0, 4, 0, 0],
  [0, 0, 0, 14, 0, 0, 0],
  [0, 0, 14, 0, 14, 0, 0],
  [0, 4, 4, 31, 4, 4, 0],
  [0, 21, 14, 31, 14, 21, 0],
  [10, 10, 31, 10, 31, 10, 10],
  [17, 2, 4, 4, 8, 16, 17],
  [14, 17, 23, 21, 23, 16, 14],
];

export const DITHER_BAYER: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Bayer matrix cell, in view points. The 4×4 pattern repeats every 8 points. */
export const DITHER_CELL = 2;

/** Halftone dot pitch, in view points. */
export const HALFTONE_CELL = 8;

/** Dark scanline gain. One of every three view-point rows. */
export const SCANLINE_GAIN = 0.32;

export const thumbnailSize = (
  width: number,
  height: number,
  maxEdge: number = BACKGROUND_EFFECT_MAX_EDGE,
): { width: number; height: number } => {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  if (width <= maxEdge && height <= maxEdge) return { width, height };
  const scale = Math.min(maxEdge / width, maxEdge / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

/** Cover-fit a source rect onto a dest canvas: scale first, then center. */
export type CoverFitTransform = [
  { translateX: number },
  { translateY: number },
  { scale: number },
];

export const coverFitTransform = (
  srcW: number,
  srcH: number,
  destW: number,
  destH: number,
): CoverFitTransform => {
  if (srcW <= 0 || srcH <= 0 || destW <= 0 || destH <= 0) {
    return [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }];
  }
  const scale = Math.max(destW / srcW, destH / srcH);
  return [
    { translateX: (destW - srcW * scale) / 2 },
    { translateY: (destH - srcH * scale) / 2 },
    { scale },
  ];
};

/** Rec.601 luma in 0..1, matching desktop `to_luma8` / shader dots. */
export const rec601Luma01 = (r: number, g: number, b: number): number =>
  0.299 * r + 0.587 * g + 0.114 * b;

/** Truncating `sqrt(luma) * 9` → 0..9, not rounded. */
export const asciiDensityIndex = (luma01: number): number => {
  const index = Math.floor(Math.sqrt(Math.max(luma01, 0)) * 9);
  return Math.max(0, Math.min(ASCII_GLYPHS.length - 1, index));
};

export const asciiInk = (x: number, y: number, level: number): boolean => {
  const lx = ((x % 6) + 6) % 6;
  const ly = ((y % 8) + 8) % 8;
  if (lx >= 5 || ly >= 7) return false;
  const rows = ASCII_GLYPHS[level];
  if (rows === undefined) return false;
  const row = rows[ly];
  if (row === undefined) return false;
  // Same bit test as desktop GLYPHS[index][y%8] & (1 << (4 - x%6)).
  // eslint-disable-next-line no-bitwise
  return (row & (1 << (4 - lx))) !== 0;
};

export const halftoneRadius = (luma01: number): number =>
  (HALFTONE_CELL / 2) * (0.3 + 0.7 * Math.sqrt(Math.max(luma01, 0)));

export const halftoneCoverage = (
  dx: number,
  dy: number,
  luma01: number,
  alpha01: number,
): number => {
  const center = HALFTONE_CELL / 2;
  const distance = Math.hypot(dx - center, dy - center);
  const coverage = Math.min(
    1,
    Math.max(0, halftoneRadius(luma01) + 0.5 - distance),
  );
  return coverage * alpha01;
};

/** Full ink-or-paper replacement. The source pixel does not bleed through. */
export const mixTreatment = (
  ink: number,
  paper: number,
  coverage: number,
): number => ink * coverage + paper * (1 - coverage);

/** Bayer index for a 2-point cell: `floor(x / 2)`, `floor(y / 2)`. */
export const ditherBayerAt = (x: number, y: number): number => {
  const px = Math.floor(x / DITHER_CELL);
  const py = Math.floor(y / DITHER_CELL);
  const row = DITHER_BAYER[((py % 4) + 4) % 4];
  return row[((px % 4) + 4) % 4];
};

/** Ordered Bayer dither: 4-level channel quantize stepped by the Bayer offset. */
export const ditherQuantize = (value01: number, bayer: number): number =>
  Math.min(1, Math.max(0, Math.floor(value01 * 4 + bayer / 16 - 0.5) / 4));

const asciiGlyphRowSksl = (): string => {
  const lines: string[] = ['float glyphRow(float g, float r) {'];
  ASCII_GLYPHS.forEach((rows, g) => {
    const checks = rows
      .map((bits, r) => `    if (abs(r - ${r}.0) < 0.5) { return ${bits}.0; }`)
      .join('\n');
    if (g < ASCII_GLYPHS.length - 1) {
      lines.push(`  if (g < ${g}.5) {`);
      lines.push(checks);
      lines.push('    return 0.0;');
      lines.push('  }');
    } else {
      lines.push(checks);
      lines.push('  return 0.0;');
    }
  });
  lines.push('}');
  return lines.join('\n');
};

const bayerLookupSksl = (): string => {
  const lines: string[] = ['  float bayer = 0.0;'];
  DITHER_BAYER.forEach((row, by) => {
    const expr = `bx < 0.5 ? ${row[0]}.0 : bx < 1.5 ? ${row[1]}.0 : bx < 2.5 ? ${row[2]}.0 : ${row[3]}.0`;
    if (by === 0) {
      lines.push('  if (by < 0.5) {');
    } else if (by < DITHER_BAYER.length - 1) {
      lines.push(`  } else if (by < ${by}.5) {`);
    } else {
      lines.push('  } else {');
    }
    lines.push(`    bayer = ${expr};`);
  });
  lines.push('  }');
  return lines.join('\n');
};

const coverUniformsSksl = (light: boolean): string =>
  `uniform shader image;
uniform float srcW;
uniform float srcH;
uniform float destW;
uniform float destH;
${light ? 'uniform float light;\n' : ''}float2 coverUv(float2 p) {
  float scale = max(destW / srcW, destH / srcH);
  float2 fitted = float2(destW - srcW * scale, destH - srcH * scale) * 0.5;
  return (p - fitted) / scale;
}`;

export const SCANLINES_SKSL = `
${coverUniformsSksl(true)}
half4 main(float2 xy) {
  half4 c = image.eval(coverUv(floor(xy) + float2(0.5)));
  float gain = mod(floor(xy.y), 3.0) < 0.5 ? ${SCANLINE_GAIN} : 1.0;
  half3 rgb = light > 0.5
    ? c.rgb + (half3(1.0) - c.rgb) * (1.0 - gain)
    : c.rgb * gain;
  return half4(rgb, c.a);
}
`;

export const DITHER_SKSL = `
${coverUniformsSksl(false)}
half4 main(float2 xy) {
  float2 cell = float2(${DITHER_CELL}.0);
  float2 origin = floor(xy / cell) * cell;
  half4 c = image.eval(coverUv(origin + cell * 0.5));
  float2 p = floor(xy / ${DITHER_CELL}.0);
  float bx = mod(p.x, 4.0);
  float by = mod(p.y, 4.0);
${bayerLookupSksl()}
  half3 q = floor(c.rgb * 4.0 + ((bayer / 16.0) - 0.5)) / 4.0;
  return half4(clamp(q, 0.0, 1.0), c.a);
}
`;

export const HALFTONE_SKSL = `
${coverUniformsSksl(true)}
half4 main(float2 xy) {
  float cell = ${HALFTONE_CELL}.0;
  float2 origin = floor(xy / cell) * cell;
  float2 center = origin + float2(cell * 0.5);
  half4 sample = image.eval(coverUv(center));
  float luma = dot(sample.rgb, half3(0.299, 0.587, 0.114));
  if (light > 0.5) luma = 1.0 - luma;
  float radius = (cell * 0.5) * (0.3 + 0.7 * sqrt(max(luma, 0.0)));
  float dist = length(xy - center);
  float coverage = clamp(radius + 0.5 - dist, 0.0, 1.0) * sample.a;
  float paper = light > 0.5 ? 1.0 : 0.0;
  half3 rgb = mix(half3(paper), sample.rgb, coverage);
  return half4(rgb, sample.a);
}
`;

export const ASCII_SKSL = `
${coverUniformsSksl(true)}
${asciiGlyphRowSksl()}
half4 main(float2 xy) {
  float2 cell = float2(6.0, 8.0);
  float2 origin = floor(xy / cell) * cell;
  half4 sample = image.eval(coverUv(origin + cell * 0.5));
  float luma = dot(sample.rgb, half3(0.299, 0.587, 0.114));
  if (light > 0.5) luma = 1.0 - luma;
  float level = floor(sqrt(max(luma, 0.0)) * 9.0);
  float2 local = floor(xy) - origin;
  float inGlyph = step(local.x, 4.5) * step(local.y, 6.5);
  float rowBits = glyphRow(level, local.y);
  float mask = pow(2.0, 4.0 - local.x);
  float inkBit = step(0.5, mod(floor(rowBits / mask + 0.0001), 2.0));
  float ink = inGlyph * inkBit;
  float paper = light > 0.5 ? 1.0 : 0.0;
  half3 rgb = mix(half3(paper), sample.rgb, ink);
  return half4(rgb, sample.a);
}
`;
