import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type ProviderInstanceId,
  type EnvironmentId,
  type ProviderDriverKind,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ResolvedKeybindingsConfig,
  type ServerProviderModel,
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
} from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionDescriptors,
  resolveSelectableModel,
} from "@t3tools/shared/model";
import { useAtomValue } from "@effect/atom-react";
import { formatProviderUpdateRequiredNotice } from "@t3tools/client-runtime/providerUpdateRequiredModels";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, SearchIcon, StarIcon, XIcon } from "lucide-react";
import {
  memo,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import {
  getDescriptorStringValue,
  replaceDescriptorCurrentValue,
} from "@t3tools/client-runtime/model-traits";
import { getTraitsSectionVisibility } from "./TraitsPicker";
import { getProviderStatusMessage, hasProviderSetup } from "./ProviderStatusBanner";
import { modelPickerModelKey, parseModelPickerModelKey } from "./modelPickerKeys";
import { rankModelPickerSearch } from "./modelPickerSearch";
import {
  descriptorsMatchDefaults,
  findEffortDescriptor,
  modelSubtitle,
  stripProviderPrefix,
  pickProviderDefaultModel,
  providerStatusLabel,
} from "./ModelPickerContent.logic";
import { ModelPickerOptions, type BooleanOptionDescriptor } from "./ModelPickerOptions";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { WheelColumn, type WheelItem } from "./WheelColumn";
import { getDisplayModelName, getProviderRowLabel, ModelEsque } from "./providerIconUtils";
import { stepEnabledIndex } from "./wheelPicker.logic";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { primaryServerKeybindingsAtom } from "../../state/server";
import {
  modelPickerJumpCommandForIndex,
  modelPickerJumpIndexFromCommand,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../../keybindings";
import {
  useClientSettings,
  useEnvironmentModelPreferences,
  useToggleEnvironmentModelFavorite,
} from "~/hooks/useSettings";
import { announce } from "~/lib/announce";
import { cn } from "~/lib/utils";
import { Button, InlineButton } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import {
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { providerModelKey, sortProviderModelItems } from "../../modelOrdering";

type ModelPickerItem = {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  badge?: "new";
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  instanceDisplayName: string;
  instanceAccentColor?: string | undefined;
  acpRegistryAgentId?: string | undefined;
  acpRegistryIconUrl?: string | undefined;
  continuationGroupKey?: string | undefined;
  isLegacy?: boolean | undefined;
  isDefault?: boolean | undefined;
  isUnavailable?: boolean | undefined;
};

type PickerView = ProviderInstanceId | "favorites";

export function resolveModelPickerSelectedModel(input: {
  driverKind: ProviderDriverKind | undefined;
  model: string;
  options: ReadonlyArray<ModelEsque>;
}) {
  if (input.driverKind === "antigravity" && input.model === ANTIGRAVITY_DEFAULT_MODEL) {
    const availableModels = input.options.filter(
      (option) => option.slug !== ANTIGRAVITY_DEFAULT_MODEL && !option.isUnavailable,
    );
    return (
      availableModels.find((option) => option.aliases?.includes(ANTIGRAVITY_DEFAULT_MODEL)) ??
      availableModels.find((option) => option.isDefault)
    );
  }
  return input.options.find((option) => option.slug === input.model);
}

function shouldIncludeModelPickerOption(input: {
  readonly entry: ProviderInstanceEntry;
  readonly option: ModelEsque;
  readonly activeInstanceId: ProviderInstanceId;
  readonly activeModel: string;
}): boolean {
  if (input.entry.driverKind === "antigravity" && input.option.slug === ANTIGRAVITY_DEFAULT_MODEL) {
    return false;
  }
  if (isProviderInstancePickerReady(input.entry)) return true;
  return (
    input.entry.enabled &&
    (input.entry.driverKind === "opencode" || input.entry.driverKind === "antigravity") &&
    input.entry.instanceId === input.activeInstanceId &&
    input.option.slug === input.activeModel &&
    input.option.isUnavailable === true
  );
}

function shouldOfferModelPickerSetup(
  entry: ProviderInstanceEntry,
  options: ReadonlyArray<ModelEsque>,
): boolean {
  return (
    entry.enabled &&
    entry.status !== "disabled" &&
    hasProviderSetup(entry.snapshot) &&
    (!isProviderInstancePickerReady(entry) ||
      !entry.installed ||
      entry.snapshot.auth.status === "unauthenticated" ||
      !options.some((option) => !option.isUnavailable))
  );
}

function adjacentModelPickerProvider(input: {
  entries: ReadonlyArray<ProviderInstanceEntry>;
  selectedInstanceId: PickerView;
  direction: 1 | -1;
  includeFavorites: boolean;
  disabledInstanceIds: ReadonlySet<ProviderInstanceId> | undefined;
  selectableUnavailableInstanceIds: ReadonlySet<ProviderInstanceId> | undefined;
}) {
  const providers: Array<PickerView> = [
    ...(input.includeFavorites ? (["favorites"] as const) : []),
    ...input.entries
      .filter(
        (entry) =>
          !input.disabledInstanceIds?.has(entry.instanceId) &&
          (isProviderInstancePickerReady(entry) ||
            input.selectableUnavailableInstanceIds?.has(entry.instanceId)),
      )
      .map((entry) => entry.instanceId),
  ];
  const index = providers.indexOf(input.selectedInstanceId);
  return providers[
    index < 0
      ? input.direction === 1
        ? 0
        : providers.length - 1
      : (index + input.direction + providers.length) % providers.length
  ]!;
}

const emptyModelJumpLabels = new Map<string, string>();

function modelJumpLabelsByKey(
  modelKeys: ReadonlyArray<string>,
  keybindings: ResolvedKeybindingsConfig,
  terminalOpen: boolean,
): ReadonlyMap<string, string> {
  const shortcutLabelOptions = {
    platform: navigator.platform,
    context: { terminalFocus: false, terminalOpen, modelPickerOpen: true },
  };
  const mapping = new Map<string, string>();
  for (const [index, modelKey] of modelKeys.entries()) {
    const command = modelPickerJumpCommandForIndex(index);
    const label = command && shortcutLabelForCommand(keybindings, command, shortcutLabelOptions);
    if (label) {
      mapping.set(modelKey, label);
    }
  }
  return mapping.size > 0 ? mapping : emptyModelJumpLabels;
}

function describeProviderEntry(entry: ProviderInstanceEntry, locked: boolean): string | undefined {
  const label = entry.displayName;
  if (locked) {
    return `${label} is unavailable in this thread. Start a new thread to switch providers.`;
  }
  if (!entry.enabled || entry.status === "disabled") return `${label}: Disabled in settings.`;
  if (isProviderInstancePickerReady(entry)) return undefined;
  const kind =
    entry.status === "error" ? "Unavailable" : entry.status === "warning" ? "Limited" : "Not ready";
  const message = entry.snapshot.message?.trim();
  return message ? `${label}: ${kind}. ${message}` : `${label}: ${kind}.`;
}

function ModelPickerProviderNotices({
  setupEntries,
  updateRequiredNotices,
  onRequestClose,
  onOpenProviderSetup,
}: {
  setupEntries: ReadonlyArray<ProviderInstanceEntry>;
  updateRequiredNotices: ReadonlyArray<{ instanceId: ProviderInstanceId; notice: string }>;
  onRequestClose: (() => void) | undefined;
  onOpenProviderSetup: ((instanceId: ProviderInstanceId) => void) | undefined;
}) {
  const navigate = useNavigate();
  if (setupEntries.length === 0 && updateRequiredNotices.length === 0) return null;
  return (
    <div className="max-h-44 shrink-0 space-y-1 overflow-y-auto border-t border-border/50 px-3 py-2">
      {setupEntries.map((entry) => (
        <div key={entry.instanceId} className="py-1 text-xs leading-snug">
          <p className="line-clamp-3 text-muted-foreground">
            {getProviderStatusMessage(entry.snapshot)}
          </p>
          <InlineButton
            className="mt-1"
            onClick={() => {
              onRequestClose?.();
              onOpenProviderSetup?.(entry.instanceId);
            }}
          >
            {setupEntries.length > 1 ? `Set up ${entry.displayName}` : "Open provider setup"}
          </InlineButton>
        </div>
      ))}
      {updateRequiredNotices.map(({ instanceId, notice }) => (
        <p key={instanceId} className="py-1 text-xs leading-snug text-muted-foreground">
          {notice}{" "}
          <InlineButton
            onClick={() => {
              onRequestClose?.();
              void navigate({ to: "/settings/providers" });
            }}
          >
            Provider settings
          </InlineButton>
        </p>
      ))}
    </div>
  );
}

// Capture gives picker shortcuts priority over the composer.
function WindowKeyDownListener({ onKeyDown }: { onKeyDown: (event: KeyboardEvent) => void }) {
  const handleKeyDown = useEffectEvent(onKeyDown);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKeyDown(event);
    window.addEventListener("keydown", listener, true);
    return () => {
      window.removeEventListener("keydown", listener, true);
    };
  }, []);
  return null;
}

export const ModelPickerContent = memo(function ModelPickerContent(props: {
  environmentId: EnvironmentId | null;
  activeInstanceId: ProviderInstanceId;
  model: string;
  selectedModels?: ReadonlyArray<{ instanceId: ProviderInstanceId; model: string }>;
  onToggleModel?: (instanceId: ProviderInstanceId, model: string) => void;
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey?: string | null;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings?: ResolvedKeybindingsConfig;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  terminalOpen: boolean;
  onRequestClose?: () => void;
  onOpenProviderSetup?: (instanceId: ProviderInstanceId) => void;
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
  /** Harp: traits of the active model, edited in place below the wheels. */
  models?: ReadonlyArray<ServerProviderModel> | undefined;
  modelOptions?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  onModelOptionsChange?:
    | ((nextOptions: ReadonlyArray<ProviderOptionSelection> | undefined) => void)
    | undefined;
  /** The owning popup moves focus here when it opens (its `initialFocus`). */
  initialFocusRef: RefObject<HTMLDivElement | null>;
}) {
  const {
    initialFocusRef,
    keybindings: providedKeybindings,
    modelOptionsByInstance,
    instanceEntries,
    getModelDisabledReason,
    onInstanceModelChange,
    onToggleModel,
    onRequestClose,
    onOpenProviderSetup,
    onModelOptionsChange,
  } = props;
  const isBasic = onModelOptionsChange === undefined;
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [browsed, setBrowsed] = useState<PickerView | null>(null);
  const [pending, setPending] = useState<{
    instanceId: ProviderInstanceId;
    slug: string;
  } | null>(null);
  const rememberedModelsRef = useRef(new Map<ProviderInstanceId, string>());
  const { favorites } = useEnvironmentModelPreferences(props.environmentId);
  const toggleFavorite = useToggleEnvironmentModelFavorite(props.environmentId);
  const serverKeybindings = useAtomValue(primaryServerKeybindingsAtom);
  const keybindings = providedKeybindings ?? serverKeybindings;
  const planModeEnabled = useClientSettings((settings) => settings.planModeEnabled);

  const activeEntry = instanceEntries.find((entry) => entry.instanceId === props.activeInstanceId);
  const activeModel = resolveModelPickerSelectedModel({
    driverKind: activeEntry?.driverKind,
    model: props.model,
    options: modelOptionsByInstance.get(props.activeInstanceId) ?? [],
  });
  const activeModelSlug =
    activeModel?.slug ?? (props.model === ANTIGRAVITY_DEFAULT_MODEL ? "" : props.model);
  const activeModelKey = activeModelSlug
    ? modelPickerModelKey(props.activeInstanceId, activeModelSlug)
    : null;
  const displayed = pending ?? { instanceId: props.activeInstanceId, slug: activeModelSlug };
  const displayedKey = displayed.slug
    ? modelPickerModelKey(displayed.instanceId, displayed.slug)
    : null;
  const selectedModelKeys = props.selectedModels?.map((selection) => {
    const entry = instanceEntries.find(
      (candidate) => candidate.instanceId === selection.instanceId,
    );
    const model = resolveModelPickerSelectedModel({
      driverKind: entry?.driverKind,
      model: selection.model,
      options: modelOptionsByInstance.get(selection.instanceId) ?? [],
    });
    return modelPickerModelKey(selection.instanceId, model?.slug ?? selection.model);
  });
  const selectedModelKeySet = new Set(
    selectedModelKeys ?? (activeModelKey ? [activeModelKey] : []),
  );
  const favoritesSet = new Set(favorites.map((fav) => providerModelKey(fav.provider, fav.model)));
  const favoritesAvailable = favorites.length > 0;
  const favoritesView = browsed === "favorites" && favoritesAvailable;
  const viewInstanceId =
    browsed !== null && browsed !== "favorites" ? browsed : displayed.instanceId;
  const isSearching = searchOpen && searchQuery.trim().length > 0;

  const activeInstanceHasSelectableUnavailableModel =
    activeEntry !== undefined &&
    (modelOptionsByInstance.get(props.activeInstanceId) ?? []).some((option) =>
      shouldIncludeModelPickerOption({
        entry: activeEntry,
        option,
        activeInstanceId: props.activeInstanceId,
        activeModel: activeModelSlug,
      }),
    ) &&
    !isProviderInstancePickerReady(activeEntry);
  const lockedProvider = props.lockedProvider;
  const lockedContinuationGroupKey = props.lockedContinuationGroupKey;
  const canOpenProviderSetup = onOpenProviderSetup !== undefined;
  const isLocked = lockedProvider !== null;
  const entryByInstanceId = new Map(instanceEntries.map((entry) => [entry.instanceId, entry]));
  const matchesLockedProvider = (
    entry: Pick<ProviderInstanceEntry, "driverKind" | "continuationGroupKey">,
  ): boolean => {
    if (lockedProvider === null) return true;
    if (entry.driverKind !== lockedProvider) return false;
    if (!lockedContinuationGroupKey) return true;
    return entry.continuationGroupKey === lockedContinuationGroupKey;
  };

  const selectableUnavailableInstanceIds = (() => {
    const instanceIds = new Set<ProviderInstanceId>();
    if (activeInstanceHasSelectableUnavailableModel) {
      instanceIds.add(props.activeInstanceId);
    }
    if (canOpenProviderSetup) {
      for (const entry of instanceEntries) {
        if (
          shouldOfferModelPickerSetup(entry, modelOptionsByInstance.get(entry.instanceId) ?? [])
        ) {
          instanceIds.add(entry.instanceId);
        }
      }
    }
    return instanceIds.size > 0 ? instanceIds : undefined;
  })();

  const flatModels = (() => {
    const out: ModelPickerItem[] = [];
    for (const [instanceId, models] of modelOptionsByInstance) {
      const entry = entryByInstanceId.get(instanceId);
      if (!entry) {
        continue;
      }
      for (const model of models) {
        if (
          !shouldIncludeModelPickerOption({
            entry,
            option: model,
            activeInstanceId: props.activeInstanceId,
            activeModel: activeModelSlug,
          })
        ) {
          continue;
        }
        out.push({
          slug: model.slug,
          name: model.name,
          ...(model.shortName ? { shortName: model.shortName } : {}),
          ...(model.subProvider ? { subProvider: model.subProvider } : {}),
          ...(model.badge ? { badge: model.badge } : {}),
          ...(model.isLegacy ? { isLegacy: true } : {}),
          ...(model.isDefault ? { isDefault: true } : {}),
          ...(model.isUnavailable ? { isUnavailable: true } : {}),
          instanceId,
          driverKind: entry.driverKind,
          instanceDisplayName: entry.displayName,
          ...(entry.accentColor ? { instanceAccentColor: entry.accentColor } : {}),
          ...(entry.acpRegistryAgentId ? { acpRegistryAgentId: entry.acpRegistryAgentId } : {}),
          ...(entry.acpRegistryIconUrl ? { acpRegistryIconUrl: entry.acpRegistryIconUrl } : {}),
          ...(entry.continuationGroupKey
            ? { continuationGroupKey: entry.continuationGroupKey }
            : {}),
        });
      }
    }
    return out;
  })();
  const lockedFlatModels = isLocked ? flatModels.filter(matchesLockedProvider) : flatModels;
  const instanceOrder = instanceEntries.map((entry) => entry.instanceId);
  const isModelFavorite = (model: ModelPickerItem) =>
    favoritesSet.has(providerModelKey(model.instanceId, model.slug));

  const lockedDisabledInstanceIds = (() => {
    if (!isLocked) {
      return undefined;
    }
    const disabled = new Set<ProviderInstanceId>();
    for (const entry of instanceEntries) {
      if (!matchesLockedProvider(entry)) {
        disabled.add(entry.instanceId);
      }
    }
    return disabled;
  })();
  const providerEntries = (() => {
    const visible = instanceEntries.filter(isProviderInstancePickerVisible);
    const withActive =
      activeEntry && !visible.includes(activeEntry) ? [...visible, activeEntry] : visible;
    if (!isLocked) {
      return withActive;
    }
    return [
      ...withActive.filter((entry) => matchesLockedProvider(entry)),
      ...withActive.filter((entry) => !matchesLockedProvider(entry)),
    ];
  })();

  const rankSearch = (query: string) =>
    rankModelPickerSearch(lockedFlatModels, query, (model) => ({
      name: model.name,
      ...(model.shortName ? { shortName: model.shortName } : {}),
      ...(model.subProvider ? { subProvider: model.subProvider } : {}),
      driverKind: model.driverKind,
      providerDisplayName: model.instanceDisplayName,
      isFavorite: isModelFavorite(model),
    }));

  const listedModels = (() => {
    if (isSearching) return rankSearch(searchQuery);
    const scoped = favoritesView
      ? lockedFlatModels.filter(
          (model) =>
            isModelFavorite(model) ||
            modelPickerModelKey(model.instanceId, model.slug) === displayedKey,
        )
      : lockedFlatModels.filter((model) => model.instanceId === viewInstanceId);
    const sorted = sortProviderModelItems(scoped, {
      favoriteModelKeys: favoritesSet,
      groupFavorites: !favoritesView,
      instanceOrder: favoritesView ? instanceOrder : [],
    });
    if (!favoritesView) {
      const isListedLegacy = (model: ModelPickerItem) =>
        model.isLegacy === true && !isModelFavorite(model);
      const ordered = [
        ...sorted.filter((model) => !isListedLegacy(model)),
        ...sorted.filter(isListedLegacy),
      ];
      const activeIsMissing =
        activeEntry !== undefined &&
        displayedKey !== null &&
        displayed.instanceId === props.activeInstanceId &&
        displayed.instanceId === viewInstanceId &&
        !ordered.some(
          (model) => modelPickerModelKey(model.instanceId, model.slug) === displayedKey,
        );
      if (activeEntry && activeIsMissing) {
        return [
          {
            slug: displayed.slug,
            name: activeModel?.name ?? displayed.slug,
            instanceId: displayed.instanceId,
            driverKind: activeEntry.driverKind,
            instanceDisplayName: activeEntry.displayName,
          },
          ...ordered,
        ];
      }
      return ordered;
    }
    return sorted;
  })();

  const selectedEntry = favoritesView ? undefined : entryByInstanceId.get(viewInstanceId);
  const providerSetupEntries =
    !isSearching && canOpenProviderSetup
      ? instanceEntries.filter(
          (entry) =>
            matchesLockedProvider(entry) &&
            shouldOfferModelPickerSetup(
              entry,
              modelOptionsByInstance.get(entry.instanceId) ?? [],
            ) &&
            (selectedEntry
              ? entry.instanceId === selectedEntry.instanceId
              : listedModels.length === 0),
        )
      : [];
  const updateRequiredNotices = instanceEntries.flatMap((entry) => {
    const shown = isSearching
      ? matchesLockedProvider(entry)
      : entry.instanceId === selectedEntry?.instanceId;
    const notice = shown ? formatProviderUpdateRequiredNotice(entry.snapshot, searchQuery) : null;
    return notice ? [{ instanceId: entry.instanceId, notice }] : [];
  });

  const modelKeyOf = (model: ModelPickerItem) => modelPickerModelKey(model.instanceId, model.slug);
  const modelJumpModelKeys = listedModels
    .filter((model) => !getModelDisabledReason?.(model.instanceId, model.slug))
    .slice(0, MODEL_PICKER_JUMP_KEYBINDING_COMMANDS.length)
    .map(modelKeyOf);
  const modelJumpLabelByKey = modelJumpLabelsByKey(
    modelJumpModelKeys,
    keybindings,
    props.terminalOpen,
  );

  const showProviderInSubtitle = isSearching || favoritesView;
  const emptyModelLabel = favoritesView
    ? "No favorites yet"
    : isSearching
      ? "No models found"
      : "No models available";
  const modelWheelItems: ReadonlyArray<WheelItem> =
    listedModels.length === 0
      ? [{ id: "empty", label: emptyModelLabel, disabled: true, muted: true }]
      : listedModels.map((model) => {
          const key = modelKeyOf(model);
          const disabledReason = getModelDisabledReason?.(model.instanceId, model.slug) ?? null;
          const jumpLabel = modelJumpLabelByKey.get(key);
          return {
            id: key,
            label: showProviderInSubtitle
              ? getDisplayModelName(model, isLocked ? undefined : { preferShortName: true })
              : stripProviderPrefix(
                  getDisplayModelName(model, isLocked ? undefined : { preferShortName: true }),
                  getProviderRowLabel(model.instanceDisplayName, model.subProvider),
                ),
            sublabel: modelSubtitle({
              slug: model.slug,
              isUnavailable: model.isUnavailable === true,
              isLegacy: model.isLegacy === true,
              isNew: model.badge === "new",
              isDefault: model.isDefault === true,
              subProvider: model.subProvider,
              providerLabel: getProviderRowLabel(model.instanceDisplayName, model.subProvider),
              showProvider: showProviderInSubtitle,
            }),
            disabled: disabledReason !== null,
            muted: model.isUnavailable === true,
            title: disabledReason ?? undefined,
            trailing:
              props.selectedModels !== undefined && selectedModelKeySet.has(key) ? (
                <CheckIcon className="size-3.5" aria-hidden="true" />
              ) : jumpLabel ? (
                <span className="opacity-0 group-hover/option:opacity-100">
                  <Kbd>{jumpLabel}</Kbd>
                </span>
              ) : null,
          };
        });
  const modelSelectedIndex =
    listedModels.length === 0
      ? 0
      : listedModels.findIndex((model) => modelKeyOf(model) === displayedKey);

  const providerWheelItems: ReadonlyArray<WheelItem> = [
    ...(favoritesAvailable
      ? [
          {
            id: "favorites",
            label: "Favorites",
            icon: <StarIcon className="size-4 fill-current text-warning" aria-hidden="true" />,
          },
        ]
      : []),
    ...providerEntries.map((entry): WheelItem => {
      const ready = isProviderInstancePickerReady(entry);
      const contextDisabled = lockedDisabledInstanceIds?.has(entry.instanceId) ?? false;
      const reachable = selectableUnavailableInstanceIds?.has(entry.instanceId) ?? false;
      return {
        id: entry.instanceId,
        label: entry.displayName,
        sublabel: providerStatusLabel({
          enabled: entry.enabled,
          installed: entry.installed,
          ready,
          status: entry.status,
          authStatus: entry.snapshot.auth.status,
          locked: contextDisabled,
        }),
        icon: (
          <ProviderInstanceIcon
            driverKind={entry.driverKind}
            displayName={entry.displayName}
            accentColor={entry.accentColor}
            acpRegistryAgentId={entry.acpRegistryAgentId}
            acpRegistryIconUrl={entry.acpRegistryIconUrl}
            showBadge={shouldShowInstanceBadge(entry, instanceEntries)}
            className="size-5"
            iconClassName="size-5"
            indicatorBackground="var(--muted)"
          />
        ),
        disabled: (!ready && !reachable) || contextDisabled,
        muted: !ready || contextDisabled,
        title: describeProviderEntry(entry, contextDisabled),
      };
    }),
  ];
  const providerSelectedId = favoritesView ? "favorites" : viewInstanceId;
  const providerSelectedIndex = Math.max(
    0,
    providerWheelItems.findIndex((item) => item.id === providerSelectedId),
  );

  const traitsVisibility = (() => {
    const activeTraitsEntry = entryByInstanceId.get(props.activeInstanceId);
    if (!props.models || !onModelOptionsChange || !activeTraitsEntry) return null;
    return getTraitsSectionVisibility({
      provider: activeTraitsEntry.driverKind,
      models: props.models,
      model: props.model,
      modelOptions: props.modelOptions,
      planModeEnabled,
    });
  })();
  const effortDescriptor = traitsVisibility
    ? findEffortDescriptor(traitsVisibility.selectDescriptors)
    : null;
  const otherSelectDescriptors =
    traitsVisibility?.selectDescriptors.filter((descriptor) => descriptor !== effortDescriptor) ??
    [];
  const booleanDescriptors = (() => {
    const all = traitsVisibility?.booleanDescriptors ?? [];
    return [
      ...all.filter((descriptor) => descriptor.id === "ultracode"),
      ...all.filter((descriptor) => descriptor.id !== "ultracode"),
    ];
  })();
  const effortWheelItems: ReadonlyArray<WheelItem> = effortDescriptor
    ? effortDescriptor.options.map((option) => ({
        id: option.id,
        label: option.label,
        title: option.description,
      }))
    : [
        {
          id: "default",
          label: "Default",
          sublabel: "No effort setting",
          disabled: true,
          muted: true,
        },
      ];
  const effortSelectedIndex = (() => {
    if (!effortDescriptor) return 0;
    const value = getDescriptorStringValue(effortDescriptor);
    const index = effortDescriptor.options.findIndex((option) => option.id === value);
    return index >= 0
      ? index
      : Math.max(
          0,
          effortDescriptor.options.findIndex((o) => o.isDefault),
        );
  })();
  const atDefaults = traitsVisibility
    ? descriptorsMatchDefaults(
        traitsVisibility.descriptors,
        getProviderOptionDescriptors({ caps: traitsVisibility.caps }),
      )
    : true;

  const handleModelSelect = (
    modelSlug: string,
    instanceId: ProviderInstanceId,
    additive = false,
  ): string | null => {
    if (getModelDisabledReason?.(instanceId, modelSlug)) {
      return null;
    }
    const options = modelOptionsByInstance.get(instanceId);
    if (!options) {
      return null;
    }
    const entry = instanceEntries.find((candidate) => candidate.instanceId === instanceId);
    if (!entry) {
      return null;
    }
    const resolvedModel = resolveSelectableModel(entry.driverKind, modelSlug, options);
    if (!resolvedModel) return null;
    if (additive && onToggleModel) {
      onToggleModel(instanceId, resolvedModel);
    } else {
      onInstanceModelChange(instanceId, resolvedModel);
    }
    return resolvedModel;
  };

  const selectModel = (instanceId: ProviderInstanceId, slug: string, additive = false): boolean => {
    if (isBasic) {
      if (getModelDisabledReason?.(instanceId, slug)) return false;
      rememberedModelsRef.current.set(instanceId, slug);
      setPending({ instanceId, slug });
    } else {
      const resolved = handleModelSelect(slug, instanceId, additive);
      if (resolved === null) return false;
      rememberedModelsRef.current.set(instanceId, resolved);
    }
    setBrowsed((current) => (current === "favorites" ? current : instanceId));
    return true;
  };

  const handleSelectProvider = (target: PickerView) => {
    if (target === "favorites") {
      const choices = sortProviderModelItems(
        lockedFlatModels.filter(
          (model) =>
            isModelFavorite(model) && !getModelDisabledReason?.(model.instanceId, model.slug),
        ),
        { favoriteModelKeys: favoritesSet, instanceOrder },
      );
      const keepsCurrent = choices.some((model) => modelKeyOf(model) === displayedKey);
      const first = choices[0];
      if (!keepsCurrent && first && !selectModel(first.instanceId, first.slug)) return;
      setBrowsed("favorites");
      return;
    }
    if (target !== displayed.instanceId) {
      const choices = lockedFlatModels.filter(
        (model) =>
          model.instanceId === target &&
          !model.isUnavailable &&
          !getModelDisabledReason?.(model.instanceId, model.slug),
      );
      const slug = pickProviderDefaultModel(choices, rememberedModelsRef.current.get(target));
      if (slug !== null && !selectModel(target, slug)) return;
    }
    setBrowsed(target);
  };

  const stepModelSelection = (direction: 1 | -1) => {
    const next = stepEnabledIndex(modelWheelItems, modelSelectedIndex, direction);
    const model = listedModels[next];
    if (model && next !== modelSelectedIndex) selectModel(model.instanceId, model.slug);
  };

  const updateDescriptors = (nextDescriptors: ReadonlyArray<ProviderOptionDescriptor>) => {
    onModelOptionsChange?.(buildProviderOptionSelectionsFromDescriptors(nextDescriptors));
  };
  const handleSelectOptionChange = (
    descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
    value: string,
  ) => {
    if (!value || !traitsVisibility) return;
    updateDescriptors(
      replaceDescriptorCurrentValue(traitsVisibility.descriptors, descriptor.id, value),
    );
  };
  const handleToggleBooleanOption = (descriptor: BooleanOptionDescriptor) => {
    if (!traitsVisibility) return;
    updateDescriptors(
      replaceDescriptorCurrentValue(
        traitsVisibility.descriptors,
        descriptor.id,
        descriptor.currentValue !== true,
      ),
    );
  };

  const activateCurrent = () => {
    if (pending) handleModelSelect(pending.slug, pending.instanceId);
    onRequestClose?.();
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    initialFocusRef.current?.focus({ preventScroll: true });
  };
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    const first = rankSearch(value).find(
      (model) => !getModelDisabledReason?.(model.instanceId, model.slug),
    );
    if (value.trim().length > 0 && first) selectModel(first.instanceId, first.slug);
  };
  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      stepModelSelection(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activateCurrent();
    }
  };

  const handleRootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    const onListbox = target instanceof HTMLElement && target.getAttribute("role") === "listbox";
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey;
    if (event.key === "Escape") {
      event.preventDefault();
      if (searchOpen && target instanceof HTMLInputElement) closeSearch();
      else onRequestClose?.();
    } else if (onListbox && plain && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      const listboxes = [
        ...event.currentTarget.querySelectorAll<HTMLElement>('[role="listbox"]'),
      ].filter((element) => element.getClientRects().length > 0);
      listboxes[listboxes.indexOf(target) + (event.key === "ArrowRight" ? 1 : -1)]?.focus({
        preventScroll: true,
      });
      event.preventDefault();
    } else if (onListbox && plain && event.key === "/") {
      event.preventDefault();
      setSearchOpen(true);
    } else if (onListbox && plain && event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey && onToggleModel && displayedKey) {
        selectModel(displayed.instanceId, displayed.slug, true);
      } else {
        activateCurrent();
      }
    } else if (
      plain &&
      !event.defaultPrevented &&
      !(target instanceof HTMLInputElement) &&
      /^[1-9]$/.test(event.key)
    ) {
      const option = effortDescriptor?.options[Number(event.key) - 1];
      if (effortDescriptor && option) {
        event.preventDefault();
        handleSelectOptionChange(effortDescriptor, option.id);
      }
    }
    event.stopPropagation();
  };

  const onWindowKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || isCommandPaletteOpen()) {
      return;
    }

    const command = resolveShortcutCommand(event, keybindings, {
      platform: navigator.platform,
      context: { terminalFocus: false, terminalOpen: props.terminalOpen, modelPickerOpen: true },
    });
    if (command === "modelPicker.previousProvider" || command === "modelPicker.nextProvider") {
      event.preventDefault();
      event.stopPropagation();
      const next = adjacentModelPickerProvider({
        entries: providerEntries,
        selectedInstanceId: providerSelectedId,
        direction: command === "modelPicker.nextProvider" ? 1 : -1,
        includeFavorites: favoritesAvailable,
        disabledInstanceIds: lockedDisabledInstanceIds,
        selectableUnavailableInstanceIds,
      });
      setSearchOpen(false);
      setSearchQuery("");
      handleSelectProvider(next);
      announce(
        next === "favorites" ? "Favorites" : (entryByInstanceId.get(next)?.displayName ?? next),
        "model-picker",
      );
      return;
    }
    const jumpIndex = modelPickerJumpIndexFromCommand(command ?? "");
    if (jumpIndex === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const targetModelKey = modelJumpModelKeys[jumpIndex];
    if (!targetModelKey) {
      return;
    }
    const model = parseModelPickerModelKey(targetModelKey);
    if (!model) {
      return;
    }
    if (!selectModel(model.instanceId, model.slug)) return;
    const name = flatModels.find(
      (item) => item.slug === model.slug && item.instanceId === model.instanceId,
    )?.name;
    announce(`Model: ${name ?? model.slug}`, "model-picker");
  };

  const isFavoriteDisplayed =
    displayed.slug !== "" &&
    favoritesSet.has(providerModelKey(displayed.instanceId, displayed.slug));
  const modelHeaderActions = (
    <div className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={isFavoriteDisplayed ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={isFavoriteDisplayed}
              disabled={displayed.slug === ""}
              onClick={() => toggleFavorite(displayed.instanceId, displayed.slug)}
            >
              <StarIcon className={cn(isFavoriteDisplayed && "fill-current text-warning")} />
            </Button>
          }
        />
        <TooltipPopup side="top">
          {isFavoriteDisplayed ? "Remove from favorites" : "Add to favorites"}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={searchOpen ? "Close search" : "Search models"}
              aria-pressed={searchOpen}
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            >
              {searchOpen ? <XIcon /> : <SearchIcon />}
            </Button>
          }
        />
        <TooltipPopup side="top">{searchOpen ? "Close search" : "Search models (/)"}</TooltipPopup>
      </Tooltip>
    </div>
  );

  const hint = isBasic
    ? "Scroll or use arrow keys · Enter to choose"
    : onToggleModel
      ? "Scroll or use arrow keys · Shift-click adds models"
      : "Scroll or use arrow keys";

  return (
    <TooltipProvider delay={0}>
      <WindowKeyDownListener onKeyDown={onWindowKeyDown} />
      <div
        role="group"
        aria-label="Model and reasoning"
        data-model-picker-content="true"
        className="@container/picker relative flex w-[min(44rem,calc(100vw-0.75rem))] flex-col [--wheel-head:2rem] [--wheel-item:3.5rem]"
        onKeyDown={handleRootKeyDown}
      >
        <div className="flex h-13 items-center justify-between gap-2 px-4">
          <h2 className="text-base font-semibold text-foreground">
            {isBasic ? "Model" : "Model & reasoning"}
          </h2>
          {isBasic ? null : (
            <InlineButton
              tone="brand"
              disabled={atDefaults}
              onClick={() => onModelOptionsChange?.(undefined)}
            >
              Reset
            </InlineButton>
          )}
        </div>
        <div className="px-4 pb-4">
          <div
            className={cn(
              "relative isolate grid grid-cols-3 gap-2 @max-[31rem]/picker:grid-cols-2",
              isBasic && "grid-cols-2",
            )}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-x-1 top-[calc(var(--wheel-head)+var(--wheel-item)*2)] z-10 h-(--wheel-item) rounded-xl border border-brand/70 bg-linear-to-b from-brand/60 to-brand/40 shadow-lg shadow-brand/25 @max-[31rem]/picker:hidden"
            />
            <WheelColumn
              label="Provider"
              items={providerWheelItems}
              selectedIndex={providerSelectedIndex}
              onSelect={(index) => {
                const item = providerWheelItems[index];
                if (item) handleSelectProvider(item.id as PickerView);
              }}
            />
            <WheelColumn
              label="Model"
              items={modelWheelItems}
              selectedIndex={modelSelectedIndex}
              listboxRef={initialFocusRef}
              headerSlot={
                searchOpen ? (
                  <input
                    autoFocus
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Search models"
                    placeholder="Search models…"
                    value={searchQuery}
                    className="h-6 w-full min-w-0 bg-transparent pe-12 ps-1 text-xs text-foreground outline-none placeholder:text-muted-foreground"
                    onChange={(event) => handleSearchChange(event.target.value)}
                    onKeyDown={handleSearchKeyDown}
                  />
                ) : undefined
              }
              headerAction={modelHeaderActions}
              onSelect={(index, { shiftKey }) => {
                const model = listedModels[index];
                if (model)
                  selectModel(
                    model.instanceId,
                    model.slug,
                    shiftKey && onToggleModel !== undefined,
                  );
              }}
              onActivate={(index) => {
                const model = listedModels[index];
                if (isBasic && model) handleModelSelect(model.slug, model.instanceId);
                onRequestClose?.();
              }}
            />
            {isBasic ? null : (
              <WheelColumn
                label="Reasoning effort"
                className="@max-[31rem]/picker:hidden"
                items={effortWheelItems}
                selectedIndex={effortSelectedIndex}
                onSelect={(index) => {
                  const option = effortDescriptor?.options[index];
                  if (effortDescriptor && option)
                    handleSelectOptionChange(effortDescriptor, option.id);
                }}
                onActivate={() => onRequestClose?.()}
              />
            )}
          </div>
        </div>
        <ModelPickerProviderNotices
          setupEntries={providerSetupEntries}
          updateRequiredNotices={updateRequiredNotices}
          onRequestClose={onRequestClose}
          onOpenProviderSetup={onOpenProviderSetup}
        />
        {isBasic ? null : (
          <ModelPickerOptions
            booleans={booleanDescriptors}
            selects={otherSelectDescriptors}
            compactEffort={effortDescriptor}
            emptyLabel="No other options for this model"
            onToggle={handleToggleBooleanOption}
            onSelect={handleSelectOptionChange}
          />
        )}
        <div className="flex min-h-9 items-center justify-between gap-3 border-t border-border/50 px-4 py-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{hint}</span>
          {isBasic ? (
            <Button size="xs" onClick={activateCurrent}>
              Select
            </Button>
          ) : (
            <span className="flex shrink-0 items-center gap-1.5 @max-[31rem]/picker:hidden">
              <Kbd>Esc</Kbd>
              to close
            </span>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
});
