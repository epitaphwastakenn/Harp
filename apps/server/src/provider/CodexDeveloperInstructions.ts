import type { V2TurnStartParams__AdditionalContextEntry } from "effect-codex-app-server/schema";
import { buildRuntimeInstructions } from "@t3tools/provider-core/server/runtimeInstructions";

import {
  T3_CODE_BROWSER_TOOL_INSTRUCTIONS,
  T3_CODE_ORCHESTRATION_SECTIONS,
} from "@t3tools/provider-core/server/orchestrationInstructions";

/** Codex silently truncates additionalContext values over 1,000 tokens, counted as UTF-8 bytes / 4. */
export const CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES = 4_000;

export interface T3CodeToolAvailability {
  readonly browser: boolean;
}

const normalizeAvailability = (
  availability: boolean | T3CodeToolAvailability,
): T3CodeToolAvailability =>
  typeof availability === "boolean" ? { browser: availability } : availability;

/** Instructions for unavailable tools would steer the model away from its remaining automation. */
const toolInstructions = (availability: boolean | T3CodeToolAvailability): string => {
  const tools = normalizeAvailability(availability);
  return tools.browser ? T3_CODE_BROWSER_TOOL_INSTRUCTIONS : "";
};

export interface CodexRuntimeInfo {
  readonly model: string;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}

/** Keep this outside collaboration mode; model-catalog mode text overrides client developer_instructions. */
export function buildCodexAdditionalContext(
  runtime: CodexRuntimeInfo,
  toolsAvailable: boolean | T3CodeToolAvailability = true,
): Record<string, V2TurnStartParams__AdditionalContextEntry> {
  const tools = toolInstructions(toolsAvailable);
  // Split values to fit per-entry caps; number keys because Codex emits them in key order.
  return {
    ...Object.fromEntries(
      T3_CODE_ORCHESTRATION_SECTIONS.map((section, index) => [
        `t3_code_orchestration_${String(index + 1).padStart(2, "0")}`,
        { kind: "application" as const, value: section },
      ]),
    ),
    t3_code_runtime: {
      kind: "application",
      value: buildRuntimeInstructions({ harness: "Codex", ...runtime }),
    },
    ...(tools ? { t3_code_tools: { kind: "application", value: tools } } : {}),
  };
}

const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

const splitToByteCap = (text: string, cap: number): ReadonlyArray<string> => {
  const chunks: string[] = [];
  let current = "";
  const pushLongLine = (line: string) => {
    let piece = "";
    for (const char of line) {
      if (byteLength(piece + char) > cap) {
        chunks.push(piece);
        piece = "";
      }
      piece += char;
    }
    return piece;
  };
  for (const line of text.split("\n")) {
    const joined = current === "" ? line : `${current}\n${line}`;
    if (byteLength(joined) <= cap) {
      current = joined;
      continue;
    }
    if (current !== "") chunks.push(current);
    current = byteLength(line) <= cap ? line : pushLongLine(line);
  }
  if (current !== "") chunks.push(current);
  return chunks;
};

/** Harp's standing instructions as developer context, split to fit the per-entry cap. */
export function buildCodexHarnessContext(
  instructions: string | undefined,
): Record<string, V2TurnStartParams__AdditionalContextEntry> {
  if (instructions === undefined || instructions.trim() === "") return {};
  return Object.fromEntries(
    splitToByteCap(instructions.trim(), CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES).map(
      (chunk, index) => [
        `harp_instructions_${String(index + 1).padStart(2, "0")}`,
        { kind: "application" as const, value: chunk },
      ],
    ),
  );
}
