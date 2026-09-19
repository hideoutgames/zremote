import { splitMarkdownFences } from '../src/components/transcript/splitMarkdownFences';

test('splitMarkdownFences isolates fenced blocks', () => {
  const parts = splitMarkdownFences(
    'Intro\n\n```ts\nconst x = 1;\n```\n\nOutro',
  );
  expect(parts).toEqual([
    { kind: 'prose', text: 'Intro\n' },
    { kind: 'code', lang: 'ts', text: 'const x = 1;', closed: true },
    { kind: 'prose', text: '\nOutro' },
  ]);
});

test('splitMarkdownFences keeps an unclosed fence open', () => {
  const parts = splitMarkdownFences('```js\nconsole.log(1);');
  expect(parts).toEqual([
    { kind: 'code', lang: 'js', text: 'console.log(1);', closed: false },
  ]);
});
