import type { ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { McpThreadCaller } from "./McpInvocationContext.ts";

export interface McpToolVisibilityShape {
  /** Global MCP servers whose tools this thread's agent does not get. */
  readonly hiddenServers: (
    thread: Pick<McpThreadCaller, "threadId">,
  ) => Effect.Effect<ReadonlySet<string>>;
  readonly hiddenServersForProject: (projectId: ProjectId) => Effect.Effect<ReadonlySet<string>>;
  readonly changes: Stream.Stream<void>;
}

export class McpToolVisibility extends Context.Service<McpToolVisibility, McpToolVisibilityShape>()(
  "t3/mcp/McpToolVisibility",
) {}
