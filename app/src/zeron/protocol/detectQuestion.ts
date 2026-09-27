// Catch agent questions the host never wrapped in an `input` part.
//
// Coverage ladder (first match wins):
//  1. `input` — the host's structured request (claude-code, ACP harnesses,
//     codex item/tool/requestUserInput); answered via `respondInput`.
//  2. `tool` — a question-shaped tool call in the current turn (after the
//     last user message). Unresolved calls always count. A call the host
//     already closed still counts when it failed or came back as a skip
//     ("Questions skipped…", disallowed, tool-not-found) and the agent did
//     not continue past it — Cursor's AskQuestion is disallowed at the
//     shim and often lands name-only, or resolved, with the prompt stripped
//     by sanitize_tool_call. Args are read from input/arguments/args,
//     including JSON strings, in the Cursor shape
//     `{title, questions:[{id, prompt, options:[{id, label}], allow_multiple}]}`.
//     A name-only call still yields one free-text question; a sibling text
//     part that actually asks supplies the prompt when the args are gone.
//     A strong name whose payload is some other tool (command/path/…) is
//     not a question.
//  3. `text` — the tail of a settled assistant entry asks the user. Only
//     the ending counts: code fences, inline code, and URLs are ignored,
//     an earlier `?` does not, and a choice list immediately after the
//     question becomes the options. A finished write-up that mentioned a
//     question and then concluded is not a question.
//
// `tool`/`text` questions have no host request id — `respondInput` rejects
// ids it never minted — so answers go out as a steer, formatted like the
// host's respond_input_prompt ("Answering your earlier question: … — …");
// a live run is steered, a settled one takes it as the next turn.

import { openInputRequest } from './messages';
import type {
  MessageEntry,
  MessagePart,
  UserInputAnswer,
  UserInputQuestion,
} from './types';

export type OpenQuestion =
  | {
      kind: 'input';
      id: string;
      entryId: string;
      requestId: string;
      questions: UserInputQuestion[];
    }
  | {
      kind: 'tool';
      id: string;
      entryId: string;
      questions: UserInputQuestion[];
    }
  | {
      kind: 'text';
      id: string;
      entryId: string;
      questions: UserInputQuestion[];
    };

// ── tool-call name matching ─────────────────────────────────────────────

/** Always a question when the call is name-only or its args parse.
 * Covers every supported harness's ask-user tool plus the common generic
 * spellings (normalized: lowercase, alphanumerics only). */
const QUESTION_TOOL_NAMES = new Set([
  // claude-code AskUserQuestion; codex ask_user_question variant; grok's
  // ACP method leaf (x.ai/ask_user_question)
  'askuserquestion',
  // cursor AskQuestion / cursor/ask_question; pi ask_question
  'askquestion',
  // cline/roo-style spelling
  'askfollowupquestion',
  // codex request_user_input / requestInput
  'requestuserinput',
  'requestinput',
  // opencode question
  'question',
  'questions',
  // hermes clarify
  'clarify',
  // MCP elicitation methods (elicitation/create — leaf is `create`, so the
  // WHOLE normalized name is what matches)
  'elicitationcreate',
  'elicitinput',
  // generic ask-the-user spellings agents emit
  'askuser',
  'userinput',
  'userquestion',
  'askhuman',
  'humaninput',
  'getuserinput',
  'promptuser',
  'queryuser',
]);

/** Longer SDK discriminants (`askQuestionToolCall`) still end in one of
 * these. Exact set members are matched separately. */
const QUESTION_NAME_SUFFIXES = [
  'askuserquestion',
  'askquestion',
  'requestuserinput',
  'askfollowupquestion',
] as const;

/** Question-shaped only when the args actually parse into questions. */
const GENERIC_QUESTION_NAMES = new Set([
  'ask',
  'elicit',
  'elicitation',
  'requestfeedback',
  'inputrequest',
]);

const normName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Vendor/namespace prefixes ride the method name — ACP extensions
 * (`cursor/ask_question`, `_x.ai/ask_user_question`) and MCP
 * double-underscore tool names (`mcp__srv__ask_user`). Reducing to the leaf
 * keeps the curated sets honest without enumerating every prefix. */
const nameLeaves = (name: string): string[] => {
  const leaves = [name];
  const slash = name.lastIndexOf('/');
  if (slash >= 0) leaves.push(name.slice(slash + 1));
  const dunder = name.lastIndexOf('__');
  if (dunder >= 0) leaves.push(name.slice(dunder + 2));
  return leaves;
};

/** All normalized name candidates for a call: `tool`/`name` fields (mcp
 * calls prefer `tool`), each with its stripped leaves, plus the doc `kind`
 * itself — provider shims may surface the tool name AS the kind. */
const toolNames = (call: Record<string, unknown>): string[] => {
  const out = new Set<string>();
  const push = (v: unknown): void => {
    if (typeof v !== 'string' || v.trim() === '') return;
    for (const leaf of nameLeaves(v.trim())) out.add(normName(leaf));
  };
  if (call.kind === 'mcp') {
    push(call.tool);
    push(call.name);
  } else {
    push(call.name);
    push(call.tool);
  }
  push(call.kind);
  return [...out];
};

/** `askQuestionToolCall` / `askQuestionTool` → `askquestion`. */
const stripToolSuffix = (name: string): string =>
  name.replace(/toolcall$/, '').replace(/tool$/, '');

const isStrongQuestionName = (name: string): boolean => {
  if (QUESTION_TOOL_NAMES.has(name)) return true;
  const stripped = stripToolSuffix(name);
  if (stripped !== name && QUESTION_TOOL_NAMES.has(stripped)) return true;
  return QUESTION_NAME_SUFFIXES.some(
    suffix => name.endsWith(suffix) && name.length > suffix.length,
  );
};

// ── question parsing (detectPlan-style field bags) ──────────────────────

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;

const strOf = (v: unknown): string => (typeof v === 'string' ? v : '');

const parseJsonRecord = (v: unknown): Record<string, unknown> | undefined => {
  if (typeof v !== 'string') return undefined;
  const text = v.trim();
  if (!text.startsWith('{')) return undefined;
  try {
    return asRecord(JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
};

const fieldBags = (
  call: Record<string, unknown>,
): Record<string, unknown>[] => {
  const bags: Record<string, unknown>[] = [];
  const push = (v: unknown): void => {
    const bag = asRecord(v) ?? parseJsonRecord(v);
    if (bag !== undefined) bags.push(bag);
  };
  for (const key of ['input', 'arguments', 'args'] as const) push(call[key]);
  bags.push(call);
  return bags;
};

const pickStr = (
  obj: Record<string, unknown>,
  keys: readonly string[],
): string => {
  for (const k of keys) {
    const v = strOf(obj[k]).trim();
    if (v !== '') return v;
  }
  return '';
};

const pickBool = (
  obj: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  for (const k of keys) {
    if (typeof obj[k] === 'boolean') return obj[k] as boolean;
  }
  return false;
};

const MULTI_KEYS = [
  'multiSelect',
  'multi_select',
  'multiple',
  'allowMultiple',
  'allow_multiple',
] as const;

const pickOptions = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map(o => {
      if (typeof o === 'string') return o;
      const rec = asRecord(o);
      if (rec === undefined) return '';
      return pickStr(rec, ['label', 'value', 'name', 'text', 'title', 'id']);
    })
    .filter(o => o !== '');

const questionFrom = (
  raw: unknown,
  ix: number,
  fallbackHeader: string,
): UserInputQuestion | undefined => {
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text === '') return undefined;
    return {
      id: `q${ix}`,
      header: fallbackHeader,
      question: text,
      options: [],
    };
  }
  const q = asRecord(raw);
  if (q === undefined) return undefined;
  const options = pickOptions(q.options);
  const question = pickStr(q, [
    'question',
    'prompt',
    'text',
    'message',
    'body',
  ]);
  // An option row with no prompt is not a question (Cursor options are
  // `{id, label}` and must not become their own prompt).
  if (question === '' && options.length === 0) return undefined;
  return {
    id: pickStr(q, ['id', 'questionId', 'question_id']) || `q${ix}`,
    header: pickStr(q, ['header', 'title', 'label', 'name']) || fallbackHeader,
    question,
    options: options.length > 0 ? options : pickOptions(q.choices),
    ...(pickBool(q, MULTI_KEYS) ? { multiSelect: true } : {}),
  };
};

const questionsFromList = (
  list: unknown[],
  header: string,
): UserInputQuestion[] | undefined => {
  const parsed = list
    .map((raw, ix) => questionFrom(raw, ix, header))
    .filter((q): q is UserInputQuestion => q !== undefined);
  return parsed.length > 0 ? parsed : undefined;
};

/** A bare string arg (`input: "Which environment?"`) is the prompt. */
const questionsFromStringArg = (
  call: Record<string, unknown>,
): UserInputQuestion[] | undefined => {
  for (const key of ['input', 'arguments', 'args'] as const) {
    const raw = call[key];
    if (typeof raw !== 'string') continue;
    const text = raw.trim();
    if (text === '' || text.startsWith('{')) continue;
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (Array.isArray(parsed)) {
          const fromList = questionsFromList(parsed, 'Agent question');
          if (fromList !== undefined) return fromList;
        }
      } catch {
        // Not a question list — fall through to the field bags.
      }
      continue;
    }
    // A bare string is the prompt only when it asks. Command strings and
    // titles must not become the question.
    if (!endsWithQuestion(text)) continue;
    return [
      { id: 'q0', header: 'Agent question', question: text, options: [] },
    ];
  }
  return undefined;
};

/** First non-empty question set found in the call's field bags. */
const questionsFromCall = (
  call: Record<string, unknown>,
  requireMark: boolean,
): UserInputQuestion[] | undefined => {
  const fromString = questionsFromStringArg(call);
  if (fromString !== undefined) return fromString;
  for (const bag of fieldBags(call)) {
    const header = pickStr(bag, ['title', 'header']) || 'Agent question';
    const rawList = bag.questions;
    let list: unknown[] | undefined;
    if (Array.isArray(rawList)) list = rawList;
    else if (typeof rawList === 'string' && rawList.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(rawList) as unknown;
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        list = undefined;
      }
    }
    if (Array.isArray(list)) {
      const parsed = questionsFromList(list, header);
      if (parsed !== undefined) return parsed;
    }
    const text = pickStr(bag, ['question', 'prompt', 'text', 'message']);
    if (text === '' || (requireMark && !endsWithQuestion(text))) continue;
    const options = pickOptions(bag.options);
    return [
      {
        id: pickStr(bag, ['id', 'questionId', 'question_id']) || 'q0',
        header,
        question: text,
        options: options.length > 0 ? options : pickOptions(bag.choices),
        ...(pickBool(bag, MULTI_KEYS) ? { multiSelect: true } : {}),
      },
    ];
  }
  return undefined;
};

/** Keys that mean this call is some other tool, even if its name collides
 * with an ask-user spelling. */
const ALIEN_KEYS = new Set([
  'command',
  'cmd',
  'path',
  'filepath',
  'file_path',
  'pattern',
  'glob',
  'url',
  'query',
  'content',
  'old_string',
  'new_string',
  'oldstring',
  'newstring',
]);

const looksLikeOtherTool = (call: Record<string, unknown>): boolean => {
  for (const bag of fieldBags(call)) {
    for (const key of Object.keys(bag)) {
      if (ALIEN_KEYS.has(key.toLowerCase().replace(/[^a-z0-9_]/g, ''))) {
        // `query` on a real question ("query the user") is rare; a
        // question/prompt/questions field alongside it still wins.
        if (
          key.toLowerCase() === 'query' &&
          (bag.questions !== undefined ||
            pickStr(bag, ['question', 'prompt']) !== '')
        ) {
          continue;
        }
        return true;
      }
    }
  }
  return false;
};

/** Shown when the host kept the tool name and dropped the prompt. */
const FALLBACK_BODY = 'The agent needs your input';

const fallbackQuestion = (
  body = FALLBACK_BODY,
): readonly UserInputQuestion[] => [
  { id: 'q0', header: 'Agent question', question: body, options: [] },
];

const SKIP_OUTPUT =
  /questions skipped|skipped by the user|no_input_surface|tool not found|disallowed|not available|did not respond|no input surface/i;

// ── prose: only a turn that ENDS by asking ──────────────────────────────

/** Strip code and links so `?.`, ternaries, and query strings are not
 * questions. */
const stripNonProse = (text: string): string =>
  text
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/`[^`\n]*`/g, '')
    .replace(/https?:\/\/\S+/g, '');

const endsWithQuestion = (text: string): boolean => {
  const trimmed = text
    .trim()
    .replace(/["'”’)\]]+$/u, '')
    .trim();
  if (!trimmed.endsWith('?')) return false;
  if (/\?\.\s*$/.test(trimmed) || /\?\?\s*$/.test(trimmed)) return false;
  return true;
};

const paragraphsOf = (text: string): string[] =>
  stripNonProse(text)
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p !== '');

const OPTION_LINE = /^(?:[-*]|\d+[.)]|[A-Za-z][.)])\s+(.+)$/;

/** A short choice list, not a summary of paths or a list of questions. */
const optionItems = (paragraph: string): string[] | undefined => {
  const lines = paragraph
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '');
  if (lines.length < 2 || lines.length > 8) return undefined;
  const items: string[] = [];
  for (const line of lines) {
    const match = OPTION_LINE.exec(line);
    if (match === undefined) return undefined;
    const item = match[1].trim();
    if (item.length === 0 || item.length > 120) return undefined;
    if (item.includes('/') || /\.[a-z0-9]{1,6}$/i.test(item)) return undefined;
    if (endsWithQuestion(item)) return undefined;
    items.push(item);
  }
  return items;
};

/** A trailing numbered/bulleted list where every item is itself a question. */
const questionItems = (paragraph: string): string[] | undefined => {
  const lines = paragraph
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '');
  if (lines.length < 2) return undefined;
  const items: string[] = [];
  for (const line of lines) {
    const match = OPTION_LINE.exec(line);
    if (match === undefined) return undefined;
    const item = match[1].trim();
    if (!endsWithQuestion(item)) return undefined;
    items.push(item);
  }
  return items;
};

const lastSentence = (paragraph: string): string => {
  if (paragraph.length <= 400) return paragraph.trim();
  const bits = paragraph.trim().split(/(?<=\?)\s+/);
  const last = bits[bits.length - 1];
  return last !== undefined && last.trim() !== '' ? last.trim() : paragraph;
};

export type TrailingAsk = { questions: string[]; options: string[] };

/**
 * The ask at the end of `text`, if the message stops on a question.
 * Choice lines after the question become options. A later paragraph that
 * is neither a question nor a choice list means the agent already moved on.
 */
/**
 * "Which environment?\n- staging\n- production" is one paragraph. A choice
 * list glued to its question still counts; a path list does not.
 */
const inlineAsk = (paragraph: string): TrailingAsk | undefined => {
  const lines = paragraph
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '');
  if (lines.length < 3) return undefined;
  let start = lines.length;
  while (start > 0 && OPTION_LINE.test(lines[start - 1] ?? '')) start -= 1;
  if (start === 0 || start === lines.length || lines.length - start < 2) {
    return undefined;
  }
  const head = lines.slice(0, start).join(' ').trim();
  if (!endsWithQuestion(head)) return undefined;
  const items = lines.slice(start).map(line => {
    const match = OPTION_LINE.exec(line);
    return match?.[1]?.trim() ?? '';
  });
  if (items.every(item => endsWithQuestion(item))) {
    return { questions: items, options: [] };
  }
  const block = lines.slice(start).join('\n');
  const options = optionItems(block);
  if (options === undefined) return undefined;
  return { questions: [lastSentence(head)], options };
};

export const trailingAsk = (text: string): TrailingAsk | undefined => {
  const paragraphs = paragraphsOf(text);
  if (paragraphs.length === 0) return undefined;
  const inline = inlineAsk(paragraphs[paragraphs.length - 1] ?? '');
  if (inline !== undefined) return inline;
  let index = paragraphs.length - 1;
  const listed = questionItems(paragraphs[index] ?? '');
  if (listed !== undefined) return { questions: listed, options: [] };
  const options: string[] = [];
  while (index >= 0) {
    const items = optionItems(paragraphs[index] ?? '');
    if (items === undefined) break;
    options.unshift(...items);
    index -= 1;
  }
  if (index < 0) return undefined;
  const question = paragraphs[index] ?? '';
  if (!endsWithQuestion(question)) return undefined;
  // Anything before the question is context. Anything that failed the
  // option-list test and isn't the question itself means the turn continued.
  if (index !== paragraphs.length - 1 && options.length === 0) return undefined;
  const many = questionItems(question);
  if (many !== undefined) return { questions: many, options: [] };
  return { questions: [lastSentence(question)], options };
};

const questionsFromTrailing = (ask: TrailingAsk): UserInputQuestion[] =>
  ask.questions.map((question, ix) => ({
    id: `q${ix}`,
    header: 'Agent question',
    question,
    options: ask.questions.length === 1 ? ask.options : [],
  }));

// ── detectors ────────────────────────────────────────────────────────────

type ToolPart = Extract<MessagePart, { kind: 'tool' }>;

type ToolQuestion = {
  entry: MessageEntry;
  part: ToolPart;
  questions: UserInputQuestion[];
};

/** Entries after the last user message — the turn still waiting on them. */
const turnTail = (entries: readonly MessageEntry[]): MessageEntry[] => {
  let start = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].role === 'user') {
      start = i + 1;
      break;
    }
  }
  return entries.slice(start);
};

const entryText = (entry: MessageEntry): string =>
  entry.parts
    .filter(
      (p): p is Extract<MessagePart, { kind: 'text' }> => p.kind === 'text',
    )
    .map(p => p.text)
    .join('\n\n');

const textAfter = (entry: MessageEntry, partIndex: number): string =>
  entry.parts
    .slice(partIndex + 1)
    .filter(
      (p): p is Extract<MessagePart, { kind: 'text' }> => p.kind === 'text',
    )
    .map(p => p.text)
    .join('\n\n');

/** A resolved ask that the agent already continued past is not still open.
 * Later entries count: the prompt may have been skipped and the next
 * message is the agent working. A same-entry trailing question is the
 * prompt the host stripped, so that one stays open. */
const agentMovedOn = (
  tail: readonly MessageEntry[],
  entryIndex: number,
  partIndex: number,
): boolean => {
  const entry = tail[entryIndex];
  if (entry === undefined) return false;
  const after = textAfter(entry, partIndex);
  if (after.trim() !== '' && trailingAsk(after) === undefined) return true;
  if (entryIndex >= tail.length - 1) return false;
  const rest = tail.slice(entryIndex + 1);
  const laterText = rest
    .map(entryText)
    .filter(t => t.trim() !== '')
    .join('\n\n');
  const laterTools = rest.some(e => e.parts.some(p => p.kind === 'tool'));
  if (laterText.trim() === '' && !laterTools) return false;
  // A later message that itself asks, with no further tool work, is still
  // the prompt — often the only place it survived.
  if (!laterTools && trailingAsk(laterText) !== undefined) return false;
  return true;
};

/** The host closed the tool without an answer: error, or a synthetic skip. */
const closedUnanswered = (part: ToolPart): boolean => {
  if (!part.resolved) return false;
  if (part.isError === true) return true;
  const output = part.output ?? '';
  return output.trim() !== '' && SKIP_OUTPUT.test(output);
};

const fillFromSibling = (
  entry: MessageEntry,
  questions: UserInputQuestion[],
  extraText = '',
): UserInputQuestion[] => {
  if (
    questions.some(
      q => q.question.trim() !== '' && q.question !== FALLBACK_BODY,
    )
  ) {
    return questions;
  }
  const ask = trailingAsk(
    [entryText(entry), extraText].filter(t => t.trim() !== '').join('\n\n'),
  );
  if (ask === undefined || ask.questions.length === 0) return questions;
  const harvested = questionsFromTrailing(ask);
  if (questions.length === 1 && questions[0].options.length === 0) {
    return harvested;
  }
  return questions.map((q, ix) =>
    q.question.trim() === '' || q.question === FALLBACK_BODY
      ? { ...q, question: harvested[ix]?.question || q.question }
      : q,
  );
};

const classifyTool = (
  call: Record<string, unknown>,
): { strong: boolean; questions: UserInputQuestion[] | undefined } => {
  const names = toolNames(call);
  const strong = names.some(isStrongQuestionName);
  const generic = names.some(n => GENERIC_QUESTION_NAMES.has(n));
  if (!strong && !generic) return { strong: false, questions: undefined };
  let questions: UserInputQuestion[] | undefined;
  try {
    questions = questionsFromCall(call, !strong);
  } catch {
    questions = undefined;
  }
  if (questions === undefined && looksLikeOtherTool(call)) {
    return { strong: false, questions: undefined };
  }
  return { strong, questions };
};

/** Newest question-shaped tool in the current turn. */
const questionTool = (
  entries: readonly MessageEntry[],
): ToolQuestion | undefined => {
  const tail = turnTail(entries);
  for (let i = tail.length - 1; i >= 0; i--) {
    const entry = tail[i];
    for (let j = entry.parts.length - 1; j >= 0; j--) {
      const part = entry.parts[j];
      if (part.kind !== 'tool') continue;
      const call = part.call as Record<string, unknown>;
      const { strong, questions } = classifyTool(call);
      if (!strong && questions === undefined) continue;
      const open = !part.resolved || closedUnanswered(part);
      if (!open) continue;
      if (part.resolved && agentMovedOn(tail, i, j)) continue;
      const outputQuestions = (() => {
        if (questions !== undefined) return undefined;
        const parsed = parseJsonRecord(part.output);
        if (parsed === undefined) return undefined;
        try {
          return questionsFromCall(parsed, false);
        } catch {
          return undefined;
        }
      })();
      const body =
        questions ??
        outputQuestions ??
        (strong ? [...fallbackQuestion()] : undefined);
      if (body === undefined) continue;
      const laterText = tail
        .slice(i + 1)
        .map(entryText)
        .filter(t => t.trim() !== '')
        .join('\n\n');
      return {
        entry,
        part,
        questions: fillFromSibling(entry, body, laterText),
      };
    }
  }
  return undefined;
};

/**
 * A settled assistant entry at the tail of the turn whose ending asks a
 * question. Streaming tails are excluded (the agent is mid-sentence).
 */
const textQuestion = (
  entries: readonly MessageEntry[],
): { entry: MessageEntry; questions: UserInputQuestion[] } | undefined => {
  const tail = turnTail(entries);
  const last = tail[tail.length - 1];
  if (
    last === undefined ||
    last.role !== 'assistant' ||
    last.status === 'streaming' ||
    last.status === 'aborted'
  ) {
    return undefined;
  }
  const text = entryText(last);
  const ask = trailingAsk(text);
  if (ask === undefined) return undefined;
  return { entry: last, questions: questionsFromTrailing(ask) };
};

/**
 * The open question to surface, in precedence order: input part →
 * question tool → trailing prose question. `dismissed` holds ids the user
 * already answered through the panel (tool/text questions may keep
 * signalling after the answer ships — a dead run's tool never resolves).
 */
export const openQuestion = (
  entries: readonly MessageEntry[],
  dismissed?: ReadonlySet<string>,
): OpenQuestion | undefined => {
  const input = openInputRequest(entries);
  if (input !== undefined && !dismissed?.has(input.requestId)) {
    return {
      kind: 'input',
      id: input.requestId,
      entryId: input.entryId,
      requestId: input.requestId,
      questions: input.questions,
    };
  }
  const tool = questionTool(entries);
  if (tool !== undefined && !dismissed?.has(tool.part.id)) {
    return {
      kind: 'tool',
      id: tool.part.id,
      entryId: tool.entry.id,
      questions: tool.questions,
    };
  }
  const text = textQuestion(entries);
  if (text !== undefined && !dismissed?.has(`${text.entry.id}/q0`)) {
    return {
      kind: 'text',
      id: `${text.entry.id}/q0`,
      entryId: text.entry.id,
      questions: text.questions,
    };
  }
  return undefined;
};

/** Format a tool/text answer like the host's respond_input_prompt
 * (doc_host.rs): "Answering your earlier question:\n<question> — <labels>". */
export const formatQuestionAnswer = (
  questions: readonly UserInputQuestion[],
  answers: readonly UserInputAnswer[],
): string => {
  const lines = ['Answering your earlier question:'];
  for (const answer of answers) {
    const picked = answer.labels.join(', ');
    const question = questions
      .find(q => q.id === answer.questionId)
      ?.question.trim();
    lines.push(
      question !== undefined && question !== ''
        ? `${question} — ${picked}`
        : picked,
    );
  }
  return lines.join('\n');
};

/** Structural equality for the store hook — tool/text questions are
 * re-synthesized on every call so identity alone would re-render. */
export const sameOpenQuestion = (
  a: OpenQuestion | undefined,
  b: OpenQuestion | undefined,
): boolean => {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a.kind !== b.kind || a.id !== b.id || a.entryId !== b.entryId)
    return false;
  const qa = a.questions;
  const qb = b.questions;
  if (qa.length !== qb.length) return false;
  return qa.every(
    (q, i) =>
      q.id === qb[i].id &&
      q.header === qb[i].header &&
      q.question === qb[i].question &&
      q.multiSelect === qb[i].multiSelect &&
      q.options.length === qb[i].options.length &&
      q.options.every((o, j) => o === qb[i].options[j]),
  );
};
