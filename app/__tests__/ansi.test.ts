import {
  AnsiScreen,
  base64Decode,
  base64Encode,
} from '../src/zeron/terminal/ansi';

const enc = (s: string) => new TextEncoder().encode(s);
const rowText = (s: AnsiScreen, y: number) =>
  s.grid[y]
    .map(c => c.ch)
    .join('')
    .replace(/\s+$/, '');

test('plain text + CR/LF advance', () => {
  const s = new AnsiScreen(10, 4);
  s.write(enc('hello\r\nworld'));
  expect(rowText(s, 0)).toBe('hello');
  expect(rowText(s, 1)).toBe('world');
  expect(s.x).toBe(5);
  expect(s.y).toBe(1);
});

test('wrap at edge scrolls into scrollback when full', () => {
  const s = new AnsiScreen(5, 2);
  s.write(enc('1234567890AB')); // wraps at 5, then overflows rows
  expect(rowText(s, 0)).toBe('67890');
  expect(rowText(s, 1)).toBe('AB');
  expect(s.scrollback.map(r => r.map(c => c.ch).join(''))).toEqual(['12345']);
});

test('scrollback is bounded at 5000', () => {
  const s = new AnsiScreen(4, 1);
  for (let i = 0; i < 5010; i++) s.write(enc('x\n'));
  expect(s.scrollback.length).toBe(5000);
});

test('CUP / CUU / CUD / CUF / CUB / CHA / VPA', () => {
  const s = new AnsiScreen(20, 10);
  s.write(enc('abcdef'));
  s.write(enc('\x1b[2;3H')); // CUP row2 col3
  expect([s.x, s.y]).toEqual([2, 1]);
  s.write(enc('X'));
  expect(s.grid[1][2].ch).toBe('X');
  s.write(enc('\x1b[2D')); // CUB 2
  expect(s.x).toBe(1);
  s.write(enc('\x1b[5C')); // CUF 5
  expect(s.x).toBe(6);
  s.write(enc('\x1b[1A\x1b[2B')); // CUU1 CUD2
  expect(s.y).toBe(2);
  s.write(enc('\x1b[10G')); // CHA col10
  expect(s.x).toBe(9);
  s.write(enc('\x1b[5d')); // VPA row5
  expect(s.y).toBe(4);
});

test('ED/EL erase', () => {
  const s = new AnsiScreen(8, 3);
  s.write(enc('aaaa\r\nbbbb\r\ncccc'));
  s.write(enc('\x1b[1;1H\x1b[0J')); // erase below
  expect(rowText(s, 1)).toBe('');
  expect(rowText(s, 2)).toBe('');
  s.write(enc('\x1b[2J')); // clear all
  expect(rowText(s, 0)).toBe('');
  s.write(enc('zz'));
  s.write(enc('\x1b[1K')); // erase to cursor
  expect(rowText(s, 0)).toBe('');
});

test('SGR colors: 16 / 256 / truecolor, bold, inverse, reset', () => {
  const s = new AnsiScreen(10, 2);
  s.write(enc('\x1b[31mA\x1b[1mB\x1b[0mC'));
  expect(s.grid[0][0].style.fg).toBe(1);
  expect(s.grid[0][0].style.bold).toBeUndefined();
  expect(s.grid[0][1].style.fg).toBe(1);
  expect(s.grid[0][1].style.bold).toBe(true);
  expect(s.grid[0][2].style).toEqual({});
  s.write(enc('\x1b[38;5;200mD'));
  expect(s.grid[0][3].style.fg).toBe(200);
  s.write(enc('\x1b[48;2;10;20;30mE'));
  expect(s.grid[0][4].style.bg).toEqual([10, 20, 30]);
  s.write(enc('\x1b[7mF'));
  expect(s.grid[0][5].style.inverse).toBe(true);
});

test('OSC 0/2 set title; other CSI ignored', () => {
  const s = new AnsiScreen(10, 2);
  s.write(enc('\x1b]0;my shell\x07'));
  expect(s.title).toBe('my shell');
  s.write(enc('\x1b[?1049h\x1b[6nq')); // alt screen + DSR — ignored safely
  expect(rowText(s, 0)).toBe('q');
});

test('cursor visibility ?25l/?25h', () => {
  const s = new AnsiScreen(10, 2);
  s.write(enc('\x1b[?25l'));
  expect(s.cursorVisible).toBe(false);
  s.write(enc('\x1b[?25h'));
  expect(s.cursorVisible).toBe(true);
});

test('BS and TAB', () => {
  const s = new AnsiScreen(20, 2);
  s.write(enc('ab\bc'));
  expect(rowText(s, 0)).toBe('ac');
  s.write(enc('\x1b[1;1H1\t2'));
  expect(s.grid[0][0].ch).toBe('1');
  expect(s.grid[0][8].ch).toBe('2');
});

test('UTF-8 split across writes', () => {
  const s = new AnsiScreen(10, 2);
  const bytes = enc('€'); // 3 bytes
  s.write(bytes.subarray(0, 1));
  s.write(bytes.subarray(1));
  expect(s.grid[0][0].ch).toBe('€');
});

test('base64 round-trip', () => {
  const data = new Uint8Array([0, 1, 2, 250, 255]);
  expect(base64Decode(base64Encode(data))).toEqual(data);
});
