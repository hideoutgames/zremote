// Resolve composer Effort / Fast / context window from the host catalog:
// advertised reasoningLevels (Codex/Claude), then effort-like Model.options
// (Cursor params), then variant ids — Devin-style suffixes
// (`family-medium` / `family-high-fast`) or Antigravity display names
// (`Gemini 3.1 Pro (Low)` paired with a different High id).

import type { Model, ModelOption } from '../zeron/protocol/types';
import { contextOptionForModel } from './contextWindow';
import {
  fastOffChoice,
  fastOnChoice,
  fastOptionForModel,
  isFastEnabled,
  isFastOffChoice,
} from './fastMode';
import {
  effortLevelsForModel,
  normCatalogId,
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

const EFFORT_OPTION_NORMS = new Set(['effort', 'reasoning', 'reasoningeffort']);

/** Longest first so `ultrathink` is not read as `ultra` and `xhigh` as `high`. */
const LABEL_LEVEL_MATCH = [
  'ultrathink',
  'ultracode',
  'minimal',
  'medium',
  'xhigh',
  'ultra',
  'high',
  'max',
  'low',
] as const;

const LEVEL_ORDER = [
  ...EFFORT_SUFFIX_ORDER,
  'ultra',
  'ultracode',
  'ultrathink',
] as const;

const LEVEL_CHOICE_NORMS = new Set<string>([...LEVEL_ORDER, 'extrahigh']);

export type EffortKind = 'reasoning' | 'option' | 'variant';

export interface EffortTrait {
  kind: EffortKind;
  levels: string[];
  value?: string;
  optionId?: string;
  /** Level → catalog model id when the host id is not `{family}-{level}`. */
  variantIds?: Record<string, string>;
}

export interface ContextTrait {
  option: ModelOption;
  choice: string;
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
  context?: ContextTrait;
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
  LEVEL_CHOICE_NORMS.has(normCatalogId(id));

/** Effort-like option: named effort/reasoning, or `thinking` with level choices. */
export const effortOptionForModel = (
  model: Model | undefined,
): ModelOption | undefined => {
  const options = model?.options ?? [];
  const named = options.find(
    o => EFFORT_OPTION_NORMS.has(normCatalogId(o.id)) && o.choices.length >= 2,
  );
  if (named !== undefined) return named;
  const thinking = options.find(o => normCatalogId(o.id) === 'thinking');
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

type LabelLevel = (typeof LABEL_LEVEL_MATCH)[number];

/** `Gemini 3.1 Pro (High)` → base + level. Parenthetical, not a bare suffix. */
const labelEffort = (
  label: string,
): { base: string; level: LabelLevel } | undefined => {
  const trimmed = label.trim();
  const lower = trimmed.toLowerCase();
  for (const level of LABEL_LEVEL_MATCH) {
    const suffix = ` (${level})`;
    if (!lower.endsWith(suffix)) continue;
    const base = trimmed.slice(0, trimmed.length - suffix.length).trim();
    if (base === '') return undefined;
    return { base, level };
  }
  return undefined;
};

/** Variants grouped by display name when the host ids do not share a family. */
const labelVariantEffort = (
  model: Model,
  catalog: readonly Model[],
):
  | { levels: string[]; variantIds: Record<string, string>; value: string }
  | undefined => {
  const current = labelEffort(model.label);
  if (current === undefined) return undefined;
  const ids: Record<string, string> = {};
  const base = current.base.toLowerCase();
  for (const sibling of catalog) {
    const other = labelEffort(sibling.label);
    if (other === undefined || other.base.toLowerCase() !== base) continue;
    if (ids[other.level] === undefined) ids[other.level] = sibling.id;
  }
  const levels = LEVEL_ORDER.filter(level => ids[level] !== undefined);
  if (levels.length < 2) return undefined;
  const variantIds: Record<string, string> = {};
  for (const level of levels) variantIds[level] = ids[level];
  const value = levels.includes(current.level) ? current.level : levels[0];
  return { levels, variantIds, value };
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

const resolveContext = (
  model: Model,
  config: TraitConfig | undefined,
): ContextTrait | undefined => {
  const option = contextOptionForModel(model);
  if (option === undefined) return undefined;
  return { option, choice: optionValue(option, config?.modelOptions) };
};

const withContext = (
  traits: ModelTraits,
  context: ContextTrait | undefined,
): ModelTraits => {
  if (context !== undefined) traits.context = context;
  return traits;
};

export const resolveModelTraits = (
  model: Model | undefined,
  catalog: readonly Model[],
  harnessLevels: readonly string[] | undefined,
  config?: TraitConfig,
): ModelTraits => {
  if (model === undefined) {
    const levels = [...(harnessLevels ?? [])];
    if (levels.length === 0) return {};
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
    };
  }
  const fast = resolveFast(model, catalog, config);
  const context = resolveContext(model, config);
  const levels = effortLevelsForModel(model, harnessLevels);
  if (levels.length > 0) {
    return withContext(
      {
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
      },
      context,
    );
  }
  const option = effortOptionForModel(model);
  if (option !== undefined) {
    const optionLevelsList = optionLevels(option);
    return withContext(
      {
        effort: {
          kind: 'option',
          levels: optionLevelsList,
          value: optionValue(option, config?.modelOptions),
          optionId: option.id,
        },
        fast,
      },
      context,
    );
  }
  const labeled = labelVariantEffort(model, catalog);
  const parsed = parseModelVariant(model.id);
  if (labeled !== undefined) {
    return withContext(
      {
        effort: {
          kind: 'variant',
          levels: labeled.levels,
          value: labeled.value,
          variantIds: labeled.variantIds,
        },
        fast,
        family: parsed.family,
      },
      context,
    );
  }
  const variants = familyModels(catalog, parsed.family);
  const variantLevels = orderedEfforts(variants);
  if (variantLevels.length < 2) {
    return withContext({ fast, family: parsed.family }, context);
  }
  const value =
    parsed.effort !== undefined && variantLevels.includes(parsed.effort)
      ? parsed.effort
      : variantLevels[0];
  return withContext(
    {
      effort: {
        kind: 'variant',
        levels: variantLevels,
        value,
      },
      fast,
      family: parsed.family,
    },
    context,
  );
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
  const mapped = effort.variantIds?.[level];
  if (mapped !== undefined) {
    return {
      model: mapped,
      reasoning: current.reasoning,
      modelOptions: current.modelOptions ?? {},
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

export const applyContextChoice = (
  traits: ModelTraits,
  choiceId: string,
  current: TraitConfig,
): TraitPatch => {
  const context = traits.context;
  if (
    context === undefined ||
    !context.option.choices.some(c => c.id === choiceId)
  ) {
    return passThrough(current);
  }
  return {
    model: current.model,
    reasoning: current.reasoning,
    modelOptions: {
      ...(current.modelOptions ?? {}),
      [context.option.id]: choiceId,
    },
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
