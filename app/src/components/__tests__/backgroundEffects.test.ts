import {
  ASCII_GLYPHS,
  ASCII_SKSL,
  DITHER_BAYER,
  DITHER_SKSL,
  HALFTONE_SKSL,
  asciiDensityIndex,
  asciiInk,
  ditherBayerAt,
  ditherColor,
  halftoneCoverage,
  halftoneRadius,
  mixTreatment,
  rec601Luma01,
  thumbnailSize,
} from '../backgroundEffects';

test('ASCII glyphs match the desktop 5×7 bitmap table', () => {
  expect(ASCII_GLYPHS).toEqual([
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
  ]);
});

test('ASCII SKSL embeds every glyph row mask', () => {
  for (const rows of ASCII_GLYPHS) {
    for (const bits of rows) {
      expect(ASCII_SKSL).toContain(`return ${bits}.0;`);
    }
  }
  expect(ASCII_SKSL).toContain('floor(sqrt(max(luma, 0.0)) * 9.0)');
  expect(ASCII_SKSL).not.toContain('* 9.0 + 0.5');
});

test('ascii density truncates sqrt(luma)*9 and does not round', () => {
  expect(asciiDensityIndex(0)).toBe(0);
  expect(asciiDensityIndex(1)).toBe(9);
  // 0.25 → sqrt 0.5 → 4.5; desktop `as usize` truncates to 4.
  expect(asciiDensityIndex(0.25)).toBe(4);
  expect(asciiDensityIndex(0.25)).not.toBe(5);
});

test('ascii ink tests the desktop glyph bits with a 1px gap', () => {
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 6; x += 1) {
      expect(asciiInk(x, y, 1)).toBe(x === 2 && y === 5);
    }
  }
  expect(asciiInk(2, 5, 1)).toBe(true);
  expect(asciiInk(8, 13, 1)).toBe(true);
  expect(asciiInk(5, 5, 1)).toBe(false);
  expect(asciiInk(2, 7, 1)).toBe(false);
  expect(asciiInk(0, 0, 0)).toBe(false);
  expect(asciiInk(2, 3, 3)).toBe(true);
});

test('halftone samples origin luma into the desktop radius and coverage', () => {
  expect(halftoneRadius(0)).toBeCloseTo(0.6, 5);
  expect(halftoneRadius(1)).toBeCloseTo(2, 5);
  const center = halftoneCoverage(1.5, 1.5, 1, 1);
  expect(center).toBe(1);
  const corner = halftoneCoverage(0, 0, 0, 1);
  expect(corner).toBe(0);
  expect(HALFTONE_SKSL).toContain('image.eval(origin + float2(0.5))');
  expect(HALFTONE_SKSL).toContain('image.eval(origin + float2(2.5))');
});

test('treatment mix is 60% source and 40% ink-or-paper', () => {
  expect(mixTreatment(100, 200, 0, 1)).toBeCloseTo(140, 5);
  expect(mixTreatment(100, 200, 0, 0)).toBeCloseTo(60, 5);
  expect(mixTreatment(100, 200, 255, 0)).toBeCloseTo(162, 5);
});

test('dither uses the desktop Bayer table and peak-gain color', () => {
  expect(DITHER_BAYER).toEqual([
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ]);
  expect(ditherBayerAt(0, 0)).toBe(0);
  expect(ditherBayerAt(2, 0)).toBe(8);
  expect(ditherBayerAt(0, 2)).toBe(12);
  const [r, g, b, a] = ditherColor([173, 89, 32, 180], 0);
  expect(a).toBe(180);
  expect(Math.max(r, g, b)).toBe(255);
  expect(r).toBeGreaterThanOrEqual(g);
  expect(g).toBeGreaterThanOrEqual(b);
  const dim = ditherColor([173, 89, 32, 180], 15);
  expect(dim[0]).toBe(Math.round(173 * 0.08));
  for (const row of DITHER_BAYER) {
    for (const cell of row) {
      expect(DITHER_SKSL).toContain(`${cell}.0`);
    }
  }
});

test('thumbnail caps the long edge at 2048 and preserves aspect', () => {
  expect(thumbnailSize(1024, 768)).toEqual({ width: 1024, height: 768 });
  expect(thumbnailSize(4096, 2048)).toEqual({ width: 2048, height: 1024 });
  expect(thumbnailSize(0, 10)).toEqual({ width: 0, height: 0 });
});

test('rec.601 luma matches the shader weights', () => {
  expect(rec601Luma01(1, 0, 0)).toBeCloseTo(0.299, 5);
  expect(rec601Luma01(0, 1, 0)).toBeCloseTo(0.587, 5);
  expect(rec601Luma01(0, 0, 1)).toBeCloseTo(0.114, 5);
});
