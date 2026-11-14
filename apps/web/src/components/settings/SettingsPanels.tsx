import { NotificationSettings } from "./NotificationSettings";
import { SnoozePresetsRow } from "./SnoozePresetsSettings";
import { SnapShotSettings } from "./SnapShotSettings";
import { CheckIcon } from "lucide-react";
import { msg, T, useGT, useMessages } from "gt-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  AgentPreset as AgentPresetSchema,
  type AgentPreset,
  type ModelSelection,
  type DesktopUpdateChannel,
  IDLE_COMPACTION_MODES,
  globalIdleCompaction,
  ProviderDriverKind,
  type ProviderInstanceId,
  type SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import {
  DEFAULT_UNIFIED_SETTINGS,
  type DiffLayout,
  type DiffPresentation,
  MAX_HARNESS_SOUND_VOLUME,
  MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MIN_HARNESS_SOUND_VOLUME,
  MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  type ResponseStreamingMode,
  type QuitConfirmationMode,
  SidebarProjectSortOrder,
  ScreenReaderAnnouncements,
  ToolCallVisibility,
  type UnifiedSettings,
} from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import { useThrottledRange } from "../../hooks/useThrottledRange";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { APP_VERSION, HOSTED_APP_CHANNEL, HOSTED_APP_CHANNEL_LABEL } from "../../branding";
import { openWhatsNew } from "../WhatsNewDialog";
import { CliCommandSettingsRow } from "./CliCommandSettingsRow";
import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateCheckError,
  getDesktopUpdateDisabledReason,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../../components/desktopUpdate.logic";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { isElectron } from "../../env";
import {
  buildHostedChannelSelectionUrl,
  configuredHostedAppUrl,
  type HostedAppChannel,
} from "../../hostedPairing";
import {
  readAppearanceModePreference,
  readThemeHalves,
  readThemePreference,
  useTheme,
} from "../../hooks/useTheme";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useSettingsScope } from "./SettingsScopeContext";
import { scopedIdleCompaction } from "./scopedSettings";
import { ProjectDefaultsSettings } from "./ProjectDefaultsSettings";
import { ThreadTitleInstructionsSettings } from "./ThreadTitleInstructionsSettings";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import {
  getCustomModelOptionsByInstance,
  getTextGenerationModelOptionsByInstance,
  resolveAppModelSelectionState,
  selectsPlanAgent,
} from "../../modelSelection";
import { useTextGenerationTargets } from "../../textGenerators";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import { isMacPlatform, randomUUID } from "../../lib/utils";
import { useEnvironmentProviders, usePrimaryEnvironmentId } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { ScopedSwitch } from "./ScopedSwitch";
import { filterImageViewerModelOptions, providerCanViewImages } from "./ImageViewerSettings.logic";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  autoSettleDaysField,
  cancelAutoSettleDaysField,
  commitAutoSettleDaysField,
  editAutoSettleDaysField,
  failAutoSettleDaysField,
  getChangedBrowserSettingLabels,
  getChangedTypographySettingLabels,
  hasChangedBackgroundActivitySettings,
  isProjectGroupingEnabled,
  projectGroupingModeFromToggle,
  readLastEnabledProjectGroupingMode,
  rememberEnabledProjectGroupingMode,
  syncAutoSettleDaysField,
} from "./SettingsPanels.logic";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  SettingsSlider,
} from "./settingsLayout";
import { searchableSetting, type SettingsSearchItemId } from "./settingsSearch";
import { nativeLanguageName, SYSTEM_LANGUAGE } from "@t3tools/client-runtime/locales";
import { SUPPORTED_LOCALES } from "../../i18n/locales";
import { BackgroundActivitySettingsRow } from "./BackgroundActivitySettings";
import { useCheckProviderUpdates } from "../ProviderUpdatesAction";
import { downloadLocalUpdate } from "../sidebar/SidebarUpdatePill";

const RESPONSE_STREAMING_MODE_LABELS: Record<ResponseStreamingMode, string> = {
  turn: "Wait for the full response",
  paragraph: "Show finished paragraphs",
};

const RESPONSE_STREAMING_MODE_DESCRIPTIONS: Record<ResponseStreamingMode, string> = {
  turn: "Text appears once the agent finishes its turn.",
  paragraph: "Each paragraph or code block appears as soon as it is complete.",
};

const SIDEBAR_PROJECT_SORT_ORDER_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: msg("Last user message"),
  created_at: msg("Created at"),
  manual: msg("Manual"),
};
const isSidebarProjectSortOrder = Schema.is(SidebarProjectSortOrder);

const TIMESTAMP_FORMAT_LABELS = {
  locale: msg("System default"),
  "12-hour": msg("12-hour"),
  "24-hour": msg("24-hour"),
};

const DIFF_LAYOUT_LABELS: Record<DiffLayout, string> = {
  stacked: "Stacked",
  split: "Split",
};

const DIFF_PRESENTATION_LABELS: Record<DiffPresentation, string> = {
  summary: "Changed files summary",
  inline: "Inline code diff",
  panel: "Open in diff panel",
};

const QUIT_CONFIRMATION_MODE_LABELS: Record<QuitConfirmationMode, string> = {
  direct: msg("Direct"),
  hold: msg("Hold"),
  "double-click": msg("Double press"),
};

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
const decodeAgentPreset = Schema.decodeSync(AgentPresetSchema);

function AgentPresetsSettings(props: {
  readonly settings: UnifiedSettings;
  readonly currentSelection: ModelSelection;
  readonly updateSettings: (patch: { agentPresets: ReadonlyArray<AgentPreset> }) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AgentPreset["kind"]>("custom");
  const [interactionMode, setInteractionMode] = useState<AgentPreset["interactionMode"]>("default");
  const savePreset = () => {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) return;
    const preset = decodeAgentPreset({
      id: randomUUID(),
      name: trimmedName,
      kind,
      modelSelection: props.currentSelection,
      interactionMode,
      skills: [],
    });
    props.updateSettings({ agentPresets: [...props.settings.agentPresets, preset] });
    setName("");
  };

  return (
    <SettingsRow
      serverScoped
      settingKeys={["agentPresets"]}
      title="Workflow presets"
      description="Save a named model and effort workflow, then apply it from the composer before the next turn."
    >
      <div className="mt-3 space-y-2 pb-3.5">
        <div className="flex flex-wrap gap-1.5">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                savePreset();
              }
            }}
            placeholder="Preset name"
            aria-label="Workflow preset name"
            className="min-w-40 flex-1"
          />
          <Select value={kind} onValueChange={(value) => setKind(value as AgentPreset["kind"])}>
            <SelectTrigger className="w-28" aria-label="Workflow preset type">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="coding">Coding</SelectItem>
              <SelectItem value="review">Review</SelectItem>
              <SelectItem value="research">Research</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectPopup>
          </Select>
          <Select
            value={interactionMode}
            onValueChange={(value) => setInteractionMode(value as AgentPreset["interactionMode"])}
          >
            <SelectTrigger className="w-28" aria-label="Workflow preset mode">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="default">Default</SelectItem>
              <SelectItem value="plan">Plan</SelectItem>
            </SelectPopup>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={savePreset}
            disabled={!name.trim()}
          >
            Save current
          </Button>
        </div>
        {props.settings.agentPresets.length > 0 ? (
          <div className="divide-y divide-border/60 rounded-md border border-border">
            {props.settings.agentPresets.map((preset) => (
              <div key={preset.id} className="flex items-center gap-2 px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{preset.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {preset.kind} · {preset.modelSelection.model}
                  </div>
                </div>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    props.updateSettings({
                      agentPresets: props.settings.agentPresets.filter(
                        (candidate) => candidate.id !== preset.id,
                      ),
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </SettingsRow>
  );
}

function AboutVersionTitle() {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span>Version</span>
      <code className="text-2xs font-medium text-muted-foreground">{APP_VERSION}</code>
    </span>
  );
}

function AboutVersionSection() {
  const updateState = useDesktopUpdateState();
  const [isChangingUpdateChannel, setIsChangingUpdateChannel] = useState(false);
  const [isUpdateActionPending, setIsUpdateActionPending] = useState(false);
  const checkProviderUpdates = useCheckProviderUpdates();

  const hasDesktopBridge = typeof window !== "undefined" && Boolean(window.desktopBridge);
  const selectedUpdateChannel = updateState?.channel ?? "latest";
  const selectedHostedAppChannel =
    hasDesktopBridge || configuredHostedAppUrl() === "" ? null : HOSTED_APP_CHANNEL;

  const handleUpdateChannelChange = (channel: DesktopUpdateChannel) => {
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.setUpdateChannel !== "function" ||
      channel === selectedUpdateChannel
    ) {
      return;
    }

    setIsChangingUpdateChannel(true);
    void bridge
      .setUpdateChannel(channel)
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not change update track",
            description: error instanceof Error ? error.message : "Update track change failed.",
          }),
        );
      })
      .finally(() => {
        setIsChangingUpdateChannel(false);
      });
  };

  const handleButtonClick = async () => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";

    if (action === "download") {
      void downloadLocalUpdate(bridge, { notifyDownloaded: false });
      return;
    }

    if (action === "install") {
      if (isUpdateActionPending) return;
      setIsUpdateActionPending(true);
      let confirmed = false;
      try {
        confirmed = await ensureLocalApi().dialogs.confirm(
          getDesktopUpdateInstallConfirmationMessage(
            updateState ?? { availableVersion: null, downloadedVersion: null },
          ),
        );
      } catch (error) {
        setIsUpdateActionPending(false);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not confirm update",
            description: error instanceof Error ? error.message : "Update confirmation failed.",
          }),
        );
        return;
      }
      if (!confirmed) {
        setIsUpdateActionPending(false);
        return;
      }
      void bridge
        .installUpdate()
        .catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not install update",
              description: error instanceof Error ? error.message : "Install failed.",
            }),
          );
        })
        .finally(() => setIsUpdateActionPending(false));
      return;
    }

    if (typeof bridge.checkForUpdate !== "function") return;
    void checkProviderUpdates();
    void bridge
      .checkForUpdate()
      .then((result) => {
        if (!result.checked || getDesktopUpdateCheckError(result.state) !== null) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not check for updates",
              description:
                result.state.message ?? "Automatic updates are not available in this build.",
            }),
          );
        }
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not check for updates",
            description: error instanceof Error ? error.message : "Update check failed.",
          }),
        );
      });
  };

  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState) : null;
  const buttonDisabled =
    action === "none"
      ? !canCheckForUpdate(updateState)
      : isDesktopUpdateButtonDisabled(updateState);

  const actionLabel: Record<string, string> = { download: "Download", install: "Install" };
  const statusLabel: Record<string, string> = {
    checking: "Checking…",
    downloading: "Downloading…",
    "up-to-date": "Up to Date",
  };
  const buttonLabel =
    actionLabel[action] ?? statusLabel[updateState?.status ?? ""] ?? "Check for Updates";
  const description =
    action === "download" || action === "install"
      ? "Update available."
      : (getDesktopUpdateDisabledReason(updateState) ??
        (updateState && getDesktopUpdateCheckError(updateState)) ??
        "Current version of the application.");

  return (
    <>
      <SettingsRow
        id={searchableSetting("app-version").id}
        title={<AboutVersionTitle />}
        description={description}
        control={
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={buttonDisabled || isUpdateActionPending}
                  onClick={handleButtonClick}
                >
                  {buttonLabel}
                </Button>
              }
            />
            {buttonTooltip ? <TooltipPopup>{buttonTooltip}</TooltipPopup> : null}
          </Tooltip>
        }
      />
      <SettingsRow
        {...searchableSetting("whats-new")}
        description="See what changed in each Harp release."
        control={
          <Button size="sm" variant="outline" onClick={() => openWhatsNew()}>
            Show
          </Button>
        }
      />
      {hasDesktopBridge ? (
        <SettingsRow
          {...searchableSetting("update-track")}
          description="Use stable releases or nightly builds. Switch back anytime."
          control={
            <Select
              value={selectedUpdateChannel}
              onValueChange={(value) => {
                handleUpdateChannelChange(value as DesktopUpdateChannel);
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label="Update track"
                disabled={isChangingUpdateChannel}
              >
                <SelectValue>
                  {selectedUpdateChannel === "nightly" ? "Nightly" : "Stable"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  Stable
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  Nightly
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : selectedHostedAppChannel ? (
        <SettingsRow
          {...searchableSetting("update-track")}
          description="Switches the hosted app release channel."
          control={
            <Select
              value={selectedHostedAppChannel}
              onValueChange={(value) => {
                if (value === selectedHostedAppChannel) return;
                const url = buildHostedChannelSelectionUrl({ channel: value as HostedAppChannel });
                if (url !== null) window.location.assign(url);
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Update track">
                <SelectValue>{HOSTED_APP_CHANNEL_LABEL}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  Latest
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  Nightly
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
      {hasDesktopBridge ? <CliCommandSettingsRow /> : null}
    </>
  );
}

export function useSettingsRestore(onRestored?: () => void) {
  const {
    theme,
    setTheme,
    followSystem,
    setFollowSystem,
    setThemeHalf,
    clearThemeHalves,
    themeHalves,
  } = useTheme();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const isImageViewerDirty =
    settings.imageViewerEnabled !== DEFAULT_UNIFIED_SETTINGS.imageViewerEnabled ||
    !Equal.equals(
      settings.imageViewerModelSelection ?? null,
      DEFAULT_UNIFIED_SETTINGS.imageViewerModelSelection ?? null,
    );
  const isBackgroundActivityDirty = hasChangedBackgroundActivitySettings(settings);

  const changedSettingLabels = [
    ...(theme !== "system" ? ["Theme"] : []),
    ...(!followSystem ? ["Follow system"] : []),
    ...(themeHalves !== null ? ["Theme mix"] : []),
    ...(settings.glassSidebarEnabled !== DEFAULT_UNIFIED_SETTINGS.glassSidebarEnabled
      ? ["Glass sidebar"]
      : []),
    ...(settings.sidebarHeaderArtStyle !== DEFAULT_UNIFIED_SETTINGS.sidebarHeaderArtStyle
      ? ["Sidebar header art"]
      : []),
    ...(settings.sidebarHeaderArtColor !== DEFAULT_UNIFIED_SETTINGS.sidebarHeaderArtColor
      ? ["Sidebar header art color"]
      : []),
    ...(settings.appearanceContrast !== DEFAULT_UNIFIED_SETTINGS.appearanceContrast
      ? ["Contrast"]
      : []),
    ...(settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? ["Glass opacity"] : []),
    ...(settings.diffColorScheme !== DEFAULT_UNIFIED_SETTINGS.diffColorScheme
      ? ["Diff colors"]
      : []),
    ...(settings.chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth ? ["Chat width"] : []),
    ...(settings.mathRenderingEnabled !== DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled
      ? ["Render math"]
      : []),
    ...(settings.scrollbarSize !== DEFAULT_UNIFIED_SETTINGS.scrollbarSize
      ? ["Scrollbar size"]
      : []),
    ...(settings.panelAnimationDurationMs !== DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs
      ? ["Panel animations"]
      : []),
    ...(settings.interfaceAnimationsEnabled !== DEFAULT_UNIFIED_SETTINGS.interfaceAnimationsEnabled
      ? ["Interface animations"]
      : []),
    ...(settings.environmentIdentificationMode !==
    DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode
      ? ["Environment identification"]
      : []),
    ...(settings.language !== DEFAULT_UNIFIED_SETTINGS.language ? ["Language"] : []),
    ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
      ? ["Time format"]
      : []),
    ...(settings.notificationMode !== DEFAULT_UNIFIED_SETTINGS.notificationMode
      ? ["Thread notifications"]
      : []),
    ...(settings.harnessSoundVolume !== DEFAULT_UNIFIED_SETTINGS.harnessSoundVolume
      ? ["Sound volume"]
      : []),
    ...(settings.inAppNotificationsEnabled !== DEFAULT_UNIFIED_SETTINGS.inAppNotificationsEnabled
      ? ["In-app notifications"]
      : []),
    ...(settings.sidebarThreadPreviewCount !== DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount
      ? ["Visible threads"]
      : []),
    ...(settings.sidebarProjectGroupingMode !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode
      ? ["Project Grouping"]
      : []),
    ...(settings.sidebarProjectSortOrder !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder
      ? ["Project order"]
      : []),
    ...(settings.sidebarAutoSettleAfterDays !== DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays
      ? ["Auto-settle inactive threads"]
      : []),
    ...(settings.sidebarAutoSettleKeepPullRequests !==
    DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleKeepPullRequests
      ? ["Keep threads with a PR"]
      : []),
    ...(settings.sidebarAutoSettleOnMerge !== DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge
      ? ["Auto-settle merged threads"]
      : []),
    ...(settings.autoResumeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads
      ? ["Resume after usage limits"]
      : []),
    ...(settings.snoozeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads
      ? ["Snooze until limits reset"]
      : []),
    ...(settings.wordWrap !== DEFAULT_UNIFIED_SETTINGS.wordWrap ? ["Word wrap"] : []),
    ...(settings.persistComposerContextStrip !==
    DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip
      ? ["Composer context"]
      : []),
    ...getChangedTypographySettingLabels(settings),
    ...(settings.diffFilesCollapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed
      ? ["Default diff file state"]
      : []),
    ...(settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
      ? ["Diff whitespace changes"]
      : []),
    ...(settings.diffLayout !== DEFAULT_UNIFIED_SETTINGS.diffLayout ? ["Diff layout"] : []),
    ...(settings.diffPresentation !== DEFAULT_UNIFIED_SETTINGS.diffPresentation
      ? ["Diff presentation"]
      : []),
    ...(settings.proactivePanelsEnabled !== DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled
      ? ["Proactive panels"]
      : []),
    ...(settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu
      ? ["Show skills in slash menu"]
      : []),
    ...(settings.composerCollapseOnScroll !== DEFAULT_UNIFIED_SETTINGS.composerCollapseOnScroll
      ? ["Collapse composer on scroll"]
      : []),
    ...(settings.composerRichTextEnabled !== DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled
      ? ["Rich text composer"]
      : []),
    ...(settings.voiceLivePreviewEnabled !== DEFAULT_UNIFIED_SETTINGS.voiceLivePreviewEnabled
      ? ["Live transcription preview"]
      : []),
    ...(settings.sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut ? ["Send shortcut"] : []),
    ...(settings.followUpBehavior !== DEFAULT_UNIFIED_SETTINGS.followUpBehavior
      ? ["Follow-up behavior"]
      : []),
    ...(settings.suggestNextPrompt !== DEFAULT_UNIFIED_SETTINGS.suggestNextPrompt
      ? ["Suggest the next prompt"]
      : []),
    ...(settings.suggestNextPromptOtherProviders !==
    DEFAULT_UNIFIED_SETTINGS.suggestNextPromptOtherProviders
      ? ["Suggest for other providers"]
      : []),
    ...(settings.toolCallVisibility !== DEFAULT_UNIFIED_SETTINGS.toolCallVisibility
      ? ["Tool calls in chat"]
      : []),
    ...(settings.screenReaderAnnouncements !== DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements
      ? ["Screen reader announcements"]
      : []),
    ...(settings.screenReaderWindowTitle !== DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle
      ? ["Screen reader window title"]
      : []),
    ...(settings.responseStreamingMode !== DEFAULT_UNIFIED_SETTINGS.responseStreamingMode
      ? ["Response streaming"]
      : []),
    ...(settings.enableProviderUpdateChecks !== DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks
      ? ["Provider update checks"]
      : []),
    ...(settings.continueThreadsAfterServerUpdate !==
    DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate
      ? ["Continue threads after restarts"]
      : []),
    ...(isBackgroundActivityDirty ? ["Background activity"] : []),
    ...(settings.keepAwakeWhileAgentsWork !== DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork
      ? ["Keep awake while agents work"]
      : []),
    ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
      ? ["New thread mode"]
      : []),
    ...(settings.newWorktreesStartFromOrigin !==
    DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin
      ? ["New worktrees start from remote"]
      : []),
    ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
      ? ["Add project base directory"]
      : []),
    ...(settings.ghqCloneLayout !== DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout
      ? ["Clone into host folders"]
      : []),
    ...(settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin
      ? ["Unpin confirmation"]
      : []),
    ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
      ? ["Archive confirmation"]
      : []),
    ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
      ? ["Delete confirmation"]
      : []),
    ...(settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit ? ["Quit shortcut"] : []),
    ...(isTextGenerationModelDirty ? ["Text generation model"] : []),
    ...(isImageViewerDirty ? ["Image viewer"] : []),
    ...(settings.threadTitleInstructions !== DEFAULT_UNIFIED_SETTINGS.threadTitleInstructions
      ? ["Thread title instructions"]
      : []),
    ...getChangedBrowserSettingLabels(settings),
    ...(settings.enableAgentBrowserAccess !== DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess
      ? ["Agent browser access"]
      : []),
  ];

  const restoreDefaults = async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      ["Restore default settings?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
        "\n",
      ),
      { variant: "destructive", confirmLabel: "Restore" },
    );
    if (!confirmed) return;

    // Reset only dirty theme keys so storage failures cannot block other settings; re-read after confirmation
    // for safe rollback.
    let previousTheme = theme;
    try {
      previousTheme = readThemePreference();
    } catch {}
    const liveHalves = readThemeHalves();
    const needsThemeReset = previousTheme !== "system";
    const needsMixReset = liveHalves !== null;
    const needsFollowSystemReset = readAppearanceModePreference(previousTheme) !== "system";
    const notifyThemeRestoreFailure = () => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Couldn’t restore theme settings",
          description: "Try again.",
        }),
      );
    };
    // Restore the base preference before the mix because restoring the base clears the mix.
    const previousHalves = liveHalves;
    const rollbackThemeState = () => {
      if (needsThemeReset) setTheme(previousTheme);
      if (previousHalves?.light) setThemeHalf("light", previousHalves.light);
      if (previousHalves?.dark) setThemeHalf("dark", previousHalves.dark);
    };
    if (needsThemeReset && !setTheme("system")) {
      notifyThemeRestoreFailure();
      return;
    }
    if (needsMixReset && !clearThemeHalves()) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    if (needsFollowSystemReset && !setFollowSystem(true)) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    updateSettings({
      appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast,
      diffColorScheme: DEFAULT_UNIFIED_SETTINGS.diffColorScheme,
      chatWidth: DEFAULT_UNIFIED_SETTINGS.chatWidth,
      mathRenderingEnabled: DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled,
      scrollbarSize: DEFAULT_UNIFIED_SETTINGS.scrollbarSize,
      language: DEFAULT_UNIFIED_SETTINGS.language,
      timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
      notificationMode: DEFAULT_UNIFIED_SETTINGS.notificationMode,
      harnessSoundVolume: DEFAULT_UNIFIED_SETTINGS.harnessSoundVolume,
      inAppNotificationsEnabled: DEFAULT_UNIFIED_SETTINGS.inAppNotificationsEnabled,
      wordWrap: DEFAULT_UNIFIED_SETTINGS.wordWrap,
      persistComposerContextStrip: DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip,
      diffFilesCollapsed: DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed,
      diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
      diffLayout: DEFAULT_UNIFIED_SETTINGS.diffLayout,
      diffPresentation: DEFAULT_UNIFIED_SETTINGS.diffPresentation,
      proactivePanelsEnabled: DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled,
      showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
      composerCollapseOnScroll: DEFAULT_UNIFIED_SETTINGS.composerCollapseOnScroll,
      composerRichTextEnabled: DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled,
      voiceLivePreviewEnabled: DEFAULT_UNIFIED_SETTINGS.voiceLivePreviewEnabled,
      sendShortcut: DEFAULT_UNIFIED_SETTINGS.sendShortcut,
      followUpBehavior: DEFAULT_UNIFIED_SETTINGS.followUpBehavior,
      suggestNextPrompt: DEFAULT_UNIFIED_SETTINGS.suggestNextPrompt,
      suggestNextPromptOtherProviders: DEFAULT_UNIFIED_SETTINGS.suggestNextPromptOtherProviders,
      toolCallVisibility: DEFAULT_UNIFIED_SETTINGS.toolCallVisibility,
      screenReaderAnnouncements: DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements,
      screenReaderWindowTitle: DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle,
      environmentIdentificationMode: DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode,
      glassSidebarEnabled: DEFAULT_UNIFIED_SETTINGS.glassSidebarEnabled,
      sidebarHeaderArtStyle: DEFAULT_UNIFIED_SETTINGS.sidebarHeaderArtStyle,
      sidebarHeaderArtColor: DEFAULT_UNIFIED_SETTINGS.sidebarHeaderArtColor,
      glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity,
      panelAnimationDurationMs: DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs,
      interfaceAnimationsEnabled: DEFAULT_UNIFIED_SETTINGS.interfaceAnimationsEnabled,
      sidebarThreadPreviewCount: DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount,
      sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
      sidebarProjectSortOrder: DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder,
      sidebarAutoSettleAfterDays: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays,
      sidebarAutoSettleKeepPullRequests: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleKeepPullRequests,
      sidebarAutoSettleOnMerge: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge,
      autoResumeLimitedThreads: DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads,
      snoozeLimitedThreads: DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads,
      responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
      enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
      continueThreadsAfterServerUpdate: DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
      backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
      keepAwakeWhileAgentsWork: DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork,
      backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
      automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
      providerHealthRefreshInterval: DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
      defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
      newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
      addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
      ghqCloneLayout: DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout,
      confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
      confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
      confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
      confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit,
      textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
      imageViewerEnabled: DEFAULT_UNIFIED_SETTINGS.imageViewerEnabled,
      imageViewerModelSelection: DEFAULT_UNIFIED_SETTINGS.imageViewerModelSelection,
      contextCompactorModelSelection: DEFAULT_UNIFIED_SETTINGS.contextCompactorModelSelection,
      skillCuratorModelSelection: DEFAULT_UNIFIED_SETTINGS.skillCuratorModelSelection,
      memoryCuratorModelSelection: DEFAULT_UNIFIED_SETTINGS.memoryCuratorModelSelection,
      delegationDefaultModelSelection: DEFAULT_UNIFIED_SETTINGS.delegationDefaultModelSelection,
      threadTitleInstructions: DEFAULT_UNIFIED_SETTINGS.threadTitleInstructions,
      fontFamilySans: DEFAULT_UNIFIED_SETTINGS.fontFamilySans,
      fontFamilyComposer: DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer,
      fontFamilyCode: DEFAULT_UNIFIED_SETTINGS.fontFamilyCode,
      fontFamilyTerminal: DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal,
      fontSizeInterface: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
      fontSizePrompt: DEFAULT_UNIFIED_SETTINGS.fontSizePrompt,
      fontSizeCode: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
      fontSizeTerminal: DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal,
      browserDefaultViewport: DEFAULT_UNIFIED_SETTINGS.browserDefaultViewport,
      browserDefaultZoomFactor: DEFAULT_UNIFIED_SETTINGS.browserDefaultZoomFactor,
      browserDefaultAppearance: DEFAULT_UNIFIED_SETTINGS.browserDefaultAppearance,
      browserRecordingFrameRate: DEFAULT_UNIFIED_SETTINGS.browserRecordingFrameRate,
      browserRecordingShowKeyPresses: DEFAULT_UNIFIED_SETTINGS.browserRecordingShowKeyPresses,
      browserRecordingShowMousePresses: DEFAULT_UNIFIED_SETTINGS.browserRecordingShowMousePresses,
      browserLinkTarget: DEFAULT_UNIFIED_SETTINGS.browserLinkTarget,
      browserSearchEngine: DEFAULT_UNIFIED_SETTINGS.browserSearchEngine,
      browserCustomSearchUrl: DEFAULT_UNIFIED_SETTINGS.browserCustomSearchUrl,
      browserAutoShowFloatingPreview: DEFAULT_UNIFIED_SETTINGS.browserAutoShowFloatingPreview,
      pullRequestLinksOpenInApp: DEFAULT_UNIFIED_SETTINGS.pullRequestLinksOpenInApp,
      enableAgentBrowserAccess: DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess,
    });
    onRestored?.();
  };

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

const AUTO_SETTLE_DEFAULT_DAYS = DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays ?? 7;

function AutoSettleDaysInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (days: number, options: { onFailed: () => void }) => void;
}) {
  const [stored, setField] = useState(() => autoSettleDaysField(value));
  const field = syncAutoSettleDaysField(stored, value);
  if (field !== stored) setField(field);

  const commit = () => {
    const next = commitAutoSettleDaysField(field);
    setField(next.field);
    if (next.submit === null) return;
    const { revision } = next.field;
    onCommit(next.submit, {
      onFailed: () => setField((current) => failAutoSettleDaysField(current, revision)),
    });
  };

  return (
    <Input
      size="sm"
      type="number"
      min={MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS}
      max={MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS}
      className="w-full sm:w-24"
      value={field.draft}
      onChange={(event) => setField(editAutoSettleDaysField(field, event.target.value))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") commit();
        if (event.key === "Escape" && field.dirty) {
          // An unhandled Escape closes the settings page, and the blur that follows would save.
          event.preventDefault();
          event.stopPropagation();
          setField(cancelAutoSettleDaysField(field));
        }
      }}
      aria-label="Days of inactivity before auto-settle"
    />
  );
}

/** Row anchor props with the registry title in the active language. */
function useTranslatedSearchableSetting() {
  const m = useMessages();
  return (id: SettingsSearchItemId) => {
    const setting = searchableSetting(id);
    return { ...setting, title: m(setting.title) };
  };
}

const TOOL_CALL_VISIBILITY_LABELS: Record<ToolCallVisibility, string> = {
  showAll: "Show all",
  hideSuccessful: "Hide successful",
  hideAll: "Hide all",
  zen: "Zen",
};

const isToolCallVisibility = Schema.is(ToolCallVisibility);

function ToolCallVisibilityRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("tool-call-visibility")}
      description="Hide the commands, edits, and searches agents run. Hide successful keeps failures. Zen shows only final answers. Approvals, questions, and errors always show."
      resetAction={
        settings.toolCallVisibility !== DEFAULT_UNIFIED_SETTINGS.toolCallVisibility ? (
          <SettingResetButton
            label="tool calls in chat"
            onClick={() =>
              updateSettings({ toolCallVisibility: DEFAULT_UNIFIED_SETTINGS.toolCallVisibility })
            }
          />
        ) : null
      }
      control={
        <Select
          value={settings.toolCallVisibility}
          onValueChange={(value) => {
            if (isToolCallVisibility(value)) updateSettings({ toolCallVisibility: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Tool calls in chat">
            <SelectValue>{TOOL_CALL_VISIBILITY_LABELS[settings.toolCallVisibility]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {ToolCallVisibility.literals.map((value) => (
              <SelectItem key={value} value={value}>
                {TOOL_CALL_VISIBILITY_LABELS[value]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

const SCREEN_READER_ANNOUNCEMENTS_LABELS: Record<ScreenReaderAnnouncements, string> = {
  status: "Status only",
  messages: "Status and messages",
  everything: "Everything",
};

const isScreenReaderAnnouncements = Schema.is(ScreenReaderAnnouncements);

function ScreenReaderAnnouncementsRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("screen-reader-announcements")}
      description="What a screen reader hears from the open thread: a turn starting, needing you, and ending. Status and messages adds what the agent writes before its last message. Everything adds each step."
      resetAction={
        settings.screenReaderAnnouncements !==
        DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements ? (
          <SettingResetButton
            label="screen reader announcements"
            onClick={() =>
              updateSettings({
                screenReaderAnnouncements: DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements,
              })
            }
          />
        ) : null
      }
      control={
        <Select
          value={settings.screenReaderAnnouncements}
          onValueChange={(value) => {
            if (isScreenReaderAnnouncements(value)) {
              updateSettings({ screenReaderAnnouncements: value });
            }
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-48"
            aria-label="Screen reader announcements"
          >
            <SelectValue>
              {SCREEN_READER_ANNOUNCEMENTS_LABELS[settings.screenReaderAnnouncements]}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {ScreenReaderAnnouncements.literals.map((value) => (
              <SelectItem key={value} value={value}>
                {SCREEN_READER_ANNOUNCEMENTS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function ScreenReaderWindowTitleRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("screen-reader-window-title")}
      description="Start the window title with the thread's status, like Needs approval, and its name, so screen readers read them first when you switch apps. Taskbars, shared screens, and time trackers see it too."
      resetAction={
        settings.screenReaderWindowTitle !== DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle ? (
          <SettingResetButton
            label="screen reader window title"
            onClick={() =>
              updateSettings({
                screenReaderWindowTitle: DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle,
              })
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.screenReaderWindowTitle}
          onCheckedChange={(checked) => updateSettings({ screenReaderWindowTitle: checked })}
          aria-label="Screen reader window title"
        />
      }
    />
  );
}

export function GeneralSettingsPanel() {
  const modifierLabel = isMacPlatform(navigator.platform) ? "⌘" : "Ctrl";
  const sendShortcutOptions = [
    { value: "enter", label: "Enter" },
    { value: "mod-enter-multiline", label: `${modifierLabel} + Enter for multiline prompts` },
    { value: "mod-enter", label: `${modifierLabel} + Enter always` },
  ] as const;
  const gt = useGT();
  const m = useMessages();
  const setting = useTranslatedSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const languageValue = SUPPORTED_LOCALES.includes(settings.language)
    ? settings.language
    : SYSTEM_LANGUAGE;
  // The Welcome page sets up this computer, so it needs one.
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const harnessSoundVolumeRange = useThrottledRange(
    settings.harnessSoundVolume,
    (harnessSoundVolume) => updateSettings({ harnessSoundVolume }),
  );
  const navigate = useNavigate();
  const { scope, environment, connectedEnvironments, target, targets } = useSettingsScope();
  const idleCompaction = scopedIdleCompaction(targets.length > 0 ? targets : [{ settings }]);
  const environmentId = environment?.environmentId ?? null;
  const isEnvironmentScope = scope.environmentIds.length === 1 && environmentId !== null;
  const hasServerTargets = connectedEnvironments.length > 0;
  const mixedResponseStreamingMode = useScopedSettingsMixed(["responseStreamingMode"]);
  const lastEnabledProjectGroupingMode = useRef<SidebarProjectGroupingMode>(
    readLastEnabledProjectGroupingMode(),
  );
  const providersByEnvironment = useEnvironmentProviders();
  const serverProviders =
    (environment?.serverConfig
      ? providersByEnvironment.get(environment.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const supportsAutoSettlement =
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every(
      (target) => target.serverConfig?.environment.capabilities.threadAutoSettlement === true,
    );
  const supportsAutoSettlementScope = connectedEnvironments.every(
    (target) => target.serverConfig?.environment.capabilities.threadAutoSettlementScope === true,
  );
  const supportsRestartContinuation =
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every(
      (target) => target.serverConfig?.environment.capabilities.threadRestartContinuation === true,
    );

  const textGenerationTargets = useTextGenerationTargets({
    environmentId,
    settings,
    providers: serverProviders.filter((provider) => provider.supportsTextGeneration !== false),
    projectId: target?.projectId ?? null,
    selections: [settings.textGenerationModelSelection],
  });
  const textGenerationProviders = textGenerationTargets.providers;
  const textGenerationModelSelection = resolveAppModelSelectionState(
    settings,
    textGenerationProviders,
  );
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const textGenerationModelInstanceEntries = textGenerationTargets.entries;
  const hasTextGenerationProvider = textGenerationModelInstanceEntries.some(
    (entry) => entry.enabled && entry.isAvailable,
  );
  const textGenInstanceEntry = textGenerationModelInstanceEntries.find(
    (entry) => entry.instanceId === textGenInstanceId,
  );
  const textGenProvider: ProviderDriverKind =
    textGenInstanceEntry?.driverKind ?? DEFAULT_DRIVER_KIND;
  const textGenerationModelOptionsByInstance = getTextGenerationModelOptionsByInstance(
    settings,
    textGenerationProviders,
    textGenInstanceId,
    textGenModel,
  );
  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const textGenerationModelDisabledReason = useScopedModelDisabledReason(
    settings,
    textGenerationModelInstanceEntries,
    true,
  );
  const imageViewerProviders = textGenerationProviders.filter(providerCanViewImages);
  const imageViewerModelSelection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection: settings.imageViewerModelSelection,
    },
    imageViewerProviders,
  );
  const imageViewerInstanceId = imageViewerModelSelection.instanceId;
  const imageViewerModel = imageViewerModelSelection.model;
  const imageViewerModelOptions = imageViewerModelSelection.options;
  const imageViewerInstanceEntries = textGenerationModelInstanceEntries.filter((entry) =>
    providerCanViewImages(entry.snapshot),
  );
  const imageViewerInstanceEntry = imageViewerInstanceEntries.find(
    (entry) => entry.instanceId === imageViewerInstanceId,
  );
  const imageViewerModelOptionsByInstance = filterImageViewerModelOptions(
    imageViewerInstanceEntries,
    getCustomModelOptionsByInstance(
      settings,
      imageViewerProviders,
      imageViewerInstanceId,
      imageViewerModel,
    ),
  );
  const isImageViewerModelDirty = !Equal.equals(
    settings.imageViewerModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.imageViewerModelSelection ?? null,
  );
  const usesDedicatedDiffReviewer = settings.diffReviewModelSelection !== null;
  const diffReviewSelection = settings.diffReviewModelSelection ?? textGenerationModelSelection;
  const diffReviewModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    serverProviders,
    diffReviewSelection.instanceId,
    diffReviewSelection.model,
  );
  const mixedAddProjectBaseDirectory = useScopedSettingsMixed(["addProjectBaseDirectory"]);
  const mixedTextGenerationModel = useScopedSettingsMixed(["textGenerationModelSelection"]);

  return (
    <SettingsPageContainer>
      <ProjectDefaultsSettings category="general" />
      {scope.kind === "project" || scope.kind === "checkout" ? null : (
        <SettingsSection id="snooze" title={gt("Snooze")}>
          <SnoozePresetsRow />
        </SettingsSection>
      )}
      <SettingsSection id="organization" title={gt("Organization")}>
        <SettingsRow
          {...setting("project-grouping")}
          description={<T>Combine matching repositories across environments.</T>}
          resetAction={
            settings.sidebarProjectGroupingMode !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode ? (
              <SettingResetButton
                label="project grouping"
                onClick={() =>
                  updateSettings({
                    sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={isProjectGroupingEnabled(settings.sidebarProjectGroupingMode)}
              onCheckedChange={(checked) => {
                if (!checked && settings.sidebarProjectGroupingMode !== "separate") {
                  lastEnabledProjectGroupingMode.current = settings.sidebarProjectGroupingMode;
                  rememberEnabledProjectGroupingMode(settings.sidebarProjectGroupingMode);
                }
                updateSettings({
                  sidebarProjectGroupingMode: projectGroupingModeFromToggle(
                    checked,
                    lastEnabledProjectGroupingMode.current,
                  ),
                });
              }}
              aria-label={gt("Project grouping")}
            />
          }
        />
        <SettingsRow
          {...setting("project-order")}
          description={<T>Order of projects in the sidebar project picker and command palette.</T>}
          resetAction={
            settings.sidebarProjectSortOrder !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder ? (
              <SettingResetButton
                label="project order"
                onClick={() =>
                  updateSettings({
                    sidebarProjectSortOrder: DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sidebarProjectSortOrder}
              onValueChange={(value) => {
                if (isSidebarProjectSortOrder(value)) {
                  updateSettings({ sidebarProjectSortOrder: value });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label={gt("Project order")}>
                <SelectValue>
                  {m(SIDEBAR_PROJECT_SORT_ORDER_LABELS[settings.sidebarProjectSortOrder])}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {SidebarProjectSortOrder.literals.map((sortOrder) => (
                  <SelectItem hideIndicator key={sortOrder} value={sortOrder}>
                    {m(SIDEBAR_PROJECT_SORT_ORDER_LABELS[sortOrder])}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          serverScoped
          {...setting("auto-resume-limited-threads")}
          description={
            <T>
              Resume usage-limit stops at the reported reset time. Each thread can cancel its
              scheduled continuation.
            </T>
          }
          settingKeys={["autoResumeLimitedThreads"]}
          control={
            <ScopedSwitch
              settingKeys={["autoResumeLimitedThreads"]}
              checked={settings.autoResumeLimitedThreads}
              onCheckedChange={(checked) =>
                updateSettings({ autoResumeLimitedThreads: Boolean(checked) })
              }
              aria-label={gt("Resume after usage limits")}
            />
          }
        />
        <SettingsRow
          serverScoped
          {...setting("snooze-limited-threads")}
          description={
            <T>Snooze usage-limit stops until reset. Pair with resume to continue on wake.</T>
          }
          settingKeys={["snoozeLimitedThreads"]}
          control={
            <ScopedSwitch
              settingKeys={["snoozeLimitedThreads"]}
              checked={settings.snoozeLimitedThreads}
              onCheckedChange={(checked) =>
                updateSettings({ snoozeLimitedThreads: Boolean(checked) })
              }
              aria-label={gt("Snooze until limits reset")}
            />
          }
        />

        <SettingsRow
          serverScoped
          settingKeys={["idleCompaction", "compactIdleThreads"]}
          mixed={idleCompaction.mixed}
          {...setting("compact-idle-threads")}
          description={
            <T>
              When to compact an idle Claude thread over 200,000 tokens: after you return, just
              before its prompt cache expires, or never. Each Claude provider can override this.
            </T>
          }
          resetAction={
            globalIdleCompaction(settings) !== globalIdleCompaction(DEFAULT_UNIFIED_SETTINGS) ? (
              <SettingResetButton
                label="compact idle threads"
                onClick={() =>
                  updateSettings({ idleCompaction: globalIdleCompaction(DEFAULT_UNIFIED_SETTINGS) })
                }
              />
            ) : null
          }
          control={
            <Select
              value={idleCompaction.mixed ? null : globalIdleCompaction(settings)}
              onValueChange={(value) => {
                const mode = IDLE_COMPACTION_MODES.find((candidate) => candidate.value === value);
                if (mode) updateSettings({ idleCompaction: mode.value });
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-56"
                aria-label={gt("Compact idle threads")}
              >
                <SelectValue>
                  {(value: string | null) =>
                    value === null
                      ? "Mixed"
                      : IDLE_COMPACTION_MODES.find((mode) => mode.value === value)?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {IDLE_COMPACTION_MODES.map((mode) => (
                  <SelectItem
                    hideIndicator
                    key={mode.value}
                    value={mode.value}
                    // A server from before modes has only the on/off switch, so it cannot store "Never".
                    disabled={mode.value === "off" && !idleCompaction.neverAvailable}
                  >
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        {supportsAutoSettlement ? (
          <>
            <SettingsRow
              serverScoped
              settingKeys={["sidebarAutoSettleOnMerge"]}
              {...setting("auto-settle-merged-threads")}
              description={
                <T>
                  Settle a thread when its pull request merges. Closed pull requests still settle
                  automatically.
                </T>
              }
              resetAction={
                settings.sidebarAutoSettleOnMerge !==
                DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge ? (
                  <SettingResetButton
                    label="auto-settle on merge"
                    onClick={() =>
                      updateSettings({
                        sidebarAutoSettleOnMerge: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge,
                      })
                    }
                  />
                ) : null
              }
              control={
                <ScopedSwitch
                  settingKeys={["sidebarAutoSettleOnMerge"]}
                  checked={settings.sidebarAutoSettleOnMerge}
                  onCheckedChange={(checked) =>
                    updateSettings({ sidebarAutoSettleOnMerge: Boolean(checked) })
                  }
                  aria-label={gt("Auto-settle merged threads")}
                />
              }
            />

            <SettingsRow
              serverScoped
              settingKeys={["sidebarAutoSettleAfterDays"]}
              {...setting("auto-settle-inactive-threads")}
              description={
                <T>Sidebar threads with no activity for this long settle automatically.</T>
              }
              resetAction={
                settings.sidebarAutoSettleAfterDays !==
                DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays ? (
                  <SettingResetButton
                    label="auto-settle"
                    onClick={() =>
                      updateSettings({
                        sidebarAutoSettleAfterDays:
                          DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays,
                      })
                    }
                  />
                ) : null
              }
              control={
                <ScopedSwitch
                  settingKeys={["sidebarAutoSettleAfterDays"]}
                  checked={settings.sidebarAutoSettleAfterDays !== null}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      sidebarAutoSettleAfterDays: checked ? AUTO_SETTLE_DEFAULT_DAYS : null,
                    })
                  }
                  aria-label={gt("Auto-settle inactive threads")}
                />
              }
            />
            {settings.sidebarAutoSettleAfterDays !== null ? (
              <SettingsRow
                serverScoped
                settingKeys={["sidebarAutoSettleAfterDays"]}
                title={searchableSetting("days-before-auto-settle").title}
                description={<T>Any new activity un-settles a thread automatically.</T>}
                control={
                  <AutoSettleDaysInput
                    value={settings.sidebarAutoSettleAfterDays}
                    onCommit={(days, options) =>
                      updateSettings({ sidebarAutoSettleAfterDays: days }, options)
                    }
                  />
                }
              />
            ) : null}
            {settings.sidebarAutoSettleAfterDays !== null && supportsAutoSettlementScope ? (
              <SettingsRow
                serverScoped
                settingKeys={["sidebarAutoSettleKeepPullRequests"]}
                title="Keep threads with a PR"
                description={
                  <T>
                    Inactivity does not settle threads with a pull request. Merge and close still
                    do.
                  </T>
                }
                control={
                  <ScopedSwitch
                    settingKeys={["sidebarAutoSettleKeepPullRequests"]}
                    checked={settings.sidebarAutoSettleKeepPullRequests}
                    onCheckedChange={(checked) =>
                      updateSettings({ sidebarAutoSettleKeepPullRequests: checked })
                    }
                    aria-label={gt("Keep threads with a PR")}
                  />
                }
              />
            ) : null}
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection id="notifications" title={gt("Notifications")}>
        <NotificationSettings />
        <SettingsRow
          {...setting("harness-sound-volume")}
          description={
            <T>Set the volume for errors, permission requests, questions and completed turns.</T>
          }
          resetAction={
            settings.harnessSoundVolume !== DEFAULT_UNIFIED_SETTINGS.harnessSoundVolume ? (
              <SettingResetButton
                label="notification sound volume"
                onClick={() =>
                  updateSettings({
                    harnessSoundVolume: DEFAULT_UNIFIED_SETTINGS.harnessSoundVolume,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSlider
              label="Notification sound volume"
              min={MIN_HARNESS_SOUND_VOLUME}
              max={MAX_HARNESS_SOUND_VOLUME}
              value={harnessSoundVolumeRange.value}
              onChange={harnessSoundVolumeRange.onChange}
              onFinish={harnessSoundVolumeRange.onFinish}
            />
          }
        />
        <SettingsRow
          {...setting("in-app-notifications")}
          description={
            <T>
              Show a toast when another thread finishes, fails, or needs input or approval while
              this app has focus.
            </T>
          }
          control={
            <Switch
              checked={settings.inAppNotificationsEnabled}
              onCheckedChange={(checked) => updateSettings({ inAppNotificationsEnabled: checked })}
              aria-label={gt("In-app notifications")}
            />
          }
        />
        <SettingsRow
          {...setting("language")}
          description={<T>System default follows your browser or OS language.</T>}
          resetAction={
            settings.language !== DEFAULT_UNIFIED_SETTINGS.language ? (
              <SettingResetButton
                label="language"
                onClick={() => updateSettings({ language: DEFAULT_UNIFIED_SETTINGS.language })}
              />
            ) : null
          }
          control={
            <Select
              value={languageValue}
              onValueChange={(value) => {
                if (value) updateSettings({ language: value });
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={gt("Language")}>
                <SelectValue>
                  {languageValue === SYSTEM_LANGUAGE
                    ? m(TIMESTAMP_FORMAT_LABELS.locale)
                    : nativeLanguageName(languageValue)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value={SYSTEM_LANGUAGE}>
                  {m(TIMESTAMP_FORMAT_LABELS.locale)}
                </SelectItem>
                {SUPPORTED_LOCALES.map((locale) => (
                  <SelectItem hideIndicator key={locale} value={locale}>
                    {nativeLanguageName(locale)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...setting("time-format")}
          description={<T>System default follows your browser or OS clock preference.</T>}
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label="time format"
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={gt("Timestamp format")}
              >
                <SelectValue>{m(TIMESTAMP_FORMAT_LABELS[settings.timestampFormat])}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {m(TIMESTAMP_FORMAT_LABELS.locale)}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {m(TIMESTAMP_FORMAT_LABELS["12-hour"])}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {m(TIMESTAMP_FORMAT_LABELS["24-hour"])}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection id="diffs" title={gt("Diffs")}>
        <SettingsRow
          {...setting("hide-whitespace-changes")}
          description={<T>Set whether the diff panel ignores whitespace-only edits by default.</T>}
          resetAction={
            settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace ? (
              <SettingResetButton
                label="diff whitespace changes"
                onClick={() =>
                  updateSettings({
                    diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffIgnoreWhitespace}
              onCheckedChange={(checked) =>
                updateSettings({ diffIgnoreWhitespace: Boolean(checked) })
              }
              aria-label={gt("Hide whitespace changes by default")}
            />
          }
        />
        <SettingsRow
          {...setting("default-diff-file-state")}
          description={
            <T>
              Start with files expanded or collapsed when opening diffs or a pull request's Code
              tab.
            </T>
          }
          resetAction={
            settings.diffFilesCollapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed ? (
              <SettingResetButton
                label="default diff file state"
                onClick={() =>
                  updateSettings({
                    diffFilesCollapsed: DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.diffFilesCollapsed ? "collapsed" : "expanded"}
              onValueChange={(value) => {
                if (value === "expanded" || value === "collapsed") {
                  updateSettings({ diffFilesCollapsed: value === "collapsed" });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={gt("Default diff file state")}
              >
                <SelectValue>{settings.diffFilesCollapsed ? "Collapsed" : "Expanded"}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="expanded">
                  Expanded
                </SelectItem>
                <SelectItem hideIndicator value="collapsed">
                  Collapsed
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...setting("diff-layout")}
          description={
            <T>
              Show diffs stacked or side by side. The toggle in the diff toolbar changes this too.
            </T>
          }
          resetAction={
            settings.diffLayout !== DEFAULT_UNIFIED_SETTINGS.diffLayout ? (
              <SettingResetButton
                label="diff layout"
                onClick={() => updateSettings({ diffLayout: DEFAULT_UNIFIED_SETTINGS.diffLayout })}
              />
            ) : null
          }
          control={
            <Select
              value={settings.diffLayout}
              onValueChange={(value) => {
                if (value === "stacked" || value === "split") {
                  updateSettings({ diffLayout: value });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={gt("Diff layout")}>
                <SelectValue>{DIFF_LAYOUT_LABELS[settings.diffLayout]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="stacked">
                  {DIFF_LAYOUT_LABELS.stacked}
                </SelectItem>
                <SelectItem hideIndicator value="split">
                  {DIFF_LAYOUT_LABELS.split}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...setting("diff-presentation")}
          description={
            <T>
              Choose whether chat shows the changed-files summary, the full inline patch, or the
              dedicated diff panel.
            </T>
          }
          resetAction={
            settings.diffPresentation !== DEFAULT_UNIFIED_SETTINGS.diffPresentation ? (
              <SettingResetButton
                label="diff presentation"
                onClick={() =>
                  updateSettings({ diffPresentation: DEFAULT_UNIFIED_SETTINGS.diffPresentation })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.diffPresentation}
              onValueChange={(value) => {
                if (value === "summary" || value === "inline" || value === "panel") {
                  updateSettings({ diffPresentation: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-44"
                aria-label={gt("Diff presentation")}
              >
                <SelectValue>{DIFF_PRESENTATION_LABELS[settings.diffPresentation]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="summary">
                  {DIFF_PRESENTATION_LABELS.summary}
                </SelectItem>
                <SelectItem hideIndicator value="inline">
                  {DIFF_PRESENTATION_LABELS.inline}
                </SelectItem>
                <SelectItem hideIndicator value="panel">
                  {DIFF_PRESENTATION_LABELS.panel}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection id="composer" title={gt("Composer")}>
        <SettingsRow
          serverScoped
          settingKeys={["responseStreamingMode"]}
          {...setting("response-streaming")}
          description={
            mixedResponseStreamingMode
              ? "The selected targets use different streaming modes."
              : RESPONSE_STREAMING_MODE_DESCRIPTIONS[settings.responseStreamingMode]
          }
          resetAction={
            settings.responseStreamingMode !== DEFAULT_UNIFIED_SETTINGS.responseStreamingMode ? (
              <SettingResetButton
                label="response streaming"
                onClick={() =>
                  updateSettings({
                    responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={mixedResponseStreamingMode ? null : settings.responseStreamingMode}
              onValueChange={(value) => {
                if (value === "turn" || value === "paragraph") {
                  updateSettings({ responseStreamingMode: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-56"
                aria-label={gt("Response streaming")}
              >
                <SelectValue>
                  {(value: ResponseStreamingMode | null) =>
                    value === null ? "Mixed" : RESPONSE_STREAMING_MODE_LABELS[value]
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="turn">
                  {RESPONSE_STREAMING_MODE_LABELS.turn}
                </SelectItem>
                <SelectItem hideIndicator value="paragraph">
                  {RESPONSE_STREAMING_MODE_LABELS.paragraph}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...setting("proactive-panels")}
          description={
            <T>
              Open linked pull requests first. Otherwise, open Changes for edits to at least 3 files
              or 50 lines.
            </T>
          }
          resetAction={
            settings.proactivePanelsEnabled !== DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled ? (
              <SettingResetButton
                label="proactive panels"
                onClick={() =>
                  updateSettings({
                    proactivePanelsEnabled: DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.proactivePanelsEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ proactivePanelsEnabled: Boolean(checked) })
              }
              aria-label={gt("Proactive panels")}
            />
          }
        />
        <SettingsRow
          {...setting("skills-in-slash-menu")}
          description={
            <T>Also include skills in the / command menu. Skills always appear when you type $.</T>
          }
          resetAction={
            settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu ? (
              <SettingResetButton
                label="skills in slash menu"
                onClick={() =>
                  updateSettings({
                    showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.showSkillsInSlashMenu}
              onCheckedChange={(checked) =>
                updateSettings({ showSkillsInSlashMenu: Boolean(checked) })
              }
              aria-label={gt("Show skills in slash menu")}
            />
          }
        />
        <SettingsRow
          {...setting("composer-rich-text")}
          description={<T>Show formatted Markdown as you type.</T>}
          resetAction={
            settings.composerRichTextEnabled !==
            DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled ? (
              <SettingResetButton
                label="rich text composer"
                onClick={() =>
                  updateSettings({
                    composerRichTextEnabled: DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.composerRichTextEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ composerRichTextEnabled: Boolean(checked) })
              }
              aria-label={gt("Rich text composer")}
            />
          }
        />
        <SettingsRow
          {...setting("voice-live-preview")}
          description={
            <T>
              Show the words you speak, dimmed in the composer, while a voice note records.
              Downloads a speech model (about 600 MB) the first time and runs it on your GPU. The
              final transcript still comes from the server.
            </T>
          }
          resetAction={
            settings.voiceLivePreviewEnabled !==
            DEFAULT_UNIFIED_SETTINGS.voiceLivePreviewEnabled ? (
              <SettingResetButton
                label="live transcription preview"
                onClick={() =>
                  updateSettings({
                    voiceLivePreviewEnabled: DEFAULT_UNIFIED_SETTINGS.voiceLivePreviewEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.voiceLivePreviewEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ voiceLivePreviewEnabled: Boolean(checked) })
              }
              aria-label={gt("Live transcription preview")}
            />
          }
        />
        <SettingsRow
          {...setting("composer-collapse")}
          description={
            <T>
              Rest the composer of an existing thread into a single line when you scroll the
              conversation. Focus the composer or start typing to expand it again.
            </T>
          }
          resetAction={
            settings.composerCollapseOnScroll !==
            DEFAULT_UNIFIED_SETTINGS.composerCollapseOnScroll ? (
              <SettingResetButton
                label="collapse composer on scroll"
                onClick={() =>
                  updateSettings({
                    composerCollapseOnScroll: DEFAULT_UNIFIED_SETTINGS.composerCollapseOnScroll,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.composerCollapseOnScroll}
              onCheckedChange={(checked) =>
                updateSettings({ composerCollapseOnScroll: Boolean(checked) })
              }
              aria-label={gt("Collapse composer on scroll")}
            />
          }
        />
        <SettingsRow
          {...setting("send-shortcut")}
          description={<T>Choose when Enter sends a prompt or inserts a new line</T>}
          resetAction={
            settings.sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut ? (
              <SettingResetButton
                label="send shortcut"
                onClick={() =>
                  updateSettings({ sendShortcut: DEFAULT_UNIFIED_SETTINGS.sendShortcut })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sendShortcut}
              onValueChange={(value) => {
                const option = sendShortcutOptions.find((option) => option.value === value);
                if (option) updateSettings({ sendShortcut: option.value });
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-0 max-w-full"
                aria-label={gt("Send shortcut")}
              >
                <SelectValue>
                  {
                    sendShortcutOptions.find((option) => option.value === settings.sendShortcut)
                      ?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {sendShortcutOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex items-center justify-between gap-4">
                      {option.label}
                      {settings.sendShortcut === option.value && <CheckIcon aria-hidden="true" />}
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...setting("follow-up-behavior")}
          description={
            "Queue follow-ups while the agent runs or steer the current run. " +
            (settings.sendShortcut === "mod-enter-multiline"
              ? `Press ${modifierLabel} + Enter for single-line prompts or ${modifierLabel} + Shift + Enter for multiline prompts to do the opposite for one message.`
              : `Press ${modifierLabel}${settings.sendShortcut === "mod-enter" ? " + Shift" : ""} + Enter to do the opposite for one message.`)
          }
          resetAction={
            settings.followUpBehavior !== DEFAULT_UNIFIED_SETTINGS.followUpBehavior ? (
              <SettingResetButton
                label="follow-up behavior"
                onClick={() =>
                  updateSettings({
                    followUpBehavior: DEFAULT_UNIFIED_SETTINGS.followUpBehavior,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.followUpBehavior}
              onValueChange={(value) => {
                if (value === "queue" || value === "steer") {
                  updateSettings({ followUpBehavior: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-0"
                aria-label={gt("Follow-up behavior")}
              >
                <SelectValue>
                  {settings.followUpBehavior === "queue" ? "Queue" : "Steer"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="queue">Queue</SelectItem>
                <SelectItem value="steer">Steer</SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["suggestNextPrompt"]}
          {...setting("suggest-next-prompt")}
          description={
            <T>
              Show a dimmed suggestion for your next message once an agent finishes. Press Tab to
              use it. Claude predicts it inside its own session, so it costs almost nothing.
            </T>
          }
          resetAction={
            settings.suggestNextPrompt !== DEFAULT_UNIFIED_SETTINGS.suggestNextPrompt ? (
              <SettingResetButton
                label="suggest the next prompt"
                onClick={() =>
                  updateSettings({ suggestNextPrompt: DEFAULT_UNIFIED_SETTINGS.suggestNextPrompt })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["suggestNextPrompt"]}
              checked={settings.suggestNextPrompt}
              onCheckedChange={(checked) => updateSettings({ suggestNextPrompt: Boolean(checked) })}
              aria-label={gt("Suggest the next prompt")}
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["suggestNextPromptOtherProviders"]}
          {...setting("suggest-next-prompt-other-providers")}
          description={
            <T>
              Also suggest for Codex, Cursor, and other providers. After every turn this sends one
              request to your text generation model, with no shared prompt cache, so it uses extra
              quota.
            </T>
          }
          resetAction={
            settings.suggestNextPromptOtherProviders !==
            DEFAULT_UNIFIED_SETTINGS.suggestNextPromptOtherProviders ? (
              <SettingResetButton
                label="suggestions for other providers"
                onClick={() =>
                  updateSettings({
                    suggestNextPromptOtherProviders:
                      DEFAULT_UNIFIED_SETTINGS.suggestNextPromptOtherProviders,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["suggestNextPromptOtherProviders"]}
              checked={settings.suggestNextPromptOtherProviders}
              disabled={!settings.suggestNextPrompt}
              onCheckedChange={(checked) =>
                updateSettings({ suggestNextPromptOtherProviders: Boolean(checked) })
              }
              aria-label={gt("Also suggest for other providers")}
            />
          }
        />
        <SettingsRow
          title="Show provider thinking"
          description={
            <T>
              Show normalized reasoning and thinking traces in chat. Tool calls remain visible when
              this is off.
            </T>
          }
          control={
            <Switch
              checked={settings.showThinkingTraces}
              onCheckedChange={(checked) =>
                updateSettings({ showThinkingTraces: Boolean(checked) })
              }
              aria-label={gt("Show provider thinking traces")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="activity" title={gt("Activity")}>
        <ToolCallVisibilityRow />
      </SettingsSection>

      <SettingsSection id="screen-reader" title={gt("Screen reader")}>
        <ScreenReaderAnnouncementsRow />
        <ScreenReaderWindowTitleRow />
      </SettingsSection>

      <SettingsSection id="updates" title={gt("Updates")}>
        <SettingsRow
          serverScoped
          settingKeys={["enableProviderUpdateChecks"]}
          {...setting("provider-update-checks")}
          description={
            <T>
              Check installed provider CLIs for newer available versions and fetch model catalog
              updates. When off, new models may not appear.
            </T>
          }
          resetAction={
            settings.enableProviderUpdateChecks !==
            DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks ? (
              <SettingResetButton
                label="provider update checks"
                onClick={() =>
                  updateSettings({
                    enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["enableProviderUpdateChecks"]}
              checked={settings.enableProviderUpdateChecks}
              onCheckedChange={(checked) =>
                updateSettings({ enableProviderUpdateChecks: Boolean(checked) })
              }
              aria-label={gt("Check provider versions")}
            />
          }
        />
        <SettingsRow
          {...setting("continue-threads-after-server-update")}
          serverScoped
          settingKeys={["continueThreadsAfterServerUpdate"]}
          description={
            <T>
              Automatically resume interrupted threads after an update, crash, or machine restart on
              the selected environments.
            </T>
          }
          status={
            !supportsRestartContinuation
              ? "All selected connected environments must support restart continuation."
              : undefined
          }
          resetAction={
            supportsRestartContinuation &&
            settings.continueThreadsAfterServerUpdate !==
              DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate ? (
              <SettingResetButton
                label="continue threads after restarts"
                onClick={() =>
                  updateSettings({
                    continueThreadsAfterServerUpdate:
                      DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["continueThreadsAfterServerUpdate"]}
              checked={settings.continueThreadsAfterServerUpdate}
              disabled={!supportsRestartContinuation}
              onCheckedChange={(checked) =>
                updateSettings({ continueThreadsAfterServerUpdate: Boolean(checked) })
              }
              aria-label={gt("Continue threads after restarts")}
            />
          }
        />
        <BackgroundActivitySettingsRow />
        <SettingsRow
          serverScoped
          settingKeys={["keepAwakeWhileAgentsWork"]}
          {...setting("keep-awake-while-agents-work")}
          description={
            <T>
              Stop the computer from going to sleep while agents are working, and let it sleep once
              they finish. Closing a laptop lid still puts it to sleep.
            </T>
          }
          resetAction={
            settings.keepAwakeWhileAgentsWork !==
            DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork ? (
              <SettingResetButton
                label="keep awake while agents work"
                onClick={() =>
                  updateSettings({
                    keepAwakeWhileAgentsWork: DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["keepAwakeWhileAgentsWork"]}
              checked={settings.keepAwakeWhileAgentsWork}
              onCheckedChange={(checked) =>
                updateSettings({ keepAwakeWhileAgentsWork: Boolean(checked) })
              }
              aria-label={gt("Keep awake while agents work")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="projects-and-threads" title={gt("Projects & threads")}>
        <SettingsRow
          serverScoped
          settingKeys={["newWorktreesStartFromOrigin"]}
          {...setting("start-from-origin")}
          description={
            <T>
              Uses the latest commit of the base branch’s tracked remote branch, even if its name
              differs. Otherwise uses the same-named branch on origin. Uses your local branch if
              that remote branch is missing.
            </T>
          }
          resetAction={
            settings.newWorktreesStartFromOrigin !==
            DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin ? (
              <SettingResetButton
                label="new worktrees start from remote"
                onClick={() =>
                  updateSettings({
                    newWorktreesStartFromOrigin:
                      DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["newWorktreesStartFromOrigin"]}
              checked={settings.newWorktreesStartFromOrigin}
              onCheckedChange={(checked) =>
                updateSettings({ newWorktreesStartFromOrigin: Boolean(checked) })
              }
              aria-label={gt("Start new worktrees from remote by default")}
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["addProjectBaseDirectory"]}
          {...setting("add-project-starts-in")}
          description='Leave empty to use "~/" when the Add Project browser opens.'
          resetAction={
            settings.addProjectBaseDirectory !==
            DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory ? (
              <SettingResetButton
                label="add project base directory"
                onClick={() =>
                  updateSettings({
                    addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
                  })
                }
              />
            ) : null
          }
          control={
            <DraftInput
              size="sm"
              className="w-full sm:w-72"
              value={mixedAddProjectBaseDirectory ? "" : settings.addProjectBaseDirectory}
              onCommit={(next) => updateSettings({ addProjectBaseDirectory: next })}
              placeholder={mixedAddProjectBaseDirectory ? "Mixed" : "~/"}
              spellCheck={false}
              aria-label={gt("Add project base directory")}
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["ghqCloneLayout"]}
          {...setting("ghq-clone-layout")}
          description={<T>Clones go to github.com/owner/repo under the folder above, like ghq.</T>}
          resetAction={
            settings.ghqCloneLayout !== DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout ? (
              <SettingResetButton
                label="clone into host folders"
                onClick={() =>
                  updateSettings({ ghqCloneLayout: DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["ghqCloneLayout"]}
              checked={settings.ghqCloneLayout}
              onCheckedChange={(checked) => updateSettings({ ghqCloneLayout: Boolean(checked) })}
              aria-label={gt("Clone into host folders")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="confirmations" title={gt("Confirmations")}>
        <SettingsRow
          {...setting("unpin-confirmation")}
          description={<T>Ask before unpinning a thread from the pinned section.</T>}
          resetAction={
            settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin ? (
              <SettingResetButton
                label="unpin confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadUnpin}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadUnpin: Boolean(checked) })
              }
              aria-label={gt("Confirm thread unpinning")}
            />
          }
        />

        <SettingsRow
          {...setting("archive-confirmation")}
          description={
            <T>Require a second click on the inline archive action before a thread is archived.</T>
          }
          resetAction={
            settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
              <SettingResetButton
                label="archive confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadArchive}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadArchive: Boolean(checked) })
              }
              aria-label={gt("Confirm thread archiving")}
            />
          }
        />

        <SettingsRow
          {...setting("delete-confirmation")}
          description={<T>Ask before deleting a thread and its chat history.</T>}
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <SettingResetButton
                label="delete confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadDelete: Boolean(checked) })
              }
              aria-label={gt("Confirm thread deletion")}
            />
          }
        />

        {isElectron ? (
          <SettingsRow
            {...setting("quit-confirmation")}
            description={<T>Hold mode also quits on two quick presses.</T>}
            resetAction={
              settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit ? (
                <SettingResetButton
                  label="quit shortcut behavior"
                  onClick={() =>
                    updateSettings({ confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.confirmQuit}
                onValueChange={(value) => {
                  if (value === "direct" || value === "hold" || value === "double-click") {
                    updateSettings({ confirmQuit: value });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={gt("Quit shortcut behavior")}
                >
                  <SelectValue>{QUIT_CONFIRMATION_MODE_LABELS[settings.confirmQuit]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {Object.entries(QUIT_CONFIRMATION_MODE_LABELS).map(([value, label]) => (
                    <SelectItem hideIndicator key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}
      </SettingsSection>

      <SettingsSection id="models" title={gt("Models")}>
        <SettingsRow
          serverScoped
          settingKeys={["textGenerationModelSelection"]}
          {...setting("text-generation-model")}
          description={
            <T>
              For thread titles and other generated text. Source control has its own setting. Text
              generators from Providers also appear here.
            </T>
          }
          resetAction={
            hasServerTargets && isTextGenerationModelDirty ? (
              <SettingResetButton
                label="text generation model"
                onClick={() =>
                  updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            !hasServerTargets ? (
              <span className="text-sm text-muted-foreground">
                Connect an environment to choose its text generation model.
              </span>
            ) : !hasTextGenerationProvider ? (
              <span className="text-sm text-muted-foreground">
                No text generation providers available.
              </span>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <ProviderModelPicker
                  environmentId={environmentId}
                  activeInstanceId={textGenInstanceId}
                  model={textGenModel}
                  lockedProvider={null}
                  instanceEntries={textGenerationModelInstanceEntries}
                  modelOptionsByInstance={textGenerationModelOptionsByInstance}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  {...(mixedTextGenerationModel ? { triggerLabel: "Mixed" } : {})}
                  getModelDisabledReason={textGenerationModelDisabledReason}
                  {...(environmentId
                    ? {
                        onOpenProviderSetup: (instanceId: ProviderInstanceId) => {
                          void navigate({
                            to: "/settings/providers",
                            search: { environmentId, instanceId },
                          });
                        },
                      }
                    : {})}
                  onInstanceModelChange={(instanceId, model) => {
                    const reason = textGenerationModelDisabledReason(instanceId, model);
                    if (reason) {
                      toastManager.add({
                        type: "error",
                        title: "Text generation model not saved",
                        description: reason,
                      });
                      return;
                    }
                    updateSettings({
                      textGenerationModelSelection: resolveAppModelSelectionState(
                        {
                          ...settings,
                          textGenerationModelSelection: createModelSelection(instanceId, model),
                        },
                        textGenerationProviders,
                      ),
                    });
                  }}
                />
                {textGenInstanceEntry ? (
                  <TraitsPicker
                    provider={textGenProvider}
                    models={textGenInstanceEntry?.models ?? []}
                    model={textGenModel}
                    modelOptions={textGenModelOptions}
                    includePlanAgent={selectsPlanAgent(textGenModelOptions)}
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    onModelOptionsChange={(nextOptions) => {
                      updateSettings({
                        textGenerationModelSelection: resolveAppModelSelectionState(
                          {
                            ...settings,
                            textGenerationModelSelection: createModelSelection(
                              textGenInstanceId,
                              textGenModel,
                              nextOptions,
                            ),
                          },
                          textGenerationProviders,
                        ),
                      });
                    }}
                  />
                ) : null}
              </div>
            )
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["imageViewerEnabled"]}
          {...setting("image-viewer")}
          description={
            <T>
              Let a vision model describe attached images for main models that cannot see them. When
              off, images go to the main model as they are.
            </T>
          }
          resetAction={
            settings.imageViewerEnabled !== DEFAULT_UNIFIED_SETTINGS.imageViewerEnabled ? (
              <SettingResetButton
                label="image viewer"
                onClick={() =>
                  updateSettings({
                    imageViewerEnabled: DEFAULT_UNIFIED_SETTINGS.imageViewerEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["imageViewerEnabled"]}
              checked={settings.imageViewerEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ imageViewerEnabled: Boolean(checked) })
              }
              aria-label={gt("Image viewer")}
            />
          }
        />
        {settings.imageViewerEnabled ? (
          <SettingsRow
            serverScoped
            settingKeys={["imageViewerModelSelection"]}
            title="Image viewer model"
            description={
              <T>
                Reads attached images and describes them to the main model. Only models with vision
                are listed.
              </T>
            }
            resetAction={
              isImageViewerModelDirty ? (
                <SettingResetButton
                  label="image viewer model"
                  onClick={() =>
                    updateSettings({
                      imageViewerModelSelection: DEFAULT_UNIFIED_SETTINGS.imageViewerModelSelection,
                    })
                  }
                />
              ) : null
            }
            control={
              imageViewerInstanceEntries.length === 0 ? (
                <span className="text-sm text-muted-foreground">
                  No providers with vision available.
                </span>
              ) : (
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <ProviderModelPicker
                    environmentId={environmentId}
                    activeInstanceId={imageViewerInstanceId}
                    model={imageViewerModel}
                    lockedProvider={null}
                    instanceEntries={imageViewerInstanceEntries}
                    modelOptionsByInstance={imageViewerModelOptionsByInstance}
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    onInstanceModelChange={(instanceId, model) => {
                      updateSettings({
                        imageViewerModelSelection: createModelSelection(instanceId, model),
                      });
                    }}
                  />
                  {imageViewerInstanceEntry ? (
                    <TraitsPicker
                      provider={imageViewerInstanceEntry.driverKind}
                      models={imageViewerInstanceEntry.models}
                      model={imageViewerModel}
                      modelOptions={imageViewerModelOptions}
                      includePlanAgent={selectsPlanAgent(imageViewerModelOptions)}
                      triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                      onModelOptionsChange={(nextOptions) => {
                        updateSettings({
                          imageViewerModelSelection: createModelSelection(
                            imageViewerInstanceId,
                            imageViewerModel,
                            nextOptions,
                          ),
                        });
                      }}
                    />
                  ) : null}
                </div>
              )
            }
          />
        ) : null}
        <SettingsRow
          serverScoped
          settingKeys={["diffReviewModelSelection"]}
          title="Diff review agent"
          description={
            <T>
              Optional model used by the read-only Review changes action in chat. Off uses the
              global text generation model.
            </T>
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {usesDedicatedDiffReviewer ? (
                <>
                  <ProviderModelPicker
                    environmentId={environmentId}
                    activeInstanceId={diffReviewSelection.instanceId}
                    model={diffReviewSelection.model}
                    lockedProvider={null}
                    instanceEntries={textGenerationModelInstanceEntries}
                    modelOptionsByInstance={diffReviewModelOptionsByInstance}
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    triggerAriaLabel="Diff review agent model"
                    onInstanceModelChange={(instanceId, model) => {
                      const existing = settings.diffReviewModelSelection;
                      updateSettings({
                        diffReviewModelSelection:
                          existing && existing.instanceId === instanceId
                            ? createModelSelection(instanceId, model, existing.options)
                            : createModelSelection(instanceId, model),
                      });
                    }}
                  />
                  <TraitsPicker
                    provider={
                      textGenerationModelInstanceEntries.find(
                        (entry) => entry.instanceId === diffReviewSelection.instanceId,
                      )?.driverKind ?? DEFAULT_DRIVER_KIND
                    }
                    models={
                      textGenerationModelInstanceEntries.find(
                        (entry) => entry.instanceId === diffReviewSelection.instanceId,
                      )?.models ?? []
                    }
                    model={diffReviewSelection.model}
                    modelOptions={diffReviewSelection.options}
                    includePlanAgent={selectsPlanAgent(diffReviewSelection.options)}
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    onModelOptionsChange={(nextOptions) =>
                      updateSettings({
                        diffReviewModelSelection: createModelSelection(
                          diffReviewSelection.instanceId,
                          diffReviewSelection.model,
                          nextOptions,
                        ),
                      })
                    }
                  />
                </>
              ) : null}
              <Switch
                checked={usesDedicatedDiffReviewer}
                onCheckedChange={(checked) =>
                  updateSettings({
                    diffReviewModelSelection: checked
                      ? createModelSelection(
                          textGenerationModelSelection.instanceId,
                          textGenerationModelSelection.model,
                          textGenerationModelSelection.options,
                        )
                      : null,
                  })
                }
                aria-label={gt("Use a separate diff review agent")}
              />
            </div>
          }
        />
        <AgentPresetsSettings
          settings={settings}
          currentSelection={textGenerationModelSelection}
          updateSettings={(patch) => updateSettings(patch)}
        />
      </SettingsSection>

      <SettingsSection id="agent-instructions" title={gt("Agent instructions")}>
        <SettingsRow
          serverScoped
          settingKeys={["sealsInstructions"]}
          title="Agent instructions (Seals.md)"
          description={
            <T>
              Persistent instructions included at the start of every provider turn, similar to
              global user rules.
            </T>
          }
        >
          <div className="mt-3 w-full pb-3.5">
            <Textarea
              key={settings.sealsInstructions}
              defaultValue={settings.sealsInstructions}
              onBlur={(event) => {
                const sealsInstructions = event.target.value.trim();
                if (sealsInstructions !== settings.sealsInstructions) {
                  updateSettings({ sealsInstructions });
                }
              }}
              rows={7}
              placeholder="Use concise answers. Run focused tests after edits."
              aria-label={gt("Agent instructions (Seals.md)")}
            />
          </div>
        </SettingsRow>
        <ThreadTitleInstructionsSettings />
      </SettingsSection>

      <SnapShotSettings />

      <SettingsSection id="about" title={gt("About")}>
        {isElectron || HOSTED_APP_CHANNEL ? (
          <AboutVersionSection />
        ) : (
          <>
            <SettingsRow
              id={searchableSetting("app-version").id}
              title={<AboutVersionTitle />}
              description={<T>Current version of the application.</T>}
            />
          </>
        )}
        <SettingsRow
          title="Harp on GitHub"
          description={
            <T>
              Source code, releases and issue tracker. Harp is open source under the MIT license.
            </T>
          }
          control={
            <Button
              render={
                <a
                  href="https://github.com/epitaphwastakenn/SealCode"
                  rel="noreferrer noopener"
                  target="_blank"
                />
              }
              size="sm"
              variant="default"
            >
              Open on GitHub
            </Button>
          }
        />
        {primaryEnvironmentId === null ? null : (
          <SettingsRow
            {...setting("welcome-page")}
            description={<T>See your agents, import projects, and connect Roblox Studio.</T>}
            control={
              <Button size="sm" variant="outline" render={<Link to="/welcome" />}>
                Open
              </Button>
            }
          />
        )}
        <SettingsRow
          {...setting("diagnostics")}
          description={
            isEnvironmentScope
              ? "Inspect processes, resource use, and logs on this environment."
              : "Inspect processes, resource use, and logs on one environment at a time."
          }
          control={
            <Button
              render={
                <Link to="/settings/diagnostics" search={{ machine: environmentId ?? undefined }} />
              }
              size="sm"
              variant="outline"
            >
              View diagnostics
            </Button>
          }
        />
        <SettingsRow
          {...setting("open-source-licenses")}
          description={<T>Notices for dependencies, assets, and optional tools used by Harp.</T>}
          control={
            <Button
              render={<Link to="/settings/open-source-licenses" />}
              size="sm"
              variant="outline"
            >
              View licenses
            </Button>
          }
        />
        <SettingsRow
          {...setting("credits")}
          description={
            <T>
              Harp (formerly SealCode) is a fork of T3 Code by Theo Browne, Julius Marminge and the
              T3 Code contributors, released under the MIT license.
            </T>
          }
          control={
            <Button
              render={
                <a
                  href="https://github.com/pingdotgg/t3code"
                  rel="noreferrer noopener"
                  target="_blank"
                />
              }
              size="sm"
              variant="outline"
            >
              T3 Code on GitHub
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
