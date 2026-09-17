import { parseZeronLink, EDGE_ID_RE } from '../src/zeron/protocol/edge';

const HOST = 'edge.zeron.sh';

test('zeron://session/{chatId} parses and validates the id', () => {
  expect(parseZeronLink('zeron://session/abc_123-XYZ', HOST)).toEqual({
    kind: 'session',
    chatId: 'abc_123-XYZ',
  });
});

test('rejects ids outside the edge ID grammar', () => {
  expect(parseZeronLink('zeron://session/../escape', HOST)).toBeUndefined();
  expect(parseZeronLink('zeron://session/has space', HOST)).toBeUndefined();
  expect(parseZeronLink('zeron://session/', HOST)).toBeUndefined();
  expect(EDGE_ID_RE.test('a'.repeat(129))).toBe(false);
});

test('zeron://auth/callback requires code+state', () => {
  expect(parseZeronLink('zeron://auth/callback?code=c&state=s', HOST)).toEqual({
    kind: 'authCallback',
    code: 'c',
    state: 's',
  });
  expect(parseZeronLink('zeron://auth/callback?code=c', HOST)).toBeUndefined();
});

test('universal link on the edge host only', () => {
  expect(
    parseZeronLink(`https://${HOST}/auth/cli/callback?code=c&state=s`, HOST),
  ).toEqual({ kind: 'authCallback', code: 'c', state: 's' });
  // A lookalike host must not be accepted.
  expect(
    parseZeronLink(
      `https://evil.example/auth/cli/callback?code=c&state=s`,
      HOST,
    ),
  ).toBeUndefined();
  expect(
    parseZeronLink(`https://${HOST}/other/path?code=c&state=s`, HOST),
  ).toBeUndefined();
});

test('unrelated urls ignored', () => {
  expect(parseZeronLink('zeron://foo/bar', HOST)).toBeUndefined();
  expect(parseZeronLink('https://example.com', HOST)).toBeUndefined();
});
