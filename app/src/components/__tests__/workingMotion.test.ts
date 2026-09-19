import { flavourSeed, flavourWord, FLAVOUR_WORDS } from '../workingMotion';

test('flavourWord is deterministic and rotates every 7s', () => {
  const seed = flavourSeed('chat-1');
  const a = flavourWord(seed, 0);
  const b = flavourWord(seed, 6);
  const c = flavourWord(seed, 7);
  expect(FLAVOUR_WORDS).toContain(a);
  expect(b).toBe(a);
  expect(c).not.toBe(a);
  expect(flavourWord(seed, 0)).toBe(a);
});
