import * as NodeServices from "@effect/platform-node/NodeServices";
import { ClaudeSettings } from "@t3tools/contracts";
import { vi } from "vite-plus/test";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { probeClaudeCapabilities } from "./ClaudeProvider.ts";

const sdk = vi.hoisted(() => ({
  abortedAtCall: [] as Array<boolean>,
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (input: { readonly options: { readonly abortController: AbortController } }) => {
    const { signal } = input.options.abortController;
    sdk.abortedAtCall.push(signal.aborted);
    return {
      initializationResult: async () => {
        if (signal.aborted) throw new Error("Operation aborted");
        return { commands: [] };
      },
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
        rate_limits_available: false,
        rate_limits: {},
      }),
    };
  },
}));

const decodeClaudeSettings = Schema.decodeEffect(ClaudeSettings);

it.effect("runs the same capability probe again without reusing an aborted controller", () =>
  Effect.gen(function* () {
    const probe = probeClaudeCapabilities(yield* decodeClaudeSettings({}), {
      HOME: "/nonexistent/t3-home",
    });
    const first = yield* probe.pipe(Effect.result);
    const second = yield* probe.pipe(Effect.result);
    assert.isTrue(Result.isSuccess(first));
    assert.isTrue(Result.isSuccess(second));
    assert.deepStrictEqual(sdk.abortedAtCall, [false, false]);
  }).pipe(Effect.provide(NodeServices.layer)),
);
