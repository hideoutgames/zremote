// Composer completion port — token parsing, filtering, insertion, catalog
// merging, and send gating against desktop composer.rs vectors.
import {
  completionTrigger,
  filterIndices,
  invocationCandidates,
  invocationInsertion,
  invocationToken,
  mentionToken,
  menuStep,
  mergeInvocationResults,
  referenceSuffix,
  referencesRequireUpdate,
  removeCompletionToken,
  replaceCompletionToken,
  skillDisplayName,
  skillPrefsForHarness,
  slashToken,
  withWorkspaceCommands,
  workspaceCommandForText,
  type InvocationCandidate,
  type SkillPrefs,
} from '../completion';
import {
  escapeLabel,
  fileMentionLinks,
  invocationLink,
  invocationLinks,
  localFileLink,
  localPathIsSafe,
  percentDecodePath,
  percentEncodePath,
  type Skill,
} from '../../protocol/references';
import type { SlashCommand } from '../../protocol/types';

const NON_CODEX: SkillPrefs = { dollar: false, separateFromSlash: false };
const CODEX: SkillPrefs = { dollar: true, separateFromSlash: true };

const skill = (over: Partial<Skill> = {}): Skill => ({
  name: 'review',
  path: 'skills/review/SKILL.md',
  description: 'Review code',
  enabled: true,
  ...over,
});

describe('slashToken', () => {
  it('finds a token at prose boundaries', () => {
    expect(slashToken('/cm', 3)).toEqual({ start: 0, end: 3, query: 'cm' });
    expect(slashToken('hi /cm', 6)).toEqual({
      start: 3,
      end: 6,
      query: 'cm',
    });
    expect(slashToken('(/cm', 4)?.start).toBe(1);
    expect(slashToken('x[/cm', 5)?.start).toBe(2);
    // `>` boundary only inside a blockquote prefix — `x>` is not one.
    expect(slashToken('x>/cm', 5)).toBeUndefined();
    expect(slashToken('>/cm', 4)?.start).toBe(1);
    expect(slashToken('> > /cm', 7)?.start).toBe(4);
  });

  it('rejects mid-word and inside code', () => {
    expect(slashToken('hello/cm', 8)).toBeUndefined();
    expect(slashToken('`/cm`', 3)).toBeUndefined();
    expect(slashToken('```\n/cm\n```', 7)).toBeUndefined();
    expect(slashToken('    /cm', 7)).toBeUndefined(); // indented code
  });

  it('rejects inside links and reference definitions', () => {
    expect(slashToken('[a](/cm)', 5)).toBeUndefined();
    expect(slashToken('[a](/cm', 6)).toBeUndefined();
    expect(slashToken('[a]: /cm', 8)).toBeUndefined();
  });

  it('rejects tokens ending before a path slash', () => {
    expect(slashToken('/cmd/x', 4)).toBeUndefined();
  });

  it('keeps name chars - _ : . and rejects others', () => {
    expect(slashToken('/a-b_c:d.e', 10)?.query).toBe('a-b_c:d.e');
    // A space closes the token — the caret then sits on a new word.
    expect(slashToken('/a b', 2)?.query).toBe('a');
    expect(slashToken('/a b', 3)).toBeUndefined();
    expect(slashToken('hi /a b', 5)?.query).toBe('a');
    expect(slashToken('hi /a b', 7)).toBeUndefined();
  });

  it('scopes query to the caret, not past it', () => {
    const text = '/cmd rest';
    expect(slashToken(text, 4)?.query).toBe('cmd');
  });
});

describe('invocationToken($)', () => {
  it('rejects a leading number', () => {
    expect(invocationToken('$5', 2, '$')).toBeUndefined();
    expect(invocationToken('$f5', 3, '$')?.query).toBe('f5');
  });
});

describe('mentionToken', () => {
  it('finds a token at prose boundaries', () => {
    expect(mentionToken('@src/ma', 7)).toEqual({
      start: 0,
      end: 7,
      query: 'src/ma',
    });
    expect(mentionToken('see @src/ma', 11)?.query).toBe('src/ma');
    expect(mentionToken('(@x', 3)?.start).toBe(1);
  });

  it('rejects emails and words with @', () => {
    expect(mentionToken('a@b.com', 7)).toBeUndefined();
    expect(mentionToken('name@example.com', 16)).toBeUndefined();
  });

  it('rejects a second @ in the query', () => {
    expect(mentionToken('@a@b', 4)).toBeUndefined();
  });

  it('respects closing parens', () => {
    // Caret before the closer — the token ends just short of it.
    expect(mentionToken('(@src/ma', 8)?.end).toBe(8);
    expect(mentionToken('(@src)', 5)).toEqual({
      start: 1,
      end: 5,
      query: 'src',
    });
    // A ')' inside the query rejects the token entirely.
    expect(mentionToken('(@s)rc', 6)).toBeUndefined();
    expect(mentionToken('(@s)rc', 4)).toBeUndefined();
  });

  it('rejects inside code', () => {
    expect(mentionToken('`@x`', 3)).toBeUndefined();
    expect(mentionToken('```\n@x\n```', 7)).toBeUndefined();
  });
});

describe('completionMarkdownEnd emphasis clamp', () => {
  it('clamps the token end to the closing delimiter', () => {
    // `*em /cmd*` — caret at the closer boundary is fine, past it rejects.
    expect(slashToken('*em /cmd*', 8)?.end).toBe(8);
    expect(slashToken('*em /cmd*', 9)).toBeUndefined();
  });
  it('respects underscore intraword rules', () => {
    // foo_bar_ /x — the trailing `_` after bar can't open emphasis.
    expect(slashToken('foo_bar_ /x', 11)?.query).toBe('x');
  });
});

describe('completionTrigger', () => {
  it('$ is literal for non-codex, separate trigger for codex', () => {
    expect(completionTrigger('$x', 2, NON_CODEX).skill).toBe(false);
    expect(completionTrigger('$x', 2, NON_CODEX).token).toBeUndefined();
    const trig = completionTrigger('$x', 2, CODEX);
    expect(trig.skill).toBe(true);
    expect(trig.commandsAllowed).toBe(false);
  });
  it('includeSkills merges into / for non-codex', () => {
    expect(completionTrigger('/', 1, NON_CODEX).includeSkills).toBe(true);
    expect(completionTrigger('/', 1, CODEX).includeSkills).toBe(false);
    expect(completionTrigger('$', 1, CODEX).includeSkills).toBe(true);
  });
});

describe('menu primitives', () => {
  it('menuStep wraps and handles empty/undefined', () => {
    expect(menuStep(undefined, 3, 1)).toBe(0);
    expect(menuStep(undefined, 3, -1)).toBe(2);
    expect(menuStep(0, 3, -1)).toBe(2);
    expect(menuStep(2, 3, 1)).toBe(0);
    expect(menuStep(0, 0, 1)).toBeUndefined();
  });
  it('filterIndices ranks prefix before substring, stable', () => {
    const labels = ['clear', 'context', 'compact', 'decode', 'new'];
    expect(filterIndices('c', labels)).toEqual([0, 1, 2, 3]);
    // context+compact prefix-match; decode only contains 'co'.
    expect(filterIndices('co', labels)).toEqual([1, 2, 3]);
    expect(filterIndices('z', labels)).toEqual([]);
    expect(filterIndices('', labels)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('insertion', () => {
  it('referenceSuffix matches the char class table', () => {
    expect(referenceSuffix(undefined)).toEqual([' ', 0]);
    expect(referenceSuffix('\n')).toEqual(['', 0]);
    expect(referenceSuffix(' ')).toEqual(['', 1]);
    expect(referenceSuffix(')')).toEqual(['', 0]);
    expect(referenceSuffix('.')).toEqual(['', 0]);
    expect(referenceSuffix('x')).toEqual([' ', 0]);
  });

  it('replaceCompletionToken inserts and places the caret', () => {
    const out = replaceCompletionToken(
      'hi /cm',
      { start: 3, end: 6, query: 'cm' },
      'X',
    );
    expect(out).toEqual({ text: 'hi X ', cursor: 5 });
    const inside = replaceCompletionToken(
      'see (@ab, x',
      { start: 5, end: 8, query: 'ab' },
      'Y',
    );
    // `,` is a no-suffix char → no trailing space.
    expect(inside).toEqual({ text: 'see (Y, x', cursor: 6 });
  });

  it('removeCompletionToken clears sole-content tokens entirely', () => {
    expect(
      removeCompletionToken('  /stop  ', { start: 2, end: 7, query: 'stop' }),
    ).toBe('');
    expect(
      removeCompletionToken('a /x b', { start: 2, end: 4, query: 'x' }),
    ).toBe('a b');
  });
});

describe('workspace commands', () => {
  const rows = withWorkspaceCommands([], true);
  it('appends the catalog, filtered by in_chat', () => {
    const names = rows.map(r => r.name);
    expect(names).toEqual([
      'model',
      'new',
      'resume',
      'settings',
      'diff',
      'files',
      'terminal',
      'rename',
      'stop',
    ]);
    const compose = withWorkspaceCommands([], false).map(r => r.name);
    expect(compose).toEqual(['model', 'new', 'resume', 'settings']);
    expect(compose).not.toContain('files');
  });

  it('zeron:-prefixes provider name collisions', () => {
    const provider: InvocationCandidate = {
      name: 'files',
      description: 'provider files',
      invocation: { kind: 'command', name: 'files' },
    };
    const merged = withWorkspaceCommands([provider], true);
    expect(merged.map(r => r.name)).toContain('zeron:files');
    expect(merged.find(r => r.name === 'zeron:files')?.workspaceCommand).toBe(
      'files',
    );
    expect(
      merged.find(r => r.name === 'files')?.workspaceCommand,
    ).toBeUndefined();
  });

  it('workspaceCommandForText only accepts sole-content tokens', () => {
    expect(workspaceCommandForText('/stop', rows)).toBe('stop');
    expect(workspaceCommandForText('  /stop  ', rows)).toBe('stop');
    expect(workspaceCommandForText('/stop now', rows)).toBeUndefined();
    expect(workspaceCommandForText('x /stop', rows)).toBeUndefined();
    expect(workspaceCommandForText('/unknown', rows)).toBeUndefined();
  });
});

describe('invocationCandidates', () => {
  const commands: SlashCommand[] = [
    { name: 'review', description: 'Run review' },
    { name: 'bad name', description: 'invalid' },
    { name: 'help', description: 'Help', inputHint: 'topic' },
  ];
  it('drops invalid names and shadows provider commands owned by skills', () => {
    const out = invocationCandidates(commands, [
      skill({ name: 'rev', command: { name: 'review', harness: 'claude' } }),
      skill({ name: 'bad skill!', path: 'p' }),
      skill({ name: 'off', enabled: false }),
    ]);
    const names = out.map(c => c.name);
    expect(names).not.toContain('bad name');
    expect(names).not.toContain('review'); // shadowed by the skill command
    expect(names).not.toContain('bad skill!');
    expect(names).not.toContain('off'); // disabled skills filtered
    expect(names).toContain('help');
    expect(names).toContain('rev');
    expect(out.find(c => c.name === 'rev')?.invocation).toEqual({
      kind: 'skill',
      name: 'rev',
      path: 'skills/review/SKILL.md',
      command: { name: 'review', harness: 'claude' },
    });
  });
});

describe('mergeInvocationResults', () => {
  it('merges partial failures with warnings', () => {
    const err = new Error('unknown method');
    const merged = mergeInvocationResults(
      [{ name: 'help', description: 'h' }],
      err,
      false,
    );
    expect(merged).not.toBeInstanceOf(Error);
    if (merged instanceof Error) return;
    expect(merged.supported).toBe(true);
    expect(merged.warning).toBeTruthy();
    expect(merged.candidates.map(c => c.name)).toContain('help');
  });
  it('surfaces enabled skills when the command catalog fails', () => {
    const merged = mergeInvocationResults(
      new Error('rpc'),
      [skill({ name: 's' })],
      true,
    );
    expect(merged).not.toBeInstanceOf(Error);
    if (merged instanceof Error) return;
    expect(merged.candidates.map(c => c.name)).toContain('s');
  });
  it('fails when nothing usable arrived', () => {
    expect(
      mergeInvocationResults(new Error('a'), new Error('b'), false),
    ).toBeInstanceOf(Error);
    expect(mergeInvocationResults([], new Error('b'), false)).toBeInstanceOf(
      Error,
    );
  });
  it('skillOnly is unsupported when the skills call returns none', () => {
    const merged = mergeInvocationResults([], undefined, true);
    expect(merged).not.toBeInstanceOf(Error);
    if (merged instanceof Error) return;
    expect(merged.supported).toBe(false);
  });
});

describe('canonical references', () => {
  it('invocationLink round-trips through invocationLinks', () => {
    const link = invocationLink({ kind: 'command', name: 'help' });
    expect(link.startsWith('[/help](zeron-invoke:')).toBe(true);
    const links = invocationLinks(`run ${link} now`);
    expect(links).toHaveLength(1);
    expect(links[0].invocation).toEqual({ kind: 'command', name: 'help' });
  });

  it('decodes skill links and rejects foreign/invalid ones', () => {
    const link = invocationLink({
      kind: 'skill',
      name: 'rev',
      path: 'p/SKILL.md',
    });
    expect(link.startsWith('[$rev](zeron-invoke:')).toBe(true);
    expect(invocationLinks(link)[0]?.invocation.name).toBe('rev');
    // Not ours → ignored
    expect(invocationLinks('[x](https://example.com)')).toHaveLength(0);
    // Tampered label → not canonical → rejected
    expect(invocationLinks(link.replace('$rev', 'other'))).toHaveLength(0);
    // Inside code → ignored
    expect(invocationLinks(`\`${link}\``)).toHaveLength(0);
  });

  it('localFileLink round-trips, encodes paths, marks dirs', () => {
    const file = localFileLink('src/a file.rs', false);
    expect(file).toBe('[a file.rs](zeron-file:src/a%20file.rs)');
    const dir = localFileLink('src/components', true);
    expect(dir).toBe('[components](zeron-file:src/components/)');
    const links = fileMentionLinks(`check ${file} and ${dir}`);
    expect(links).toHaveLength(2);
    expect(links[0].path).toBe('src/a file.rs');
    expect(links[1].isDir).toBe(true);
    expect(links[1].path).toBe('src/components');
  });

  it('rejects unsafe and non-canonical file links', () => {
    expect(fileMentionLinks('[x](zeron-file:../x)')).toHaveLength(0);
    expect(fileMentionLinks('[x](zeron-file:/abs)')).toHaveLength(0);
    expect(fileMentionLinks('[other](zeron-file:src/x)')).toHaveLength(0);
    expect(localPathIsSafe('a//b')).toBe(false);
    expect(localPathIsSafe('a/./b')).toBe(false);
    expect(localPathIsSafe('a/../b')).toBe(false);
  });

  it('percentEncodePath keeps unreserved chars, escapes the rest', () => {
    expect(percentEncodePath('a b#c.rs')).toBe('a%20b%23c.rs');
    expect(percentDecodePath('a%20b%23c.rs')).toBe('a b#c.rs');
    expect(percentEncodePath('a/b~c_d.e-f')).toBe('a/b~c_d.e-f');
    expect(percentDecodePath('%zz')).toBeUndefined();
  });

  it('escapeLabel escapes markdown label chars', () => {
    expect(escapeLabel('a[b]`c\\d')).toBe('a\\[b\\]\\`c\\\\d');
  });

  it('invocationInsertion uses prompt text without support', () => {
    const cmd = { kind: 'command', name: 'x' } as const;
    expect(invocationInsertion(cmd, false)).toBe('/x');
    expect(invocationInsertion(cmd, true)).toBe(invocationLink(cmd));
    const sk = { kind: 'skill', name: 's', path: 'p' } as const;
    // Skills always insert the canonical link (the send gate blocks anyway).
    expect(invocationInsertion(sk, false)).toBe(invocationLink(sk));
    expect(invocationInsertion(sk, true)).toBe(invocationLink(sk));
  });

  it('referencesRequireUpdate blocks links on old engines only', () => {
    const text = `go ${localFileLink('a/b', false)}`;
    expect(referencesRequireUpdate(text, false)).toBe(true);
    expect(referencesRequireUpdate(text, true)).toBe(false);
    expect(referencesRequireUpdate('plain text', false)).toBe(false);
    const inv = `go ${invocationLink({ kind: 'command', name: 'x' })}`;
    expect(referencesRequireUpdate(inv, false)).toBe(true);
  });
});

describe('display names and prefs', () => {
  it('skillDisplayName title-cases the last segment', () => {
    expect(skillDisplayName('ns:sub:code_review')).toBe('Code Review');
    expect(skillDisplayName('x')).toBe('X');
  });
  it('skillPrefsForHarness only separates for codex', () => {
    expect(skillPrefsForHarness('codex')).toEqual({
      dollar: true,
      separateFromSlash: true,
    });
    expect(skillPrefsForHarness('claude')).toEqual({
      dollar: false,
      separateFromSlash: false,
    });
    expect(skillPrefsForHarness(undefined)).toEqual({
      dollar: false,
      separateFromSlash: false,
    });
  });
});
