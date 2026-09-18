import { base64ToBytes, bytesToBase64 } from '../base64';

describe('base64', () => {
  it('round-trips empty input', () => {
    const bytes = new Uint8Array(0);
    expect(bytesToBase64(bytes)).toBe('');
    expect(base64ToBytes('')).toEqual(bytes);
  });

  it.each([1, 2, 3])('round-trips %i-byte input (padding)', n => {
    const bytes = new Uint8Array([1, 2, 3].slice(0, n));
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('round-trips a 100 KB random array', () => {
    const bytes = new Uint8Array(100 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) % 256;
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('matches Buffer for a fixed vector', () => {
    const bytes = new Uint8Array([
      0, 1, 2, 127, 128, 200, 255, 66, 33, 250, 5, 99,
    ]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    expect(base64ToBytes(Buffer.from(bytes).toString('base64'))).toEqual(bytes);
  });
});
