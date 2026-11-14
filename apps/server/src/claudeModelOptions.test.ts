import { describe, expect, it } from "@effect/vitest";

import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";

import { compileClaudeModelSelection } from "./claudeModelOptions.ts";
import {
  BUNDLED_CLAUDE_MODEL_CATALOG,
  scopeClaudeModelCatalog,
} from "./provider/ClaudeModelCatalog.ts";

const selection = (
  model: string,
  options: NonNullable<ModelSelection["options"]>,
): ModelSelection => ({
  instanceId: ProviderInstanceId.make("claude_test"),
  model,
  options,
});

describe("compileClaudeModelSelection", () => {
  it("compiles context, effort, and settings together", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-opus-4-6", [
          { id: "contextWindow", value: "1m" },
          { id: "effort", value: "max" },
          { id: "fastMode", value: true },
        ]),
      ),
    ).toMatchObject({
      apiModelId: "claude-opus-4-6[1m]",
      effort: "max",
      settings: { fastMode: true },
    });
  });

  it("resumes a retired ultrathink selection on the strongest SDK effort", () => {
    const compiled = compileClaudeModelSelection(
      selection("claude-opus-5-5", [{ id: "effort", value: "ultrathink" }]),
    );
    expect(compiled.effort).toBe("max");
    expect(compiled.settings).not.toHaveProperty("ultracode");
  });

  it.each(["low", "medium", "high", "xhigh", "max"])(
    "turns on ultracode at %s effort without touching the effort",
    (effort) => {
      const compiled = compileClaudeModelSelection(
        selection("claude-opus-5-5", [
          { id: "effort", value: effort },
          { id: "ultracode", value: true },
        ]),
      );
      expect(compiled.effort).toBe(effort);
      expect(compiled.settings).toMatchObject({ ultracode: true });
    },
  );

  it("compiles a saved Ultracode effort to what it always did", () => {
    const legacy = compileClaudeModelSelection(
      selection("claude-opus-5-5", [{ id: "effort", value: "ultracode" }]),
    );
    const current = compileClaudeModelSelection(
      selection("claude-opus-5-5", [
        { id: "effort", value: "xhigh" },
        { id: "ultracode", value: true },
      ]),
    );
    expect(legacy).toMatchObject({
      effort: "xhigh",
      settings: { fastMode: false, ultracode: true },
    });
    expect(legacy.queryIdentity).toBe(current.queryIdentity);
  });

  it("offers ultracode on the models the installed Claude Code supports and not on older ones", () => {
    const withUltracode = (model: string) =>
      compileClaudeModelSelection(selection(model, [{ id: "ultracode", value: true }])).settings;
    for (const model of [
      "claude-fable-5-1",
      "claude-opus-5-5",
      "claude-opus-4-7",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]) {
      expect(withUltracode(model)).toHaveProperty("ultracode", true);
    }
    for (const model of ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"]) {
      expect(withUltracode(model)).not.toHaveProperty("ultracode");
    }
  });

  it("runs Ultracode at the chosen effort and reads the old Ultracode effort as xhigh", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-opus-5-5", [
          { id: "effort", value: "high" },
          { id: "ultracode", value: true },
        ]),
      ),
    ).toMatchObject({ effort: "high", settings: { ultracode: true } });
    expect(
      compileClaudeModelSelection(
        selection("claude-opus-5-5", [{ id: "effort", value: "ultracode" }]),
      ),
    ).toMatchObject({ effort: "xhigh", settings: { ultracode: true } });
    const legacyTurnedOff = compileClaudeModelSelection(
      selection("claude-opus-5-5", [
        { id: "effort", value: "ultracode" },
        { id: "ultracode", value: false },
      ]),
    );
    expect(legacyTurnedOff.effort).toBe("xhigh");
    expect(legacyTurnedOff.settings.ultracode).toBe(false);
    expect(
      compileClaudeModelSelection(selection("claude-opus-5-5", [{ id: "effort", value: "high" }]))
        .settings,
    ).not.toHaveProperty("ultracode");
  });

  it("keeps old Ultracode defaults and selections at Extra High on custom models", () => {
    const customModel = (slug: string, choices: ReadonlyArray<string>) => ({
      slug,
      name: slug,
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Reasoning",
            type: "select" as const,
            currentValue: "ultracode",
            options: choices.map((id) => ({ id, label: id, isDefault: id === "ultracode" })),
          },
        ],
      },
    });
    const catalog = scopeClaudeModelCatalog(BUNDLED_CLAUDE_MODEL_CATALOG, [
      customModel("claude-custom-tuned", ["high", "xhigh", "ultracode"]),
      customModel("claude-custom-no-xhigh", ["high", "ultracode"]),
    ]);

    for (const model of ["claude-custom-tuned", "claude-custom-no-xhigh"]) {
      expect(compileClaudeModelSelection(selection(model, []), catalog)).toMatchObject({
        effort: "xhigh",
        settings: { ultracode: true },
      });
      expect(
        compileClaudeModelSelection(
          selection(model, [{ id: "effort", value: "ultracode" }]),
          catalog,
        ),
      ).toMatchObject({ effort: "xhigh", settings: { ultracode: true } });
    }
  });

  it("keeps explicit effort for models missing from the local catalog", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-pool-model-not-in-catalog", [{ id: "effort", value: "max" }]),
      ).effort,
    ).toBe("max");
    expect(
      compileClaudeModelSelection(selection("claude-pool-model-not-in-catalog", [])).effort,
    ).toBeUndefined();
  });
});
