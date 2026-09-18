#!/usr/bin/env node
// Verifies every `crates/`/`edge/`/`apps/` path cited in docs/PARITY.md
// exists in the pinned Zeron checkout (../_ref/zeron @ 853872d).
// Usage: node scripts/check-parity-paths.mjs  (from app/)

import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = join(APP, '..', 'docs', 'PARITY.md');
const REF = join(APP, '..', '..', '_ref', 'zeron');

const text = readFileSync(DOC, 'utf8');
const paths = new Set();
for (const m of text.matchAll(/`((?:crates|edge|apps)\/[^`\s]+?)`/g))
  paths.add(m[1].replace(/\/+$/, ''));

let fail = 0;
for (const p of [...paths].sort()) {
  const ok = existsSync(join(REF, p));
  if (!ok) {
    console.error(`MISSING  ${p}`);
    fail++;
  }
}
console.log(
  `${paths.size - fail}/${paths.size} cited paths exist under ${REF}`,
);
process.exit(fail === 0 ? 0 : 1);
