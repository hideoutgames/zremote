import type { Model, ModelOption } from '../src/zeron/protocol/types';
import {
  applyEffortLevel,
  applyFastChoice,
  effortOptionForModel,
  parseModelVariant,
  pickVariantId,
  resolveModelTraits,
  variantModelId,
} from '../src/components/modelTraits';

const option = (
  id: string,
  choices: string[],
  defaultChoice = choices[0],
): ModelOption => ({
  id,
  label: id,
  choices: choices.map(c => ({ id: c, label: c })),
  defaultChoice,
});

const model = (id: string, over: Partial<Model> = {}): Model => ({
  id,
  label: id,
  reasoningLevels: [],
  options: [],
  ...over,
});

const DEVIN = [
  model('gpt-6-astra-medium'),
  model('gpt-6-astra-high'),
  model('gpt-6-astra-high-fast'),
];

test('parseModelVariant strips effort and optional -fast', () => {
  expect(parseModelVariant('gpt-6-astra-medium')).toEqual({
    family: 'gpt-6-astra',
    effort: 'medium',
    fast: false,
  });
  expect(parseModelVariant('gpt-6-astra-high-fast')).toEqual({
    family: 'gpt-6-astra',
    effort: 'high',
    fast: true,
  });
  expect(parseModelVariant('gpt-5.4-xhigh-fast')).toEqual({
    family: 'gpt-5.4',
    effort: 'xhigh',
    fast: true,
  });
  expect(parseModelVariant('composer')).toEqual({
    family: 'composer',
    fast: false,
  });
});

test('variantModelId / pickVariantId prefer the full combo', () => {
  expect(variantModelId('gpt-6-astra', 'high', true)).toBe(
    'gpt-6-astra-high-fast',
  );
  expect(pickVariantId(DEVIN, 'gpt-6-astra', 'high', true)).toBe(
    'gpt-6-astra-high-fast',
  );
  expect(pickVariantId(DEVIN, 'gpt-6-astra', 'medium', true)).toBe(
    'gpt-6-astra-medium',
  );
  expect(pickVariantId(DEVIN, 'gpt-6-astra', 'high', false)).toBe(
    'gpt-6-astra-high',
  );
});

test('Codex advertised ladder wins over empty options', () => {
  const gpt = model('gpt-5', {
    reasoningLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  });
  const traits = resolveModelTraits(gpt, [gpt], ['minimal', 'low', 'high'], {
    reasoning: 'high',
  });
  expect(traits.effort).toEqual({
    kind: 'reasoning',
    levels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    value: 'high',
  });
  expect(traits.fast).toBeUndefined();
  expect(
    applyEffortLevel(traits, 'low', { model: 'gpt-5', reasoning: 'high' }, [
      gpt,
    ]),
  ).toEqual({
    model: 'gpt-5',
    reasoning: 'low',
    modelOptions: {},
  });
});

test('Codex serviceTier Fast is independent of the effort ladder', () => {
  const gpt = model('gpt-5', {
    reasoningLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    options: [option('serviceTier', ['default', 'fast'], 'default')],
  });
  const traits = resolveModelTraits(gpt, [gpt], undefined, {
    reasoning: 'high',
    modelOptions: { serviceTier: 'fast' },
  });
  expect(traits.effort?.kind).toBe('reasoning');
  expect(traits.effort?.value).toBe('high');
  expect(traits.fast?.kind).toBe('option');
  expect(traits.fast?.enabled).toBe(true);
  expect(traits.fast?.option?.id).toBe('serviceTier');
  expect(
    applyFastChoice(
      traits,
      'off',
      {
        model: 'gpt-5',
        reasoning: 'high',
        modelOptions: { serviceTier: 'fast' },
      },
      [gpt],
    ),
  ).toEqual({
    model: 'gpt-5',
    reasoning: 'high',
    modelOptions: { serviceTier: 'default' },
  });
  expect(
    applyEffortLevel(
      traits,
      'low',
      {
        model: 'gpt-5',
        reasoning: 'high',
        modelOptions: { serviceTier: 'fast' },
      },
      [gpt],
    ),
  ).toEqual({
    model: 'gpt-5',
    reasoning: 'low',
    modelOptions: { serviceTier: 'fast' },
  });
});

test('Codex Daybreak-style models without serviceTier have no Fast chip', () => {
  const daybreak = model('gpt-daybreak-blue-latest', {
    reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  });
  expect(resolveModelTraits(daybreak, [daybreak], []).fast).toBeUndefined();
});

test('Grok ladder-only effort has no Fast chip', () => {
  const grok = model('grok-4', {
    reasoningLevels: ['low', 'medium', 'high'],
  });
  const traits = resolveModelTraits(grok, [grok], ['low', 'medium', 'high']);
  expect(traits.effort).toEqual({
    kind: 'reasoning',
    levels: ['low', 'medium', 'high'],
    value: 'low',
  });
  expect(traits.fast).toBeUndefined();
});

test('Hermes empty ladder has neither Effort nor Fast', () => {
  const hermes = model('hermes');
  const traits = resolveModelTraits(hermes, [hermes], []);
  expect(traits.effort).toBeUndefined();
  expect(traits.fast).toBeUndefined();
});

test('OpenCode harness ladder fills in when the model lists none', () => {
  const sonnet = model('opencode-sonnet');
  const traits = resolveModelTraits(sonnet, [sonnet], [
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ]);
  expect(traits.effort?.kind).toBe('reasoning');
  expect(traits.effort?.levels).toEqual([
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ]);
  expect(traits.fast).toBeUndefined();
});

test('Claude fastMode is unchanged and independent of effort', () => {
  const sonnet = model('sonnet', {
    reasoningLevels: ['low', 'medium', 'high'],
    options: [option('fastMode', ['off', 'on'], 'off')],
  });
  const traits = resolveModelTraits(sonnet, [sonnet], undefined, {
    reasoning: 'medium',
    modelOptions: { fastMode: 'on' },
  });
  expect(traits.effort?.kind).toBe('reasoning');
  expect(traits.fast?.kind).toBe('option');
  expect(traits.fast?.enabled).toBe(true);
  expect(traits.fast?.option?.id).toBe('fastMode');
  expect(
    applyFastChoice(
      traits,
      'off',
      {
        model: 'sonnet',
        reasoning: 'medium',
        modelOptions: { fastMode: 'on' },
      },
      [sonnet],
    ),
  ).toEqual({
    model: 'sonnet',
    reasoning: 'medium',
    modelOptions: { fastMode: 'off' },
  });
});

test('Cursor option-backed effort and Fast write modelOptions, not reasoning', () => {
  const composer = model('composer-2.5', {
    options: [
      option('effort', ['low', 'medium', 'high'], 'medium'),
      option('fast', ['false', 'true'], 'false'),
    ],
  });
  const traits = resolveModelTraits(composer, [composer], [], {
    modelOptions: { effort: 'low', fast: 'true' },
  });
  expect(traits.effort).toEqual({
    kind: 'option',
    levels: ['low', 'medium', 'high'],
    value: 'low',
    optionId: 'effort',
  });
  expect(traits.fast?.kind).toBe('option');
  expect(traits.fast?.enabled).toBe(true);
  expect(
    applyEffortLevel(
      traits,
      'high',
      { model: 'composer-2.5', modelOptions: { effort: 'low', fast: 'true' } },
      [composer],
    ),
  ).toEqual({
    model: 'composer-2.5',
    reasoning: undefined,
    modelOptions: { effort: 'high', fast: 'true' },
  });
  expect(
    applyFastChoice(
      traits,
      'false',
      { model: 'composer-2.5', modelOptions: { effort: 'low', fast: 'true' } },
      [composer],
    ),
  ).toEqual({
    model: 'composer-2.5',
    reasoning: undefined,
    modelOptions: { effort: 'low', fast: 'false' },
  });
});

test('thinking is effort only when choices are levels, not on/off', () => {
  const haiku = model('haiku', {
    options: [option('thinking', ['off', 'on'], 'off')],
  });
  expect(effortOptionForModel(haiku)).toBeUndefined();
  expect(resolveModelTraits(haiku, [haiku], []).effort).toBeUndefined();

  const cursorThink = model('think', {
    options: [option('thinking', ['low', 'medium', 'high'], 'medium')],
  });
  expect(effortOptionForModel(cursorThink)?.id).toBe('thinking');
  expect(resolveModelTraits(cursorThink, [cursorThink], []).effort?.kind).toBe(
    'option',
  );
});

test('Devin variant ids drive effort and Fast by rewriting the model id', () => {
  const current = DEVIN[0];
  const traits = resolveModelTraits(current, DEVIN, []);
  expect(traits.effort).toEqual({
    kind: 'variant',
    levels: ['medium', 'high'],
    value: 'medium',
  });
  expect(traits.fast).toEqual({
    kind: 'variant',
    enabled: false,
    choice: 'off',
  });
  expect(
    applyEffortLevel(traits, 'high', { model: 'gpt-6-astra-medium' }, DEVIN)
      .model,
  ).toBe('gpt-6-astra-high');
  const high = resolveModelTraits(DEVIN[1], DEVIN, []);
  expect(
    applyFastChoice(high, 'on', { model: 'gpt-6-astra-high' }, DEVIN).model,
  ).toBe('gpt-6-astra-high-fast');
  const highFast = resolveModelTraits(DEVIN[2], DEVIN, []);
  expect(highFast.fast?.enabled).toBe(true);
  expect(
    applyEffortLevel(
      highFast,
      'medium',
      { model: 'gpt-6-astra-high-fast' },
      DEVIN,
    ).model,
  ).toBe('gpt-6-astra-medium');
});

test('no Fast when neither an option nor a -fast sibling exists', () => {
  const gpt = model('gpt-5', {
    reasoningLevels: ['low', 'high'],
  });
  expect(resolveModelTraits(gpt, [gpt], []).fast).toBeUndefined();
  expect(
    resolveModelTraits(model('solo-high'), [model('solo-high')], []).fast,
  ).toBeUndefined();
});
