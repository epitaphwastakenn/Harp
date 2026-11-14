import {
  type ModelCapabilities,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import {
  buildExplicitProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  migrateLegacyUltracodeOptions,
  normalizeModelSlug,
  withImplicitFastModeDefault,
} from "@t3tools/shared/model";

import { getProviderModelCapabilities } from "../../providerModels";
import { getReasoningTraitStep } from "./TraitsPicker";

export type ComposerProviderStateInput = {
  provider: ProviderDriverKind;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  includePlanAgent?: boolean | undefined;
};

const COMPOSER_MAX_EFFORT_FRAME = {
  composerFrameClassName: "max-effort-frame",
  composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.07)_inset]",
} as const;

export type ComposerProviderState = {
  provider: ProviderDriverKind;
  promptEffort: string | null;
  modelOptionsForDispatch: ReadonlyArray<ProviderOptionSelection> | undefined;
  composerFrameClassName?: string;
  composerSurfaceClassName?: string;
  modelPickerIconClassName?: string;
};

function resolveComposerOptionSelections(
  models: ReadonlyArray<ServerProviderModel>,
  model: string,
  provider: ProviderDriverKind,
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  includePlanAgent: boolean | undefined,
): {
  caps: ModelCapabilities;
  selections: ReadonlyArray<ProviderOptionSelection> | undefined;
} {
  const caps = getProviderModelCapabilities(models, model, provider, includePlanAgent);
  return {
    caps,
    selections: withImplicitFastModeDefault(caps, migrateLegacyUltracodeOptions(modelOptions)),
  };
}

export function getComposerProviderState(input: ComposerProviderStateInput): ComposerProviderState {
  const { provider, model, models, modelOptions, includePlanAgent } = input;
  if (provider === "opencode" || provider === "cursor") {
    const normalizedModel = normalizeModelSlug(model, provider);
    const modelIsInCatalog = models.some((candidate) => candidate.slug === normalizedModel);
    if (!modelIsInCatalog) {
      const preservedOptions = modelOptions?.filter(
        (option) => includePlanAgent || option.id !== "agent" || option.value !== "plan",
      );
      return {
        provider,
        promptEffort: null,
        modelOptionsForDispatch:
          preservedOptions && preservedOptions.length > 0 ? preservedOptions : undefined,
      };
    }
  }
  const { caps, selections } = resolveComposerOptionSelections(
    models,
    model,
    provider,
    modelOptions,
    includePlanAgent,
  );
  const descriptors = getProviderOptionDescriptors({ caps, selections });
  const primarySelectDescriptor = descriptors.find(
    (descriptor): descriptor is Extract<(typeof descriptors)[number], { type: "select" }> =>
      descriptor.type === "select",
  );
  const primaryValue = getProviderOptionCurrentValue(primarySelectDescriptor ?? null);
  const promptEffort = typeof primaryValue === "string" ? primaryValue : null;
  const lastEffortOption = primarySelectDescriptor?.options.at(-1);
  const isMaximumEffort =
    (primarySelectDescriptor?.options.length ?? 0) > 1 &&
    promptEffort !== null &&
    promptEffort === lastEffortOption?.id;

  return {
    provider,
    promptEffort,
    modelOptionsForDispatch: buildExplicitProviderOptionSelectionsFromDescriptors(
      descriptors,
      selections,
    ),
    ...(isMaximumEffort ? COMPOSER_MAX_EFFORT_FRAME : {}),
  };
}

export function getComposerReasoningStep(input: {
  provider: ProviderDriverKind;
  instanceId: ProviderInstanceId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  reportedModelSelection?: ModelSelection | null | undefined;
  includePlanAgent?: boolean | undefined;
  direction: 1 | -1;
}): { modelOptions: ReadonlyArray<ProviderOptionSelection> } | null {
  const { selections } = resolveComposerOptionSelections(
    input.models,
    input.model,
    input.provider,
    input.modelOptions,
    input.includePlanAgent,
  );
  return getReasoningTraitStep({
    provider: input.provider,
    instanceId: input.instanceId,
    model: input.model,
    models: input.models,
    modelOptions: selections,
    reportedModelSelection: input.reportedModelSelection,
    includePlanAgent: input.includePlanAgent,
    direction: input.direction,
  });
}
