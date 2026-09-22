// Catch agent questions the host never wrapped in an `input` part.
//
// Coverage ladder (first match wins):
//  1. `input` — the host's structured request (claude-code, ACP harnesses,
//     codex item/tool/requestUserInput); answered via `respondInput`.
//  2. `tool` — an unresolved question-shaped tool call. Cursor's askQuestion
//     is disallowed at the shim and lands (if at all) as a name-only unknown
//     part; codex variants surface request_user_input / AskUserQuestion /
//     MCP elicitations the engine doesn't broker. Args ride the same
//     input/arguments/args bags detectPlan reads, when the host preserved
//     them; a name-only call still yields one free-text question.
//  3. `text` — a settled assistant entry whose tail paragraph asks a
//     question (the fallback for agents with no usable ask tool: the model
//     asks in prose and ends the turn).
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

/** Always a question, even with no args to parse (name-only unknown calls). */
const QUESTION_TOOL_NAMES = new Set([
  'askquestion',
  'askuserquestion',
  'askfollowupquestion',
  'requestuserinput',
  'requestinput',
  'elicitationcreate',
  'elicitinput',
]);

/** Question-shaped only when the args actually parse into questions. */
const GENERIC_QUESTION_NAMES = new Set([
  'ask',
  'askuser',
  'elicit',
  'elicitation',
]);

const normName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]/g, '');

const toolName = (call: Record<string, unknown>): string => {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  if (str(call.kind) === 'mcp')
    return str(call.tool).trim() || str(call.name).trim();
  return str(call.name).trim() || str(call.tool).trim();
};

// ── question parsing (detectPlan-style field bags) ──────────────────────

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;

const strOf = (v: unknown): string => (typeof v === 'string' ? v : '');

const fieldBags = (
  call: Record<string, unknown>,
): Record<string, unknown>[] => {
  const bags: Record<string, unknown>[] = [];
  for (const key of ['input', 'arguments', 'args'] as const) {
    const bag = asRecord(call[key]);
    if (bag !== undefined) bags.push(bag);
  }
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

const pickOptions = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map(o => {
      if (typeof o === 'string') return o;
      const rec = asRecord(o);
      if (rec === undefined) return '';
      return pickStr(rec, ['label', 'value', 'name', 'text', 'title']);
    })
    .filter(o => o !== '');

const questionFrom = (
  raw: unknown,
  ix: number,
): UserInputQuestion | undefined => {
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text === '') return undefined;
    return {
      id: `q${ix}`,
      header: 'Agent question',
      question: text,
      options: [],
    };
  }
  const q = asRecord(raw);
  if (q === undefined) return undefined;
  const options = pickOptions(q.options);
  return {
    id: pickStr(q, ['id', 'questionId', 'question_id']) || `q${ix}`,
    header:
      pickStr(q, ['header', 'title', 'label', 'name']) || 'Agent question',
    question: pickStr(q, ['question', 'prompt', 'text', 'message', 'body']),
    options: options.length > 0 ? options : pickOptions(q.choices),
    ...(pickBool(q, [
      'multiSelect',
      'multi_select',
      'multiple',
      'allowMultiple',
    ])
      ? { multiSelect: true }
      : {}),
  };
};

/** First non-empty question set found in the call's field bags. */
const questionsFromCall = (
  call: Record<string, unknown>,
): UserInputQuestion[] | undefined => {
  for (const bag of fieldBags(call)) {
    const raw = bag.questions;
    if (Array.isArray(raw)) {
      const parsed = raw
        .map(questionFrom)
        .filter((q): q is UserInputQuestion => q !== undefined);
      if (parsed.length > 0) return parsed;
    }
    const text = pickStr(bag, ['question', 'prompt', 'text', 'message']);
    if (text !== '') {
      const options = pickOptions(bag.options);
      return [
        {
          id: pickStr(bag, ['id', 'questionId', 'question_id']) || 'q0',
          header:
            pickStr(bag, ['header', 'title', 'label']) || 'Agent question',
          question: text,
          options: options.length > 0 ? options : pickOptions(bag.choices),
          ...(pickBool(bag, [
            'multiSelect',
            'multi_select',
            'multiple',
            'allowMultiple',
          ])
            ? { multiSelect: true }
            : {}),
        },
      ];
    }
  }
  return undefined;
};

/** A name-only call still gets one free-text question so the panel has an
 * answer surface. */
const FALLBACK_QUESTION: readonly UserInputQuestion[] = [
  { id: 'q0', header: 'Agent question', question: '', options: [] },
];

// ── detectors ────────────────────────────────────────────────────────────

type ToolQuestion = {
  entry: MessageEntry;
  part: Extract<MessagePart, { kind: 'tool' }>;
  questions: UserInputQuestion[];
};

/** Newest-first unresolved tool part whose call is question-shaped. */
const questionTool = (
  entries: readonly MessageEntry[],
): ToolQuestion | undefined => {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    for (let j = entry.parts.length - 1; j >= 0; j--) {
      const part = entry.parts[j];
      if (part.kind !== 'tool' || part.resolved) continue;
      const call = part.call as Record<string, unknown>;
      const name = normName(toolName(call));
      if (QUESTION_TOOL_NAMES.has(name)) {
        return {
          entry,
          part,
          questions: questionsFromCall(call) ?? [...FALLBACK_QUESTION],
        };
      }
      if (GENERIC_QUESTION_NAMES.has(name)) {
        const questions = questionsFromCall(call);
        if (questions !== undefined) return { entry, part, questions };
      }
    }
  }
  return undefined;
};

/** Last paragraph of `text` that asks a question (`?` is the marker). */
const lastQuestionParagraph = (text: string): string | undefined => {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p !== '');
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    if (paragraphs[i].includes('?')) return paragraphs[i];
  }
  return undefined;
};

const hasOpenTool = (entry: MessageEntry): boolean =>
  entry.parts.some(p => p.kind === 'tool' && !p.resolved);

/**
 * A settled assistant entry as the transcript's tail whose last text asks a
 * question. Streaming tails are excluded (the agent is mid-sentence);
 * entries with an open tool call defer to the tool signal.
 */
const textQuestion = (
  entries: readonly MessageEntry[],
): { entry: MessageEntry; question: UserInputQuestion } | undefined => {
  const last = entries[entries.length - 1];
  if (
    last === undefined ||
    last.role !== 'assistant' ||
    last.status === 'streaming' ||
    last.status === 'aborted' ||
    hasOpenTool(last)
  ) {
    return undefined;
  }
  const tail = [...last.parts]
    .reverse()
    .find(
      (p): p is Extract<MessagePart, { kind: 'text' }> =>
        p.kind === 'text' && p.text.trim() !== '',
    );
  if (tail === undefined) return undefined;
  const paragraph = lastQuestionParagraph(tail.text);
  if (paragraph === undefined) return undefined;
  return {
    entry: last,
    question: {
      id: 'q0',
      header: 'Agent question',
      question: paragraph,
      options: [],
    },
  };
};

/**
 * The open question to surface, in precedence order: input part →
 * unresolved question tool → trailing prose question. `dismissed` holds ids
 * the user already answered through the panel (tool/text questions may keep
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
      questions: [text.question],
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
