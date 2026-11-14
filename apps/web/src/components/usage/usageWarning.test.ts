import type { ComposerUsage } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import {
  findUsageWarning,
  loadSeenUsageWarnings,
  rememberUsageWarning,
  usageWarningTitle,
} from "./usageWarning";

function usage(
  rows: ReadonlyArray<{ id: string; label: string; percent: number; reset?: string }>,
) {
  return {
    group: null,
    peakPercent: Math.max(...rows.map((row) => row.percent)),
    rows: rows.map((row) => ({
      label: row.label,
      usedPercent: row.percent,
      window: {
        id: row.id,
        label: row.label,
        kind: "session",
        usedPercent: row.percent,
        ...(row.reset ? { resetsAt: row.reset } : {}),
      },
    })),
  } as unknown as ComposerUsage;
}

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

describe("findUsageWarning", () => {
  it("ignores windows below the threshold", () => {
    expect(
      findUsageWarning(usage([{ id: "a", label: "Session", percent: 79 }]), "claude", new Set()),
    ).toBeNull();
  });

  it("picks the highest window at or above the threshold", () => {
    const warning = findUsageWarning(
      usage([
        { id: "a", label: "Session", percent: 80, reset: "2026-01-01T10:00:00Z" },
        { id: "b", label: "Weekly", percent: 91, reset: "2026-01-05T10:00:00Z" },
      ]),
      "claude",
      new Set(),
    );
    expect(warning?.label).toBe("Weekly");
    expect(warning?.percent).toBe(91);
  });

  it("skips windows already seen for the same reset but not for the next reset", () => {
    const first = findUsageWarning(
      usage([{ id: "a", label: "Session", percent: 85, reset: "2026-01-01T10:00:00Z" }]),
      "claude",
      new Set(),
    );
    const seen = new Set([first!.key]);
    expect(
      findUsageWarning(
        usage([{ id: "a", label: "Session", percent: 90, reset: "2026-01-01T10:00:00Z" }]),
        "claude",
        seen,
      ),
    ).toBeNull();
    expect(
      findUsageWarning(
        usage([{ id: "a", label: "Session", percent: 90, reset: "2026-01-01T15:00:00Z" }]),
        "claude",
        seen,
      ),
    ).not.toBeNull();
  });

  it("keys per provider instance", () => {
    const rows = usage([{ id: "a", label: "Session", percent: 85, reset: "2026-01-01T10:00:00Z" }]);
    const claude = findUsageWarning(rows, "claude", new Set());
    expect(findUsageWarning(rows, "codex", new Set([claude!.key]))).not.toBeNull();
  });

  it("returns null without usage", () => {
    expect(findUsageWarning(null, "claude", new Set())).toBeNull();
  });
});

describe("usageWarningTitle", () => {
  it("includes provider, window and reset time", () => {
    const title = usageWarningTitle(
      { key: "k", percent: 82, label: "Session", resetsAt: "2026-01-01T14:30:00Z" },
      "Claude",
      () => "at 14:30",
    );
    expect(title).toBe("You've used 82% of your Claude session limit; it resets at 14:30.");
  });

  it("omits the reset clause when unknown", () => {
    expect(
      usageWarningTitle(
        { key: "k", percent: 90, label: "Weekly", resetsAt: null },
        "Codex",
        () => "",
      ),
    ).toBe("You've used 90% of your Codex weekly limit.");
  });
});

describe("seen warning storage", () => {
  it("round-trips remembered keys", () => {
    const storage = memoryStorage();
    rememberUsageWarning(storage, new Set(), "a");
    const seen = loadSeenUsageWarnings(storage);
    expect(seen.has("a")).toBe(true);
  });

  it("survives corrupt or unavailable storage", () => {
    expect(loadSeenUsageWarnings(memoryStorage("{not json")).size).toBe(0);
    expect(loadSeenUsageWarnings(null).size).toBe(0);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadSeenUsageWarnings(throwing).size).toBe(0);
    expect(rememberUsageWarning(throwing, new Set(), "a").has("a")).toBe(true);
  });

  it("caps stored keys, dropping the oldest", () => {
    let seen = new Set<string>();
    const storage = memoryStorage();
    for (let index = 0; index < 60; index += 1) {
      seen = rememberUsageWarning(storage, seen, `k${index}`);
    }
    expect(seen.size).toBe(40);
    expect(seen.has("k0")).toBe(false);
    expect(seen.has("k59")).toBe(true);
  });
});
