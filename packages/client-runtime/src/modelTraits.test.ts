import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildTraitsTriggerDisplay, getDescriptorStringValue } from "./modelTraits.ts";

const effort: ProviderOptionDescriptor = {
  id: "effort",
  label: "Reasoning",
  type: "select",
  options: [
    { id: "high", label: "High" },
    { id: "xhigh", label: "Extra High" },
  ],
  currentValue: "xhigh",
};
const fastMode = (currentValue: boolean): ProviderOptionDescriptor => ({
  id: "fastMode",
  label: "Fast Mode",
  type: "boolean",
  currentValue,
});
const ultracode = (currentValue: boolean | undefined): ProviderOptionDescriptor => ({
  id: "ultracode",
  label: "Ultracode",
  type: "boolean",
  ...(currentValue === undefined ? {} : { currentValue }),
});

const triggerLabel = (descriptors: ReadonlyArray<ProviderOptionDescriptor>) =>
  buildTraitsTriggerDisplay({
    descriptors,
    primarySelectDescriptorId: "effort",
    ultrathinkPromptControlled: false,
  }).label;

describe("buildTraitsTriggerDisplay", () => {
  it("names Ultracode after the effort level when it is on and stays quiet when it is off", () => {
    expect(triggerLabel([effort, ultracode(true)])).toBe("Extra High · Ultracode");
    expect(triggerLabel([effort, ultracode(false)])).toBe("Extra High");
    expect(triggerLabel([effort, ultracode(undefined)])).toBe("Extra High");
  });

  it("keeps the Fast suffix on the effort level next to Ultracode", () => {
    expect(triggerLabel([effort, fastMode(true), ultracode(true)])).toBe(
      "Extra High Fast · Ultracode",
    );
  });

  it.each([
    { currentValue: undefined, defaultValue: undefined, value: null, label: "Thinking" },
    { currentValue: undefined, defaultValue: "high", value: "high", label: "High" },
    { currentValue: "low", defaultValue: undefined, value: "low", label: "Low" },
    { currentValue: "max", defaultValue: "high", value: "max", label: "Max" },
    { id: "effort", currentValue: undefined, defaultValue: undefined, value: null, label: "" },
  ])("labels Pi thinking without inventing a selection: $label ($value)", (input) => {
    const descriptor: Extract<ProviderOptionDescriptor, { type: "select" }> = {
      id: input.id ?? "thinking",
      label: "Thinking",
      type: "select",
      options: ["low", "high", "max"].map((id) => ({
        id,
        label: id[0]!.toUpperCase() + id.slice(1),
        ...(id === input.defaultValue ? { isDefault: true } : {}),
      })),
      ...(input.currentValue ? { currentValue: input.currentValue } : {}),
    };

    expect(
      buildTraitsTriggerDisplay({
        descriptors: [descriptor],
        primarySelectDescriptorId: descriptor.id,
        ultrathinkPromptControlled: false,
      }).label,
    ).toBe(input.label);
    expect(getDescriptorStringValue(descriptor)).toBe(input.value);
  });
});
