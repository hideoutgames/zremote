// Desktop-faithful new-thread background treatments. SKSL is generated from
// the same glyph / Bayer tables the TS helpers use so tests pin both.

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
  2 * (0.3 + 0.7 * Math.sqrt(Math.max(luma01, 0)));

export const halftoneCoverage = (
  dx: number,
  dy: number,
  luma01: number,
  alpha01: number,
): number => {
  const distance = Math.hypot(dx - 1.5, dy - 1.5);
  const coverage = Math.min(
    1,
    Math.max(0, halftoneRadius(luma01) + 0.5 - distance),
  );
  return coverage * alpha01;
};

export const mixTreatment = (
  source: number,
  ink: number,
  paper: number,
  coverage: number,
): number => source * 0.6 + (ink * coverage + paper * (1 - coverage)) * 0.4;

export const ditherBayerAt = (x: number, y: number): number => {
  const cellX = Math.floor(x / 2);
  const cellY = Math.floor(y / 2);
  const row = DITHER_BAYER[((cellY % 4) + 4) % 4];
  return row[((cellX % 4) + 4) % 4];
};

export const ditherColor = (
  rgba: readonly [number, number, number, number],
  threshold: number,
): [number, number, number, number] => {
  const [r, g, b, a] = rgba;
  const peak = Math.max(r, g, b);
  const bright = peak / 255 > (threshold + 0.5) / 16;
  const gain = bright ? 255 / Math.max(peak, 1) : 0.08;
  return [Math.round(r * gain), Math.round(g * gain), Math.round(b * gain), a];
};

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

export const SCANLINES_SKSL = `
uniform shader image;
uniform float light;
half4 main(float2 xy) {
  half4 c = image.eval(floor(xy) + float2(0.5));
  float gain = mod(floor(xy.y), 3.0) < 0.5 ? 0.52 : 1.0;
  half3 rgb = light > 0.5
    ? c.rgb + (half3(1.0) - c.rgb) * (1.0 - gain)
    : c.rgb * gain;
  return half4(rgb, c.a);
}
`;

export const DITHER_SKSL = `
uniform shader image;
half4 main(float2 xy) {
  float2 origin = floor(xy / 2.0) * 2.0;
  half4 c = image.eval(origin + float2(1.5));
  float2 p = floor(xy / 2.0);
  float bx = mod(p.x, 4.0);
  float by = mod(p.y, 4.0);
${bayerLookupSksl()}
  float peak = max(max(c.r, c.g), c.b);
  float bright = step((bayer + 0.5) / 16.0, peak);
  float gain = mix(0.08, 1.0 / max(peak, 1.0 / 255.0), bright);
  half3 rgb = clamp(floor(c.rgb * gain * 255.0 + 0.5) / 255.0, 0.0, 1.0);
  return half4(rgb, c.a);
}
`;

export const HALFTONE_SKSL = `
uniform shader image;
uniform float light;
half4 main(float2 xy) {
  float2 origin = floor(xy / 4.0) * 4.0;
  half4 lumaPix = image.eval(origin + float2(0.5));
  half4 sample = image.eval(origin + float2(2.5));
  half4 src = image.eval(floor(xy) + float2(0.5));
  float luma = dot(lumaPix.rgb, half3(0.299, 0.587, 0.114));
  if (light > 0.5) luma = 1.0 - luma;
  float radius = 2.0 * (0.3 + 0.7 * sqrt(max(luma, 0.0)));
  float dist = length(xy - (origin + float2(1.5)));
  float coverage = clamp(radius + 0.5 - dist, 0.0, 1.0) * sample.a;
  float paper = light > 0.5 ? 1.0 : 0.0;
  half3 mixed = src.rgb * 0.60
    + mix(half3(paper), sample.rgb, coverage) * 0.40;
  return half4(mixed, src.a);
}
`;

export const ASCII_SKSL = `
uniform shader image;
uniform float light;
${asciiGlyphRowSksl()}
half4 main(float2 xy) {
  float2 cell = float2(6.0, 8.0);
  float2 origin = floor(xy / cell) * cell;
  half4 sample = image.eval(origin + float2(3.5, 4.5));
  half4 src = image.eval(floor(xy) + float2(0.5));
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
  half3 mixed = src.rgb * 0.60
    + mix(half3(paper), sample.rgb, ink) * 0.40;
  return half4(mixed, src.a);
}
`;
