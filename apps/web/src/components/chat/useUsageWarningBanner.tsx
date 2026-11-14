import type { EnvironmentId, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import { composerUsage } from "@t3tools/shared/usageLimits";
import { GaugeIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import {
  browserStorage,
  findUsageWarning,
  loadSeenUsageWarnings,
  rememberUsageWarning,
  usageWarningTitle,
  type UsageWarning,
} from "../usage/usageWarning";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

/**
 * One dismissible notice per provider, window and reset when a running turn sees a
 * subscription window past the warning threshold. Silent when the composer meter has no windows.
 */
export function useUsageWarningBanner(input: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider | null;
  readonly model: string | null;
  readonly running: boolean;
}): ComposerBannerStackItem | null {
  const { environmentId, instanceId, provider, model, running } = input;
  const settings = useEnvironmentSettings(environmentId);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
    reportDefect: false,
  });
  const now = Date.parse(`${useNowMinute()}Z`);
  const [seen, setSeen] = useState(() => loadSeenUsageWarnings(browserStorage()));
  const [active, setActive] = useState<UsageWarning | null>(null);

  const wasRunning = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the server for fresh subscription usage once when a turn starts
  useEffect(() => {
    if (running && !wasRunning.current)
      void refreshProviders({ environmentId, input: { instanceId } });
    wasRunning.current = running;
  }, [running, refreshProviders, environmentId, instanceId]);

  const candidate = running
    ? findUsageWarning(composerUsage(provider, model, now), String(instanceId), seen)
    : null;
  if (!running && active !== null) setActive(null);
  if (candidate !== null && active?.key !== candidate.key) {
    setActive(candidate);
    setSeen((current) => rememberUsageWarning(browserStorage(), current, candidate.key));
  }

  if (active === null) return null;
  const providerName = provider?.displayName?.trim() || String(provider?.driver ?? "provider");
  return {
    id: `usage-warning:${active.key}`,
    variant: "warning",
    icon: <GaugeIcon />,
    title: usageWarningTitle(active, providerName, (resetsAt) => {
      const text = formatUpcomingTimestamp(resetsAt, settings.timestampFormat);
      return text.startsWith("tomorrow") ? text : `at ${text}`;
    }),
    dismissLabel: "Dismiss usage warning",
    onDismiss: () => setActive(null),
  };
}
