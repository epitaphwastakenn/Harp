import * as NodeAssert from "node:assert/strict";

import { describe, it } from "vite-plus/test";

import {
  buildCodexAdditionalContext,
  buildCodexHarnessContext,
  CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES,
} from "./CodexDeveloperInstructions.ts";

describe("buildCodexHarnessContext", () => {
  it("splits Harp's instructions into ordered entries under the cap, losing nothing", () => {
    const limit = CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES;
    const lines = Array.from({ length: 300 }, (_, index) => `- rule ${String(index)} ✓ ação`);
    const longLine = "ç".repeat(limit);
    const text = [...lines, longLine, "last rule"].join("\n");
    const context = buildCodexHarnessContext(text);
    const keys = Object.keys(context);
    NodeAssert.ok(keys.length > 2);
    NodeAssert.deepEqual(keys, keys.toSorted());
    for (const entry of Object.values(context)) {
      NodeAssert.equal(entry.kind, "application");
      NodeAssert.ok(Buffer.byteLength(entry.value, "utf8") <= limit);
    }
    NodeAssert.equal(
      Object.values(context)
        .map((entry) => entry.value)
        .join("")
        .replaceAll("\n", ""),
      text.replaceAll("\n", ""),
    );
    NodeAssert.deepEqual(buildCodexHarnessContext("  "), {});
    NodeAssert.deepEqual(buildCodexHarnessContext(undefined), {});
  });
});

describe("buildCodexAdditionalContext", () => {
  describe.each([
    { model: "custom-model", modelName: "Custom 🦊 Model", reasoningEffort: "xhigh" },
  ])("with runtime $model", (runtime) => {
    it.each([undefined, { browser: true }])(
      "keeps every entry within Codex's per-entry cap with tools %j",
      (availability) => {
        const context = buildCodexAdditionalContext(runtime, availability);

        for (const [key, entry] of Object.entries(context)) {
          // Codex counts ceil(UTF-8 bytes / 4) tokens, excluding keys and wrappers.
          const bytes = Buffer.byteLength(entry.value, "utf8");
          const limit = CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES;
          NodeAssert.ok(
            bytes <= limit,
            `${key}: ${bytes} UTF-8 bytes exceeds Codex's ${limit}-byte per-entry cap by ${bytes - limit} bytes; split the instructions into separate entries to avoid silent truncation`,
          );
        }
      },
    );
  });
});

describe("Codex runtime context", () => {
  it("flattens multiline metadata into single-line runtime info", () => {
    const instructions = runtimeInstructions({
      model: "gpt\n5.3\ncodex",
      reasoningEffort: " high\neffort ",
    });

    NodeAssert.match(instructions, /as gpt 5\.3 codex with high effort reasoning effort/);
    NodeAssert.doesNotMatch(instructions, /<runtime_info>[^<]*\n/);
  });
});

describe("Codex orchestration context", () => {
  it("routes subagents native first, delegate_task for the rest", () => {
    const orchestration = Object.entries(buildCodexAdditionalContext({ model: "gpt-6.1-sol" }))
      .filter(([key]) => key.startsWith("t3_code_orchestration_"))
      .map(([, entry]) => entry.value)
      .join("\n");

    NodeAssert.ok(orchestration.includes("use your native tool when the child uses your provider"));
    NodeAssert.ok(orchestration.includes("`run_in_background:false`"));
    NodeAssert.ok(orchestration.includes("A native type on another provider's model"));
    NodeAssert.ok(
      orchestration.includes("Background agent: `delegate_task`, never a background `Agent`."),
    );
    NodeAssert.ok(
      orchestration.includes("Every new delegate review or re-check is a new `delegate_task`"),
    );
    NodeAssert.ok(orchestration.includes("never a `t3_thread_send`"));
    NodeAssert.ok(!orchestration.includes("inheritedOptions"));
    NodeAssert.ok(!orchestration.includes("Prefer native"));
    // The ACP terminal fallback is ACP-only; Codex agents never need it.
    NodeAssert.ok(!orchestration.includes("acp-mcp-call"));
  });
});

function runtimeInstructions(runtime: Parameters<typeof buildCodexAdditionalContext>[0]) {
  return buildCodexAdditionalContext(runtime).t3_code_runtime!.value;
}
