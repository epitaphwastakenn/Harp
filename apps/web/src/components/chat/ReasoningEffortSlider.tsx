import { memo, useEffect, useState } from "react";
import { type ProviderOptionDescriptor, type ReasoningSliderStyle } from "@t3tools/contracts";

import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { ClassicEffortSlider } from "./effortSliders/ClassicEffortSlider";
import { CometEffortSlider } from "./effortSliders/CometEffortSlider";
import { LiquidEffortSlider } from "./effortSliders/LiquidEffortSlider";

export interface ReasoningEffortSliderProps {
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>;
  selectedValue: string;
  disabled?: boolean;
  onSelect: (optionId: string) => void;
  className?: string;
  sliderStyle?: ReasoningSliderStyle;
  numberKeys?: boolean;
}

const variants = {
  liquid: LiquidEffortSlider,
  comet: CometEffortSlider,
  classic: ClassicEffortSlider,
};

export const ReasoningEffortSlider = memo(function ReasoningEffortSlider({
  descriptor,
  selectedValue,
  disabled = false,
  onSelect,
  className,
  sliderStyle,
  numberKeys = true,
}: ReasoningEffortSliderProps) {
  const settingsStyle = useClientSettings((settings) => settings.reasoningSliderStyle);
  const Variant = variants[sliderStyle ?? settingsStyle];
  const options = descriptor.options;

  let selectedIndex = options.findIndex((option) => option.id === selectedValue);
  if (selectedIndex === -1) {
    const defaultIndex = options.findIndex((option) => option.isDefault);
    selectedIndex = defaultIndex >= 0 ? defaultIndex : 0;
  }

  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const activeIndex = previewIndex ?? selectedIndex;

  const commit = (index: number) => {
    setPreviewIndex(null);
    const option = options[index];
    if (option && index !== selectedIndex) onSelect(option.id);
  };

  // Number keys pick a level while the picker is open, as in Harp 1.x.
  useEffect(() => {
    if (disabled || !numberKeys) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > options.length) return;
      event.preventDefault();
      commit(digit - 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commit, disabled, numberKeys, options.length]);

  const current = options[activeIndex] ?? options[0];
  const label = descriptor.label || "Effort level";

  return (
    <div className={cn("w-full space-y-1", className)}>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span
          key={current?.id}
          className="rounded-full bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand"
        >
          {current?.label}
        </span>
      </div>
      <Variant
        options={options}
        value={activeIndex}
        label={label}
        disabled={disabled}
        onPreview={setPreviewIndex}
        onCommit={commit}
      />
    </div>
  );
});
