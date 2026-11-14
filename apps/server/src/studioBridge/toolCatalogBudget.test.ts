import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { RobloxStudioConfig } from "../roblox/RobloxStudioConfig.ts";
import * as RojoWorkspaces from "../roblox/RojoWorkspaces.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as StudioBridge from "./StudioBridge.ts";
import { handleMcpMessage } from "./studioMcp.ts";
import * as StudioTools from "./StudioTools.ts";

const layer = StudioTools.layer.pipe(
  Layer.provideMerge(StudioBridge.layer),
  Layer.provide(ServerSettingsService.layerTest()),
  Layer.provide(Layer.succeed(RobloxStudioConfig, RobloxStudioConfig.defaultValue())),
  Layer.provide(RojoWorkspaces.layerNone),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const maxCatalogBytes = 63_200;
const maxDescriptionChars = 2_050;

const bumpProcedure =
  "Every Studio tool is sent to the model on every turn. Trim descriptions and schemas first; if the growth is deliberate, raise maxCatalogBytes / maxDescriptionChars in toolCatalogBudget.test.ts to the new size plus 25% and say why in the commit.";

describe("Studio tool catalog budget", () => {
  it.effect("keeps the advertised tool list within budget", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const bridge = yield* StudioBridge.StudioBridge;
      const listed = yield* handleMcpMessage(
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        tools,
        bridge.markAgentLinked,
      );
      const sent = (
        listed as {
          body: { result: { tools: Array<{ name: string; description: string }> } };
        }
      ).body.result.tools;
      const bytes = Buffer.byteLength(JSON.stringify(sent), "utf8");
      const longest = sent.reduce((best, tool) =>
        tool.description.length > best.description.length ? tool : best,
      );
      expect(
        bytes,
        `${String(sent.length)} tools serialize to ${String(bytes)} bytes. ${bumpProcedure}`,
      ).toBeLessThanOrEqual(maxCatalogBytes);
      expect(
        longest.description.length,
        `${longest.name} has a ${String(longest.description.length)}-character description. ${bumpProcedure}`,
      ).toBeLessThanOrEqual(maxDescriptionChars);
    }).pipe(Effect.provide(layer)),
  );
});
