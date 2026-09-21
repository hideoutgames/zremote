import { closeHanging, PENDING_LINK_URL } from '../mendMarkdown';

const mends = (input: string, expected: string): void => {
  expect(closeHanging(input)).toBe(expected);
};

const stays = (input: string): void => {
  expect(closeHanging(input)).toBeUndefined();
};

describe('closeHanging', () => {
  it('leaves balanced text alone', () => {
    stays('plain words, no markers');
    stays('a **b** and *c* and `d` and ~~e~~');
    stays('[docs](https://x.dev) done');
    stays('');
  });

  it('closes bold and italic', () => {
    mends('**bold', '**bold**');
    mends('some *em', 'some *em*');
    mends('a __b', 'a __b__');
    mends('a _b', 'a _b_');
    mends('***both', '***both***');
  });

  it('completes half-streamed closers', () => {
    mends('**bold*', '**bold**');
    mends('__b_', '__b__');
    mends('~~gone~', '~~gone~~');
  });

  it('emits nested closers innermost-first', () => {
    mends('**a *b', '**a *b***');
    mends('*a **b', '*a **b***');
    mends('_a **b', '_a **b**_');
  });

  it('keeps bare openers literal until content', () => {
    stays('**');
    stays('text **');
    stays('text ** ');
    stays('*');
    stays('~~');
    stays('`');
  });

  it('inserts closers before trailing whitespace', () => {
    mends('**bold ', '**bold** ');
    mends('*em\n', '*em*\n');
  });

  it('treats intraword markers and escapes as literal', () => {
    stays('2*3 equals 6');
    stays('snake_case_name');
    stays('20~25 degrees');
    stays('\\*not emphasis');
    stays('a \\** b');
  });

  it('does not treat list markers as openers', () => {
    stays('* item one');
    stays('- a\n* b');
  });

  it('closes strikethrough', () => {
    mends('~~gone', '~~gone~~');
    stays('~single~x');
  });

  it('closes inline code and shields markers', () => {
    mends('`code', '`code`');
    mends('call `a ** b', 'call `a ** b`');
    mends('``a`', '``a```');
    stays('`done` after');
  });

  it('mends links to the pending sentinel', () => {
    mends('[docs](https://x.dev/lo', `[docs](${PENDING_LINK_URL})`);
    mends('[docs](', `[docs](${PENDING_LINK_URL})`);
    mends('see [do', `see [do](${PENDING_LINK_URL})`);
    mends('![alt](https://x/i.p', `![alt](${PENDING_LINK_URL})`);
    stays('see [');
    stays('[x] task-like');
  });

  it('allows nested parens in completed link URLs', () => {
    stays('[a](https://x.dev/(y)) done');
    mends('[a](https://x.dev/(y', `[a](${PENDING_LINK_URL})`);
  });

  it('closes emphasis inside link text', () => {
    mends('[**a', `[**a**](${PENDING_LINK_URL})`);
    mends('**a [b', `**a [b](${PENDING_LINK_URL})**`);
  });

  it('drops emphasis unclosed in a completed bracket', () => {
    stays('[**a] done');
  });

  it('inserts a zero-width space on partial setext underlines', () => {
    mends('para\n-', 'para\n-\u200B');
    mends('para\n--', 'para\n--\u200B');
    mends('para\n=', 'para\n=\u200B');
    stays('para\n---');
    stays('-');
    stays('\n-');
    mends('**b\n-', '**b**\n-\u200B');
  });
});
