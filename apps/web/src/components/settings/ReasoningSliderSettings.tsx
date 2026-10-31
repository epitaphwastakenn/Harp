import { useState } from "react";
import {
  DEFAULT_UNIFIED_SETTINGS,
  REASONING_SLIDER_STYLES,
  type ProviderOptionDescriptor,
  type ReasoningSliderStyle,
} from "@t3tools/contracts";

import { ReasoningEffortSlider } from "../chat/ReasoningEffortSlider";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const styleLabels: Record<ReasoningSliderStyle, string> = {
  liquid: "Liquid",
  comet: "Comet",
  classic: "Classic",
};

const previewDescriptor: Extract<ProviderOptionDescriptor, { type: "select" }> = {
  id: "effort",
  label: "Reasoning",
  type: "select",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High", isDefault: true },
    { id: "xhigh", label: "Extra High" },
    { id: "max", label: "Max" },
  ],
};

const isSliderStyle = (value: string | undefined): value is ReasoningSliderStyle =>
  REASONING_SLIDER_STYLES.some((style) => style === value);

export function ReasoningSliderSettings() {
  const style = useScopedSettings((settings) => settings.reasoningSliderStyle);
  const updateSettings = useUpdateScopedSettings();
  const [previewValue, setPreviewValue] = useState("high");

  return (
    <SettingsRow
      {...searchableSetting("reasoning-slider-style")}
      description="How the reasoning level slider in the model picker looks."
      resetAction={
        style !== DEFAULT_UNIFIED_SETTINGS.reasoningSliderStyle ? (
          <SettingResetButton
            label="reasoning slider style"
            onClick={() =>
              updateSettings({
                reasoningSliderStyle: DEFAULT_UNIFIED_SETTINGS.reasoningSliderStyle,
              })
            }
          />
        ) : null
      }
      control={
        <ToggleGroup
          aria-label="Reasoning slider style"
          onValueChange={(next) => {
            if (isSliderStyle(next[0])) updateSettings({ reasoningSliderStyle: next[0] });
          }}
          value={[style]}
        >
          {REASONING_SLIDER_STYLES.map((option) => (
            <Toggle key={option} value={option}>
              {styleLabels[option]}
            </Toggle>
          ))}
        </ToggleGroup>
      }
    >
      <div className="mt-3 mb-1 max-w-sm rounded-xl bg-popover px-3.5 py-3 shadow-lg shadow-black/30">
        <ReasoningEffortSlider
          descriptor={previewDescriptor}
          selectedValue={previewValue}
          onSelect={setPreviewValue}
          sliderStyle={style}
          numberKeys={false}
        />
      </div>
    </SettingsRow>
  );
}
