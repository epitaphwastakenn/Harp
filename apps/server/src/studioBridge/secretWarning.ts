import { scanForSecrets, secretWarning } from "@t3tools/shared/secretScan";
import { studioCodeOfCall } from "@t3tools/shared/studioCode";

import type { StudioToolResult } from "./toolResult.ts";

export const withSecretWarning = (
  tool: string,
  args: unknown,
  result: StudioToolResult,
): StudioToolResult => {
  if (tool === "blender") return result;
  const call = studioCodeOfCall(tool, args);
  const warning = call === undefined ? undefined : secretWarning(scanForSecrets(call.code));
  return warning === undefined
    ? result
    : { ...result, content: [...result.content, { type: "text", text: warning }] };
};
