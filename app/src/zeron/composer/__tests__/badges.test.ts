import {
  applyDisplayEdit,
  canonicalToDisplay,
  commitExactReferences,
  composerSurface,
  displayToCanonical,
  type CommitExactOptions,
} from '../badges';
import { invocationLink, localFileLink } from '../../protocol/references';
import type { InvocationCandidate } from '../completion';

const help = invocationLink({ kind: 'command', name: 'help' });
const skill = invocationLink({
  kind: 'skill',
  name: 'review',
  path: '.agents/skills/review/SKILL.md',
});

const command = (name: string): InvocationCandidate => ({
  name,
  description: name,
  invocation: { kind: 'command', name },
});

const skillRow = (name: string): InvocationCandidate => ({
  name,
  description: name,
  invocation: {
    kind: 'skill',
    name,
    path: `.agents/skills/${name}/SKILL.md`,
  },
});

const options = (
  over: Partial<CommitExactOptions> = {},
): CommitExactOptions => ({
  rows: [
    command('help'),
    skillRow('review'),
    { ...command('model'), workspaceCommand: 'model' },
  ],
  includeSkillsInSlash: true,
  dollarSkills: false,
  mentionResults: [],
  atEnd: false,
  supported: true,
  ...over,
});

describe('composerSurface', () => {
  it('paints canonical links as short labels', () => {
    const surface = composerSurface(`run ${help} then ${skill}`);
    expect(surface.display).toBe('run /help then $review');
    expect(
      surface.runs.filter(run => run.kind !== undefined).map(r => r.kind),
    ).toEqual(['command', 'skill']);
    const file = localFileLink('src/app.ts', false);
    expect(composerSurface(`see ${file}`).display).toBe('see @app.ts');
  });

  it('maps carets through a badge without landing in the payload', () => {
    const surface = composerSurface(`go ${help} now`);
    const badge = surface.spans[0];
    expect(displayToCanonical(surface, badge.displayStart)).toBe(
      badge.canonicalStart,
    );
    expect(displayToCanonical(surface, badge.displayStart + 2)).toBe(
      badge.canonicalEnd,
    );
    expect(canonicalToDisplay(surface, badge.canonicalEnd)).toBe(
      badge.displayEnd,
    );
    expect(canonicalToDisplay(surface, badge.canonicalEnd + 1)).toBe(
      badge.displayEnd + 1,
    );
  });
});

describe('applyDisplayEdit', () => {
  it('edits plain text around a badge', () => {
    const next = applyDisplayEdit(`go ${help} now`, 'go /help later');
    expect(composerSurface(next).display).toBe('go /help later');
    expect(next.includes('zeron-invoke:')).toBe(true);
  });

  it('deletes a badge atomically when the caret edits inside it', () => {
    const next = applyDisplayEdit(`go ${help} now`, 'go /elp now');
    expect(next).toBe('go  now');
  });
});

describe('commitExactReferences', () => {
  it('commits a typed /command once it is closed, without a menu pick', () => {
    const open = commitExactReferences('please /help', options());
    expect(open.text).toBe('please /help');
    const closed = commitExactReferences('please /help now', options());
    expect(closed.text.startsWith('please ')).toBe(true);
    expect(closed.text.endsWith(' now')).toBe(true);
    expect(composerSurface(closed.text).display).toBe('please /help now');
    expect(closed.text).toContain('zeron-invoke:');
  });

  it('commits a token at the end of the text on send', () => {
    const sent = commitExactReferences('/help', options({ atEnd: true }));
    expect(composerSurface(sent.text).display).toBe('/help');
    expect(sent.text).toBe(help);
  });

  it('leaves workspace commands as typed text', () => {
    const sent = commitExactReferences('/model', options({ atEnd: true }));
    expect(sent.text).toBe('/model');
  });

  it('commits $skills only when the harness uses the dollar trigger', () => {
    const plain = commitExactReferences('$review ', options());
    expect(plain.text).toBe('$review ');
    const codex = commitExactReferences(
      '$review ',
      options({ dollarSkills: true, includeSkillsInSlash: false }),
    );
    expect(composerSurface(codex.text).display).toBe('$review ');
    expect(codex.text).toContain('zeron-invoke:');
  });

  it('commits a typed @path and a unique basename from search', () => {
    const path = commitExactReferences('see @src/app.ts ', options());
    expect(composerSurface(path.text).display).toBe('see @app.ts ');
    expect(path.text).toContain('zeron-file:src/app.ts');
    const named = commitExactReferences(
      'see @app.ts ',
      options({
        mentionQuery: 'app.ts',
        mentionResults: [{ path: 'src/app.ts', isDir: false }],
      }),
    );
    expect(named.text).toContain('zeron-file:src/app.ts');
  });

  it('does not invent a file from a stale search', () => {
    const named = commitExactReferences(
      'see @other ',
      options({
        mentionQuery: 'app.ts',
        mentionResults: [{ path: 'src/app.ts', isDir: false }],
      }),
    );
    expect(named.text).toBe('see @other ');
  });
});
