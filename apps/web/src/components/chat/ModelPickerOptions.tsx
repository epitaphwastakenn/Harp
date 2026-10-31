import { getDescriptorStringValue } from "@t3tools/client-runtime/model-traits";
import { type ProviderOptionDescriptor } from "@t3tools/contracts";
import {
  BrainIcon,
  CodeXmlIcon,
  SlidersHorizontalIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export type BooleanOptionDescriptor = Extract<ProviderOptionDescriptor, { type: "boolean" }>;
export type SelectOptionDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

const optionIcons: Readonly<Record<string, LucideIcon>> = {
  ultracode: CodeXmlIcon,
  fastMode: ZapIcon,
  thinking: BrainIcon,
};

function OptionSwitchRow(props: {
  descriptor: BooleanOptionDescriptor;
  onToggle: (descriptor: BooleanOptionDescriptor) => void;
}) {
  const { descriptor } = props;
  const Icon = optionIcons[descriptor.id] ?? SlidersHorizontalIcon;
  return (
    <label className="flex min-w-0 cursor-pointer items-center gap-3 px-1">
      <Icon className="size-5 shrink-0 text-icon-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold leading-snug text-foreground">
          {descriptor.label}
        </span>
        {descriptor.description ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="block truncate text-xs leading-tight text-muted-foreground" />
              }
            >
              {descriptor.description}
            </TooltipTrigger>
            <TooltipPopup side="top" className="max-w-72">
              {descriptor.description}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </span>
      <Switch
        checked={descriptor.currentValue === true}
        onCheckedChange={() => props.onToggle(descriptor)}
      />
    </label>
  );
}

function OptionChoices(props: {
  descriptor: SelectOptionDescriptor;
  onSelect: (descriptor: SelectOptionDescriptor, value: string) => void;
}) {
  const { descriptor } = props;
  const selectedValue = getDescriptorStringValue(descriptor) ?? "";
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <span className="text-xs text-muted-foreground">{descriptor.label}</span>
      <ToggleGroup
        aria-label={descriptor.label}
        className="max-w-full flex-wrap"
        value={[selectedValue]}
        onValueChange={(values) => {
          const next = values[0];
          if (typeof next === "string" && next.length > 0) props.onSelect(descriptor, next);
        }}
      >
        {descriptor.options.map((option) =>
          option.description ? (
            <Tooltip key={option.id}>
              <TooltipTrigger render={<Toggle value={option.id} />}>{option.label}</TooltipTrigger>
              <TooltipPopup side="top" className="max-w-72">
                {option.description}
              </TooltipPopup>
            </Tooltip>
          ) : (
            <Toggle key={option.id} value={option.id}>
              {option.label}
            </Toggle>
          ),
        )}
      </ToggleGroup>
    </div>
  );
}

export function ModelPickerOptions(props: {
  booleans: ReadonlyArray<BooleanOptionDescriptor>;
  selects: ReadonlyArray<SelectOptionDescriptor>;
  compactEffort: SelectOptionDescriptor | null;
  emptyLabel: string;
  onToggle: (descriptor: BooleanOptionDescriptor) => void;
  onSelect: (descriptor: SelectOptionDescriptor, value: string) => void;
}) {
  const isEmpty = props.booleans.length === 0 && props.selects.length === 0;
  return (
    <div
      data-model-picker-traits="true"
      className="mx-4 flex min-h-20 flex-col justify-center gap-3 border-t border-border/50 py-3.5"
    >
      {props.compactEffort ? (
        <div className="hidden @max-[31rem]/picker:block">
          <OptionChoices descriptor={props.compactEffort} onSelect={props.onSelect} />
        </div>
      ) : null}
      {props.booleans.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 @max-[31rem]/picker:grid-cols-1 [&>*+*]:border-l [&>*+*]:border-border/50 [&>*+*]:ps-6 @max-[31rem]/picker:[&>*+*]:border-l-0 @max-[31rem]/picker:[&>*+*]:ps-1">
          {props.booleans.map((descriptor) => (
            <OptionSwitchRow
              key={descriptor.id}
              descriptor={descriptor}
              onToggle={props.onToggle}
            />
          ))}
        </div>
      ) : null}
      {props.selects.map((descriptor) => (
        <OptionChoices key={descriptor.id} descriptor={descriptor} onSelect={props.onSelect} />
      ))}
      {isEmpty ? (
        <p className="text-center text-xs text-muted-foreground">{props.emptyLabel}</p>
      ) : null}
    </div>
  );
}
