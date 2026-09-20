// Resolve composer Effort / Fast from the host catalog: advertised
// reasoningLevels (Codex/Claude), then effort-like Model.options (Cursor
// params), then Devin-style variant ids (`family-medium` / `family-high-fast`).

import type { Model, ModelOption } from '../zeron/protocol/types';
import {
  fastOffChoice,
  fastOnChoice,
  fastOptionForModel,
  isFastEnabled,
  isFastOffChoice,
} from './fastMode';
import {
  effortLevelsForModel,
  rememberedModelOptions,
  rememberedReasoning,
  type ModelSettings,
} from './modelPicker';

/** Match longest suffixes first so `xhigh` is not parsed as `high`. */
const EFFORT_SUFFIX_MATCH = [
  'xhigh',
  'minimal',
  'medium',
  'high',
  'max',
  'low',
] as const;

const EFFORT_SUFFIX_ORDER = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

const EFFORT_OPTION_IDS = ['effort', 'reasoning', 'reasoningEffort'] as const;

const LEVEL_CHOICE_IDS = new Set<string>([
  ...EFFORT_SUFFIX_ORDER,
  'ultra',
  'ultracode',
  'ultrathink',
]);

export type EffortKind = 'reasoning' | 'option' | 'variant';

export interface EffortTrait {
  kind: EffortKind;
  levels: string[];
  value?: string;
  optionId?: string;
}

export interface FastTrait {
  kind: 'option' | 'variant';
  option?: ModelOption;
  enabled: boolean;
  choice?: string;
}

export interface ModelTraits {
  effort?: EffortTrait;
  fast?: FastTrait;
  family?: string;
}

export interface TraitConfig {
  model?: string;
  reasoning?: string;
  modelOptions?: Record<string, unknown>;
}

export interface TraitPatch {
  model?: string;
  reasoning?: string;
  modelOptions: Record<string, unknown>;
}

export interface ParsedModelVariant {
  family: string;
  effort?: string;
  fast: boolean;
}

const FAST_SUFFIX = '-fast';

export const parseModelVariant = (id: string): ParsedModelVariant => {
  let rest = id;
  let fast = false;
  if (rest.endsWith(FAST_SUFFIX)) {
    fast = true;
    rest = rest.slice(0, -FAST_SUFFIX.length);
  }
  for (const effort of EFFORT_SUFFIX_MATCH) {
    const suffix = `-${effort}`;
    if (rest.endsWith(suffix)) {
      return {
        family: rest.slice(0, -suffix.length),
        effort,
        fast,
      };
    }
  }
  return { family: rest, fast };
};

export const variantModelId = (
  family: string,
  effort: string | undefined,
  fast: boolean,
): string => {
  let id = family;
  if (effort !== undefined && effort !== '') id = `${id}-${effort}`;
  if (fast) id = `${id}${FAST_SUFFIX}`;
  return id;
};

const idInCatalog = (catalog: readonly Model[], id: string): boolean =>
  catalog.some(m => m.id === id);

export const pickVariantId = (
  catalog: readonly Model[],
  family: string,
  effort: string | undefined,
  fast: boolean,
): string | undefined => {
  const preferred = variantModelId(family, effort, fast);
  if (idInCatalog(catalog, preferred)) return preferred;
  if (fast) {
    const withoutFast = variantModelId(family, effort, false);
    if (idInCatalog(catalog, withoutFast)) return withoutFast;
  }
  const familyFast = variantModelId(family, undefined, fast);
  if (idInCatalog(catalog, familyFast)) return familyFast;
  const bare = variantModelId(family, undefined, false);
  if (idInCatalog(catalog, bare)) return bare;
  return undefined;
};

const isLevelChoice = (id: string): boolean =>
  LEVEL_CHOICE_IDS.has(id.toLowerCase());

/** Effort-like option: named effort/reasoning, or `thinking` with level choices. */
export const effortOptionForModel = (
  model: Model | undefined,
): ModelOption | undefined => {
  const options = model?.options ?? [];
  const named = options.find(o =>
    (EFFORT_OPTION_IDS as readonly string[]).includes(o.id),
  );
  if (named !== undefined && named.choices.length >= 2) return named;
  const thinking = options.find(o => o.id === 'thinking');
  if (thinking === undefined) return undefined;
  const levelChoices = thinking.choices.filter(c => isLevelChoice(c.id));
  if (levelChoices.length >= 2) return thinking;
  return undefined;
};

const optionLevels = (option: ModelOption): string[] =>
  option.choices.map(c => c.id);

const optionValue = (
  option: ModelOption,
  modelOptions: Record<string, unknown> | undefined,
): string => {
  const raw = modelOptions?.[option.id];
  const levels = optionLevels(option);
  if (typeof raw === 'string' && levels.includes(raw)) return raw;
  if (levels.includes(option.defaultChoice)) return option.defaultChoice;
  return levels[0];
};

const familyModels = (
  catalog: readonly Model[],
  family: string,
): ParsedModelVariant[] =>
  catalog
    .map(m => parseModelVariant(m.id))
    .filter(v => v.family === family && v.family !== '');

const orderedEfforts = (variants: readonly ParsedModelVariant[]): string[] => {
  const present = new Set(
    variants
      .map(v => v.effort)
      .filter((e): e is string => e !== undefined && e !== ''),
  );
  return EFFORT_SUFFIX_ORDER.filter(e => present.has(e));
};

const resolveFast = (
  model: Model,
  catalog: readonly Model[],
  config: TraitConfig | undefined,
): FastTrait | undefined => {
  const option = fastOptionForModel(model);
  if (option !== undefined) {
    const raw = config?.modelOptions?.[option.id];
    return {
      kind: 'option',
      option,
      enabled: isFastEnabled(config?.modelOptions, option),
      choice: typeof raw === 'string' ? raw : option.defaultChoice,
    };
  }
  const parsed = parseModelVariant(model.id);
  const variants = familyModels(catalog, parsed.family);
  const hasFast = variants.some(v => v.fast);
  const hasSlow = variants.some(v => !v.fast);
  if (!hasFast || !hasSlow) return undefined;
  return {
    kind: 'variant',
    enabled: parsed.fast,
    choice: parsed.fast ? 'on' : 'off',
  };
};

export const resolveModelTraits = (
  model: Model | undefined,
  catalog: readonly Model[],
  harnessLevels: readonly string[] | undefined,
  config?: TraitConfig,
): ModelTraits => {
  if (model === undefined) return {};
  const fast = resolveFast(model, catalog, config);
  const levels = effortLevelsForModel(model, harnessLevels);
  if (levels.length > 0) {
    return {
      effort: {
        kind: 'reasoning',
        levels,
        value: rememberedReasoning(
          { reasoning: config?.reasoning },
          levels,
          config?.reasoning,
        ),
      },
      fast,
    };
  }
  const option = effortOptionForModel(model);
  if (option !== undefined) {
    const optionLevelsList = optionLevels(option);
    return {
      effort: {
        kind: 'option',
        levels: optionLevelsList,
        value: optionValue(option, config?.modelOptions),
        optionId: option.id,
      },
      fast,
    };
  }
  const parsed = parseModelVariant(model.id);
  const variants = familyModels(catalog, parsed.family);
  const variantLevels = orderedEfforts(variants);
  if (variantLevels.length < 2) {
    return { fast, family: parsed.family };
  }
  const value =
    parsed.effort !== undefined && variantLevels.includes(parsed.effort)
      ? parsed.effort
      : variantLevels[0];
  return {
    effort: {
      kind: 'variant',
      levels: variantLevels,
      value,
    },
    fast,
    family: parsed.family,
  };
};

const passThrough = (current: TraitConfig): TraitPatch => ({
  model: current.model,
  reasoning: current.reasoning,
  modelOptions: current.modelOptions ?? {},
});

export const applyEffortLevel = (
  traits: ModelTraits,
  level: string,
  current: TraitConfig,
  catalog: readonly Model[],
): TraitPatch => {
  const effort = traits.effort;
  if (effort === undefined || !effort.levels.includes(level)) {
    return passThrough(current);
  }
  if (effort.kind === 'reasoning') {
    return {
      model: current.model,
      reasoning: level,
      modelOptions: current.modelOptions ?? {},
    };
  }
  if (effort.kind === 'option' && effort.optionId !== undefined) {
    return {
      model: current.model,
      reasoning: current.reasoning,
      modelOptions: {
        ...(current.modelOptions ?? {}),
        [effort.optionId]: level,
      },
    };
  }
  const family = traits.family ?? parseModelVariant(current.model ?? '').family;
  const fast =
    traits.fast?.enabled ?? parseModelVariant(current.model ?? '').fast;
  const next = pickVariantId(catalog, family, level, fast);
  return {
    model: next ?? current.model,
    reasoning: current.reasoning,
    modelOptions: current.modelOptions ?? {},
  };
};

/** Restore last-used reasoning / options for a catalog pick. */
export const selectionForModel = (
  model: Model | undefined,
  catalog: readonly Model[],
  harnessLevels: readonly string[] | undefined,
  stored: ModelSettings | undefined,
  live?: TraitConfig,
): {
  traits: ModelTraits;
  reasoning?: string;
  modelOptions: Record<string, unknown>;
} => {
  const modelOptions = rememberedModelOptions(
    stored,
    model?.options,
    live?.modelOptions,
  );
  const traits = resolveModelTraits(model, catalog, harnessLevels, {
    reasoning: live?.reasoning ?? stored?.reasoning,
    modelOptions: live?.modelOptions ?? stored?.modelOptions,
  });
  return {
    traits,
    reasoning:
      traits.effort?.kind === 'reasoning' ? traits.effort.value : undefined,
    modelOptions,
  };
};

export const applyFastChoice = (
  traits: ModelTraits,
  choiceId: string,
  current: TraitConfig,
  catalog: readonly Model[],
): TraitPatch => {
  const fast = traits.fast;
  if (fast === undefined) return passThrough(current);
  if (fast.kind === 'option' && fast.option !== undefined) {
    const option = fast.option;
    const resolved =
      choiceId === 'on'
        ? fastOnChoice(option)
        : choiceId === 'off'
        ? fastOffChoice(option)
        : choiceId;
    return {
      model: current.model,
      reasoning: current.reasoning,
      modelOptions: {
        ...(current.modelOptions ?? {}),
        [option.id]: resolved,
      },
    };
  }
  const family = traits.family ?? parseModelVariant(current.model ?? '').family;
  const effort = traits.effort?.value;
  const next = pickVariantId(
    catalog,
    family,
    effort,
    !isFastOffChoice(choiceId),
  );
  return {
    model: next ?? current.model,
    reasoning: current.reasoning,
    modelOptions: current.modelOptions ?? {},
  };
};
