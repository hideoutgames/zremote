// Port of official iOS Motion.swift flavour words / FNV-1a seed
// (_ref/zeron/apps/ios/Zeron/Theme/Motion.swift).

export const FLAVOUR_WORDS = [
  'Zeroning',
  'Thinking',
  'Pondering',
  'Scheming',
  'Brewing',
  'Weaving',
  'Tinkering',
  'Musing',
  'Composing',
  'Sifting',
  'Untangling',
  'Distilling',
  'Sketching',
  'Plotting',
  'Riffing',
  'Combobulating',
  'Percolating',
  'Marinating',
  'Noodling',
  'Puzzling',
  'Conjuring',
] as const;

export const FLAVOUR_ROTATE_SECS = 7;

export const flavourSeed = (chatId: string): bigint => {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < chatId.length; i++) {
    // FNV-1a (Motion.swift) — xor + 64-bit wrap.
    // eslint-disable-next-line no-bitwise
    hash ^= BigInt(chatId.charCodeAt(i) & 0xff);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
};

export const flavourWord = (seed: bigint, elapsedSecs: number): string => {
  const elapsed = BigInt(Math.max(0, Math.floor(elapsedSecs)));
  const ix = Number(
    (seed + elapsed / BigInt(FLAVOUR_ROTATE_SECS)) %
      BigInt(FLAVOUR_WORDS.length),
  );
  return FLAVOUR_WORDS[ix];
};
