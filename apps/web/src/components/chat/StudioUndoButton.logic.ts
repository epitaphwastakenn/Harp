import type { StudioUndoCounts } from "@t3tools/contracts";

const labels: ReadonlyArray<readonly [keyof StudioUndoCounts, string, string]> = [
  ["scripts", "script write", "script writes"],
  ["files", "Rojo file write", "Rojo file writes"],
  ["properties", "property change", "property changes"],
  ["created", "created instance", "created instances"],
  ["deleted", "removed instance", "removed instances"],
  ["builds", "build", "builds"],
];

export function undoCountLines(counts: StudioUndoCounts): ReadonlyArray<string> {
  return labels.flatMap(([key, one, many]) =>
    counts[key] > 0 ? [`${counts[key]} ${counts[key] === 1 ? one : many}`] : [],
  );
}

export function undoTotal(counts: StudioUndoCounts): number {
  return labels.reduce((sum, [key]) => sum + counts[key], 0);
}
