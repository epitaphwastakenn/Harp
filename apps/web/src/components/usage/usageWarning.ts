import type { ComposerUsage, ComposerUsageRow } from "@t3tools/shared/usageLimits";

export const usageWarningThreshold = 80;

const storageKey = "harp:usage-warnings-seen";
const maxStoredKeys = 40;

export interface UsageWarning {
  readonly key: string;
  readonly percent: number;
  readonly label: string;
  readonly resetsAt: string | null;
}

export function usageWarningKey(instanceId: string, row: ComposerUsageRow): string {
  return `${instanceId}|${row.window.id}|${row.window.resetsAt ?? ""}`;
}

export function findUsageWarning(
  usage: ComposerUsage | null,
  instanceId: string,
  seen: ReadonlySet<string>,
): UsageWarning | null {
  if (usage === null) return null;
  let worst: UsageWarning | null = null;
  for (const row of usage.rows) {
    if (row.usedPercent < usageWarningThreshold) continue;
    const key = usageWarningKey(instanceId, row);
    if (seen.has(key)) continue;
    if (worst === null || row.usedPercent > worst.percent) {
      worst = {
        key,
        percent: row.usedPercent,
        label: row.window.label,
        resetsAt: row.window.resetsAt ?? null,
      };
    }
  }
  return worst;
}

export function usageWarningTitle(
  warning: UsageWarning,
  providerName: string,
  formatReset: (resetsAt: string) => string,
): string {
  const base = `You've used ${warning.percent}% of your ${providerName} ${warning.label.toLowerCase()} limit`;
  if (warning.resetsAt === null) return `${base}.`;
  const reset = formatReset(warning.resetsAt);
  return reset ? `${base}; it resets ${reset}.` : `${base}.`;
}

export function loadSeenUsageWarnings(storage: Pick<Storage, "getItem"> | null): Set<string> {
  try {
    const raw = storage?.getItem(storageKey);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set();
  }
}

export function rememberUsageWarning(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  seen: ReadonlySet<string>,
  key: string,
): Set<string> {
  const next = new Set(seen);
  next.delete(key);
  next.add(key);
  const trimmed = new Set([...next].slice(-maxStoredKeys));
  try {
    storage?.setItem(storageKey, JSON.stringify([...trimmed]));
  } catch {
    return trimmed;
  }
  return trimmed;
}

export function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
