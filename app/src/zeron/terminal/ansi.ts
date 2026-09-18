// ANSI screen model — pure, tested. A fixed cols×rows grid plus a bounded
// scrollback, fed raw PTY bytes. Implements the subset the renderer needs:
// CR/LF/BS/TAB, wrapping, CUP/CUU/CUD/CUF/CUB/CHA/VPA cursor moves, ED/EL
// erase, SGR (bold/dim/italic/underline/inverse, 16/256/truecolor fg/bg),
// \x1b[?25l/h cursor visibility, OSC 0/2 → title. All other CSI/OSC/DCS
// sequences are consumed and ignored safely.

export const SCROLLBACK_MAX = 5000;

export interface CellStyle {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  /** Palette index 0–15, xterm 0–255, or [r,g,b]. */
  fg?: number | [number, number, number];
  bg?: number | [number, number, number];
}

export interface Cell {
  ch: string;
  style: CellStyle;
}

export interface ScreenState {
  cols: number;
  rows: number;
  /** Scrollback lines (oldest first), each a row of cells. */
  scrollback: Cell[][];
  /** The visible grid: rows of cells. */
  grid: Cell[][];
  cursorX: number;
  cursorY: number;
  cursorVisible: boolean;
  title?: string;
}

const emptyCell = (): Cell => ({ ch: ' ', style: {} });
const emptyRow = (cols: number): Cell[] =>
  Array.from({ length: cols }, emptyCell);

const SGR_FG_BASE = 30;
const SGR_BG_BASE = 40;
const SGR_FG_BRIGHT = 90;
const SGR_BG_BRIGHT = 100;

export class AnsiScreen {
  readonly cols: number;
  readonly rows: number;
  grid: Cell[][];
  scrollback: Cell[][] = [];
  x = 0;
  y = 0;
  cursorVisible = true;
  title?: string;
  private style: CellStyle = {};
  private saved = { x: 0, y: 0 };
  /** Bytes of a UTF-8 char split across write() calls. */
  private pending: number[] = [];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.grid = Array.from({ length: rows }, () => emptyRow(cols));
  }

  snapshot(): ScreenState {
    return {
      cols: this.cols,
      rows: this.rows,
      scrollback: this.scrollback,
      grid: this.grid,
      cursorX: this.x,
      cursorY: this.y,
      cursorVisible: this.cursorVisible,
      title: this.title,
    };
  }

  /** Feed raw bytes. */
  write(input: Uint8Array): void {
    const bytes =
      this.pending.length > 0
        ? Uint8Array.from([...this.pending, ...input])
        : input;
    this.pending = [];
    let i = 0;
    while (i < bytes.length) {
      const next = this.consume(bytes, i);
      if (next === i) {
        // Undecodable or truncated — stash the tail for the next write.
        this.pending = [...bytes.subarray(i)];
        return;
      }
      i = next;
    }
  }

  private consume(b: Uint8Array, i: number): number {
    const c = b[i];
    // Escape sequences
    if (c === 0x1b) {
      const n = b[i + 1];
      if (n === 0x5b) return this.csi(b, i + 2); // CSI
      if (n === 0x5d) return this.osc(b, i + 2); // OSC
      if (n === 0x50) return this.stTerminated(b, i + 2); // DCS — swallow
      if (n === 0x37) {
        this.saved = { x: this.x, y: this.y };
        return i + 2; // DECSC
      }
      if (n === 0x38) {
        this.x = this.saved.x;
        this.y = this.saved.y;
        return i + 2; // DECRC
      }
      if (n === 0x4d) {
        // RI — reverse index (scroll down / move up).
        if (this.y === 0)
          this.grid.unshift(emptyRow(this.cols)) && this.grid.pop();
        else this.y -= 1;
        return i + 2;
      }
      if (n === 0x44) {
        this.linefeed();
        return i + 2; // IND
      }
      if (n === 0x45) {
        this.x = 0;
        this.linefeed();
        return i + 2; // NEL
      }
      return i + 2; // unknown ESC sequence — drop
    }
    if (c === 0x0d) {
      this.x = 0;
      return i + 1;
    }
    if (c === 0x0a || c === 0x0b || c === 0x0c) {
      this.linefeed();
      return i + 1;
    }
    if (c === 0x08) {
      if (this.x > 0) this.x -= 1;
      return i + 1;
    }
    if (c === 0x09) {
      this.x = Math.min(this.cols - 1, (Math.floor(this.x / 8) + 1) * 8);
      return i + 1;
    }
    if (c < 0x20 || c === 0x7f) return i + 1; // other control bytes — ignore
    // UTF-8 decode; i (unchanged) signals "stash tail" for truncated chars.
    if (c >= 0x80) {
      const [ch, len] = decodeUtf8(b, i);
      if (ch === undefined) return i;
      this.putChar(ch);
      return i + len;
    }
    this.putChar(String.fromCharCode(c));
    return i + 1;
  }

  private putChar(ch: string): void {
    if (this.x >= this.cols) {
      this.x = 0;
      this.linefeed();
    }
    this.grid[this.y][this.x] = { ch, style: { ...this.style } };
    this.x += 1;
  }

  private linefeed(): void {
    if (this.y === this.rows - 1) {
      const top = this.grid.shift()!;
      this.scrollback.push(top);
      if (this.scrollback.length > SCROLLBACK_MAX) this.scrollback.shift();
      this.grid.push(emptyRow(this.cols));
    } else {
      this.y += 1;
    }
  }

  /** CSI — returns the index after the final byte. */
  private csi(b: Uint8Array, i: number): number {
    const start = i;
    while (i < b.length) {
      const c = b[i];
      if (c >= 0x40 && c <= 0x7e) break; // final byte
      i += 1;
    }
    if (i >= b.length) return i;
    const raw = String.fromCharCode(...b.subarray(start, i));
    const final = b[i];
    const isPrivate = raw.startsWith('?');
    const params = (isPrivate ? raw.slice(1) : raw)
      .split(';')
      .map(p => (p === '' ? 0 : Number(p)));
    const p = (n: number, dflt: number) =>
      params[n] === undefined || params[n] === 0 ? dflt : params[n];

    if (isPrivate) {
      if (final === 0x6c && params[0] === 25) this.cursorVisible = false; // ?25l
      if (final === 0x68 && params[0] === 25) this.cursorVisible = true; // ?25h
      return i + 1; // all other private modes ignored
    }

    switch (final) {
      case 0x48: // CUP
      case 0x66: // HVP
        this.y = clamp(p(0, 1) - 1, 0, this.rows - 1);
        this.x = clamp(p(1, 1) - 1, 0, this.cols - 1);
        break;
      case 0x41:
        this.y = clamp(this.y - p(0, 1), 0, this.rows - 1);
        break; // CUU
      case 0x42:
        this.y = clamp(this.y + p(0, 1), 0, this.rows - 1);
        break; // CUD
      case 0x43:
        this.x = clamp(this.x + p(0, 1), 0, this.cols - 1);
        break; // CUF
      case 0x44:
        this.x = clamp(this.x - p(0, 1), 0, this.cols - 1);
        break; // CUB
      case 0x47: // CHA
        this.x = clamp(p(0, 1) - 1, 0, this.cols - 1);
        break;
      case 0x64: // VPA
        this.y = clamp(p(0, 1) - 1, 0, this.rows - 1);
        break;
      case 0x45:
        this.y = clamp(this.y + p(0, 1), 0, this.rows - 1);
        this.x = 0;
        break; // CNL
      case 0x46:
        this.y = clamp(this.y - p(0, 1), 0, this.rows - 1);
        this.x = 0;
        break; // CPL
      case 0x4a: // ED
        this.eraseDisplay(params[0] ?? 0);
        break;
      case 0x4b: // EL
        this.eraseLine(params[0] ?? 0);
        break;
      case 0x6d: // SGR
        this.sgr(params);
        break;
      case 0x73: // save cursor (xterm)
        this.saved = { x: this.x, y: this.y };
        break;
      case 0x75: // restore cursor
        this.x = this.saved.x;
        this.y = this.saved.y;
        break;
      default:
        break; // ignore every other CSI
    }
    return i + 1;
  }

  /** OSC …BEL or …ESC\ — returns index after terminator. */
  private osc(b: Uint8Array, i: number): number {
    const bytes: number[] = [];
    while (i < b.length) {
      if (b[i] === 0x07) {
        this.applyOsc(bytes);
        return i + 1;
      }
      if (b[i] === 0x1b && b[i + 1] === 0x5c) {
        this.applyOsc(bytes);
        return i + 2;
      }
      bytes.push(b[i]);
      i += 1;
      if (bytes.length > 4096) return i; // pathological — abandon
    }
    return i;
  }

  /** DCS/other string — swallow through ST. */
  private stTerminated(b: Uint8Array, i: number): number {
    while (i < b.length) {
      if (b[i] === 0x1b && b[i + 1] === 0x5c) return i + 2;
      if (b[i] === 0x9c) return i + 1;
      i += 1;
    }
    return i;
  }

  private applyOsc(bytes: number[]): void {
    const s = new TextDecoder().decode(new Uint8Array(bytes));
    const sep = s.indexOf(';');
    if (sep === -1) return;
    const code = s.slice(0, sep);
    const value = s.slice(sep + 1);
    if (code === '0' || code === '2') this.title = value;
  }

  private eraseDisplay(mode: number): void {
    if (mode === 2 || mode === 3) {
      this.grid = Array.from({ length: this.rows }, () => emptyRow(this.cols));
      if (mode === 3) this.scrollback = [];
      return;
    }
    if (mode === 0) {
      this.eraseRange(this.y, this.x, this.rows - 1, this.cols - 1);
    } else if (mode === 1) {
      this.eraseRange(0, 0, this.y, this.x);
    }
  }

  private eraseLine(mode: number): void {
    if (mode === 0) this.eraseRange(this.y, this.x, this.y, this.cols - 1);
    else if (mode === 1) this.eraseRange(this.y, 0, this.y, this.x);
    else if (mode === 2) this.eraseRange(this.y, 0, this.y, this.cols - 1);
  }

  private eraseRange(y0: number, x0: number, y1: number, x1: number): void {
    for (let y = y0; y <= y1; y++)
      for (let x = y === y0 ? x0 : 0; x <= (y === y1 ? x1 : this.cols - 1); x++)
        this.grid[y][x] = emptyCell();
  }

  private sgr(params: number[]): void {
    if (params.length === 0) params = [0];
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (p === 0) this.style = {};
      else if (p === 1) this.style.bold = true;
      else if (p === 2) this.style.dim = true;
      else if (p === 3) this.style.italic = true;
      else if (p === 4) this.style.underline = true;
      else if (p === 7) this.style.inverse = true;
      else if (p === 22) {
        delete this.style.bold;
        delete this.style.dim;
      } else if (p === 23) delete this.style.italic;
      else if (p === 24) delete this.style.underline;
      else if (p === 27) delete this.style.inverse;
      else if (p === 39) delete this.style.fg;
      else if (p === 49) delete this.style.bg;
      else if (p >= SGR_FG_BASE && p <= 37) this.style.fg = p - SGR_FG_BASE;
      else if (p >= SGR_BG_BASE && p <= 47) this.style.bg = p - SGR_BG_BASE;
      else if (p >= SGR_FG_BRIGHT && p <= 97)
        this.style.fg = p - SGR_FG_BRIGHT + 8;
      else if (p >= SGR_BG_BRIGHT && p <= 107)
        this.style.bg = p - SGR_BG_BRIGHT + 8;
      else if (p === 38 || p === 48) {
        const target = p === 38 ? 'fg' : 'bg';
        const mode = params[i + 1];
        if (mode === 5 && params[i + 2] !== undefined) {
          this.style[target] = params[i + 2];
          i += 2;
        } else if (
          mode === 2 &&
          params[i + 2] !== undefined &&
          params[i + 3] !== undefined &&
          params[i + 4] !== undefined
        ) {
          this.style[target] = [params[i + 2], params[i + 3], params[i + 4]];
          i += 4;
        }
      }
    }
  }
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/** Decode one UTF-8 char starting at i; returns [char, byteLen]. */
const decodeUtf8 = (b: Uint8Array, i: number): [string | undefined, number] => {
  const c = b[i];
  let len = 1;
  if (c >= 0xf0) len = 4;
  else if (c >= 0xe0) len = 3;
  else if (c >= 0xc0) len = 2;
  if (i + len > b.length) return [undefined, 0];
  try {
    return [new TextDecoder().decode(b.subarray(i, i + len)), len];
  } catch {
    return ['', 1];
  }
};

// ── Base64 (PTY data frames are base64) ─────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Map([...B64].map((c, i) => [c, i]));

/* eslint-disable no-bitwise */
export const base64Decode = (s: string): Uint8Array => {
  const clean = s.replace(/[=]+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      ((B64_LOOKUP.get(clean[i]) ?? 0) << 18) |
      ((B64_LOOKUP.get(clean[i + 1]) ?? 0) << 12) |
      ((B64_LOOKUP.get(clean[i + 2]) ?? 0) << 6) |
      (B64_LOOKUP.get(clean[i + 3]) ?? 0);
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
};

export const base64Encode = (b: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < b.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < b.length ? B64[n & 63] : '=';
  }
  return out;
};
