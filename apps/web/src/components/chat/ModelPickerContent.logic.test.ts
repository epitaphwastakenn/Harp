import type { ModelCapabilities, ProviderOptionDescriptor } from "@t3tools/contracts";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";
import { describe, expect, it } from "vite-plus/test";

import {
  descriptorsMatchDefaults,
  findEffortDescriptor,
  modelSubtitle,
  pickProviderDefaultModel,
  providerStatusLabel,
} from "./ModelPickerContent.logic";

const caps: ModelCapabilities = {
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning effort",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "high", label: "High", isDefault: true },
        { id: "max", label: "Max" },
      ],
    },
    { id: "fastMode", label: "Fast mode", type: "boolean" },
    {
      id: "contextWindow",
      label: "Context window",
      type: "select",
      options: [
        { id: "200k", label: "200k", isDefault: true },
        { id: "1m", label: "1M" },
      ],
    },
  ],
};

const defaults = getProviderOptionDescriptors({ caps });
const withSelections = (selections: Array<{ id: string; value: string | boolean }>) =>
  getProviderOptionDescriptors({ caps, selections });

const subtitleBase = {
  isUnavailable: false,
  isLegacy: false,
  isNew: false,
  isDefault: false,
  subProvider: undefined,
  providerLabel: "Claude",
  showProvider: false,
};

describe("modelSubtitle", () => {
  it("has nothing to say about a plain model", () => {
    expect(modelSubtitle(subtitleBase)).toBeNull();
  });

  it("names the provider where models from several providers mix", () => {
    expect(modelSubtitle({ ...subtitleBase, showProvider: true })).toBe("Claude");
    expect(
      modelSubtitle({ ...subtitleBase, showProvider: true, providerLabel: "OpenCode · Zen" }),
    ).toBe("OpenCode · Zen");
  });

  it("shows the sub provider, then new, then legacy, then default", () => {
    expect(modelSubtitle({ ...subtitleBase, subProvider: "OpenRouter", isNew: true })).toBe(
      "OpenRouter",
    );
    expect(modelSubtitle({ ...subtitleBase, isNew: true, isLegacy: true })).toBe("New");
    expect(modelSubtitle({ ...subtitleBase, isLegacy: true, isDefault: true })).toBe("Legacy");
    expect(modelSubtitle({ ...subtitleBase, isDefault: true })).toBe("Default");
  });

  it("puts an unavailable model above everything else", () => {
    expect(modelSubtitle({ ...subtitleBase, isUnavailable: true, showProvider: true })).toBe(
      "Unavailable",
    );
  });
});

describe("providerStatusLabel", () => {
  const ready = {
    enabled: true,
    installed: true,
    ready: true,
    status: "ready",
    authStatus: "authenticated",
    locked: false,
  } as const;

  it("leaves a ready provider unlabelled", () => {
    expect(providerStatusLabel(ready)).toBeNull();
  });

  it("explains why a provider cannot be used", () => {
    const notReady = { ...ready, ready: false };
    expect(providerStatusLabel({ ...notReady, installed: false })).toBe("Not installed");
    expect(providerStatusLabel({ ...notReady, authStatus: "unauthenticated" })).toBe("Sign in");
    expect(providerStatusLabel({ ...notReady, status: "error" })).toBe("Unavailable");
    expect(providerStatusLabel({ ...notReady, status: "warning" })).toBe("Limited");
    expect(providerStatusLabel({ ...notReady, authStatus: "unknown" })).toBe("Not ready");
    expect(providerStatusLabel({ ...notReady, enabled: false })).toBe("Disabled");
    expect(providerStatusLabel({ ...notReady, status: "disabled" })).toBe("Disabled");
  });

  it("marks providers that a started thread cannot switch to", () => {
    expect(providerStatusLabel({ ...ready, locked: true })).toBe("Locked");
  });
});

describe("pickProviderDefaultModel", () => {
  const models = [
    { slug: "old", isLegacy: true, isDefault: true },
    { slug: "fast" },
    { slug: "smart", isDefault: true },
  ];

  it("returns to the model last used on that provider", () => {
    expect(pickProviderDefaultModel(models, "fast")).toBe("fast");
  });

  it("falls back to the default model, then the first current model", () => {
    expect(pickProviderDefaultModel(models, undefined)).toBe("smart");
    expect(pickProviderDefaultModel(models, "gone")).toBe("smart");
    expect(pickProviderDefaultModel([{ slug: "a" }, { slug: "b" }], undefined)).toBe("a");
  });

  it("settles for a legacy model when nothing else exists", () => {
    expect(pickProviderDefaultModel([{ slug: "old", isLegacy: true }], undefined)).toBe("old");
  });

  it("has no model to pick from an empty provider", () => {
    expect(pickProviderDefaultModel([], undefined)).toBeNull();
  });
});

describe("findEffortDescriptor", () => {
  const selects = defaults.filter(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
      descriptor.type === "select",
  );

  it("picks the effort level and leaves other selects for the segmented controls", () => {
    expect(findEffortDescriptor(selects)?.id).toBe("effort");
    expect(findEffortDescriptor(selects.slice(1))).toBeNull();
  });

  it("recognises a reasoning control by its label", () => {
    const variant = {
      id: "variant",
      label: "Reasoning",
      type: "select",
      options: [{ id: "a", label: "A" }],
    } as const;
    expect(findEffortDescriptor([variant])?.id).toBe("variant");
  });

  it("ignores an effort control that has no levels", () => {
    expect(
      findEffortDescriptor([{ id: "effort", label: "Effort", type: "select", options: [] }]),
    ).toBeNull();
  });
});

describe("descriptorsMatchDefaults", () => {
  it("matches when nothing was changed", () => {
    expect(descriptorsMatchDefaults(withSelections([]), defaults)).toBe(true);
  });

  it("treats an explicit default as unchanged", () => {
    expect(
      descriptorsMatchDefaults(
        withSelections([
          { id: "effort", value: "high" },
          { id: "fastMode", value: false },
        ]),
        defaults,
      ),
    ).toBe(true);
  });

  it("notices a changed level or a switched-on option", () => {
    expect(
      descriptorsMatchDefaults(withSelections([{ id: "effort", value: "max" }]), defaults),
    ).toBe(false);
    expect(
      descriptorsMatchDefaults(withSelections([{ id: "fastMode", value: true }]), defaults),
    ).toBe(false);
    expect(
      descriptorsMatchDefaults(withSelections([{ id: "contextWindow", value: "1m" }]), defaults),
    ).toBe(false);
  });
});
