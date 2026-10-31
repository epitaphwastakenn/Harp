import type {
  ProviderOptionDescriptor,
  ServerProviderAuthStatus,
  ServerProviderState,
} from "@t3tools/contracts";
import { REASONING_SELECT_DESCRIPTOR_IDS } from "@t3tools/client-runtime/model-traits";
import { getProviderOptionCurrentValue } from "@t3tools/shared/model";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

export function modelSubtitle(input: {
  readonly isUnavailable: boolean;
  readonly isLegacy: boolean;
  readonly isNew: boolean;
  readonly isDefault: boolean;
  readonly subProvider: string | undefined;
  readonly providerLabel: string;
  readonly showProvider: boolean;
}): string | null {
  if (input.isUnavailable) return "Unavailable";
  if (input.showProvider) return input.providerLabel;
  if (input.subProvider) return input.subProvider;
  if (input.isNew) return "New";
  if (input.isLegacy) return "Legacy";
  if (input.isDefault) return "Default";
  return null;
}

export function providerStatusLabel(input: {
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly ready: boolean;
  readonly status: ServerProviderState;
  readonly authStatus: ServerProviderAuthStatus;
  readonly locked: boolean;
}): string | null {
  if (input.locked) return "Locked";
  if (!input.enabled || input.status === "disabled") return "Disabled";
  if (input.ready) return null;
  if (!input.installed) return "Not installed";
  if (input.authStatus === "unauthenticated") return "Sign in";
  if (input.status === "error") return "Unavailable";
  if (input.status === "warning") return "Limited";
  return "Not ready";
}

export function pickProviderDefaultModel(
  models: ReadonlyArray<{
    readonly slug: string;
    readonly isDefault?: boolean | undefined;
    readonly isLegacy?: boolean | undefined;
  }>,
  rememberedSlug: string | undefined,
): string | null {
  const remembered = models.find((model) => model.slug === rememberedSlug);
  if (remembered) return remembered.slug;
  return (
    models.find((model) => model.isDefault && !model.isLegacy)?.slug ??
    models.find((model) => !model.isLegacy)?.slug ??
    models[0]?.slug ??
    null
  );
}

export function findEffortDescriptor(
  descriptors: ReadonlyArray<SelectDescriptor>,
): SelectDescriptor | null {
  return (
    descriptors.find(
      (descriptor) =>
        descriptor.options.length > 0 &&
        (REASONING_SELECT_DESCRIPTOR_IDS.has(descriptor.id) ||
          /effort|reasoning/i.test(descriptor.label)),
    ) ?? null
  );
}

export function descriptorsMatchDefaults(
  current: ReadonlyArray<ProviderOptionDescriptor>,
  defaults: ReadonlyArray<ProviderOptionDescriptor>,
): boolean {
  const defaultById = new Map(defaults.map((descriptor) => [descriptor.id, descriptor]));
  return current.every((descriptor) => {
    const base = defaultById.get(descriptor.id);
    return (
      (getProviderOptionCurrentValue(descriptor) ?? false) ===
      (getProviderOptionCurrentValue(base) ?? false)
    );
  });
}
