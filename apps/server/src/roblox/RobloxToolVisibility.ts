import type { ProjectId, ServerSettings as ServerSettingsContract } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { isStudioRestricted } from "@t3tools/shared/studioControls";

import { McpCallPolicy } from "../mcp/McpCallPolicy.ts";
import { McpToolVisibility } from "../mcp/McpToolVisibility.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as StudioBridge from "../studioBridge/StudioBridge.ts";
import {
  policyFromControls,
  studioControlsMetaKey,
  studioWorkspaceMetaKey,
} from "../studioBridge/studioControls.ts";
import {
  hiddenOfficialTools,
  OFFICIAL_SERVER_ID,
  RobloxStudioConfig,
  robloxProjectTarget,
  STUDIO_BRIDGE_SERVER_ID,
} from "./RobloxStudioConfig.ts";

const robloxProjectModes = (settings: ServerSettingsContract) =>
  Object.entries(settings.projectSettingsOverrides)
    .flatMap(([id, entry]) => (entry.robloxProject ? [`${id}:${entry.robloxProject}`] : []))
    .toSorted()
    .join();

/** Hides the Roblox servers from threads of projects that are not Roblox games. */
const visibilityLayer = Layer.effect(
  McpToolVisibility,
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    const roblox = yield* RobloxStudioConfig;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const projects = yield* ProjectService.ProjectService;
    const studioBridge = yield* Effect.serviceOption(StudioBridge.StudioBridge);
    const openPlaces = Option.isSome(studioBridge) ? studioBridge.value.peers : Effect.succeed([]);
    const noneHidden = Effect.orElseSucceed((): ReadonlySet<string> => new Set());
    return {
      changes: settings.streamChanges.pipe(
        Stream.changesWith(
          (left, right) =>
            left.robloxStudio.scope === right.robloxStudio.scope &&
            left.robloxStudio.officialMcpAlongside === right.robloxStudio.officialMcpAlongside &&
            robloxProjectModes(left) === robloxProjectModes(right),
        ),
        Stream.drop(1),
        Stream.as(undefined),
      ),
      hiddenServers: Effect.fn("RobloxToolVisibility.hiddenServers")(function* (thread) {
        const current = yield* settings.getSettings;
        const shell = yield* threads.getThreadShell(thread.threadId);
        const project =
          shell === null
            ? undefined
            : Option.getOrUndefined(yield* projects.getById(shell.projectId));
        const hidden = yield* roblox.hiddenServerIds(
          current,
          project === undefined
            ? { workspaceRoot: undefined }
            : robloxProjectTarget(current, project, yield* openPlaces),
        );
        return isStudioRestricted(shell?.studioControls) &&
          current.mcpServers[OFFICIAL_SERVER_ID] === undefined
          ? new Set([...hidden, OFFICIAL_SERVER_ID])
          : hidden;
      }, noneHidden),
      hiddenServersForProject: Effect.fn("RobloxToolVisibility.hiddenServersForProject")(function* (
        projectId,
      ) {
        const current = yield* settings.getSettings;
        const project = Option.getOrUndefined(yield* projects.getById(projectId));
        return yield* roblox.hiddenServerIds(
          current,
          project === undefined
            ? { workspaceRoot: undefined }
            : robloxProjectTarget(current, project, yield* openPlaces),
        );
      }, noneHidden),
      hiddenTools: settings.getSettings.pipe(Effect.map(hiddenOfficialTools), noneHidden),
    };
  }),
);

const callPolicyLayer = Layer.effect(
  McpCallPolicy,
  Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    const projects = yield* ProjectService.ProjectService;
    const workspaceRootOf = (projectId: ProjectId) =>
      projects.getById(projectId).pipe(
        Effect.map((project) => Option.getOrUndefined(project)?.workspaceRoot),
        Effect.orElseSucceed(() => undefined),
      );
    return {
      forCall: Effect.fn("McpCallPolicy.forCall")(function* ({ thread, serverId }) {
        if (serverId !== STUDIO_BRIDGE_SERVER_ID) return { _tag: "Allow" } as const;
        return yield* Effect.gen(function* () {
          const shell = yield* threads.getThreadShell(thread.threadId);
          if (shell === null) {
            return {
              _tag: "Refuse",
              message: "Harp could not find this thread, so the Studio call was refused.",
            } as const;
          }
          const workspaceRoot = yield* workspaceRootOf(shell.projectId);
          return {
            _tag: "Allow",
            meta: {
              [studioControlsMetaKey]: policyFromControls(shell.studioControls),
              ...(workspaceRoot === undefined ? {} : { [studioWorkspaceMetaKey]: workspaceRoot }),
            },
          } as const;
        }).pipe(
          Effect.orElseSucceed(
            () =>
              ({
                _tag: "Refuse",
                message:
                  "Harp could not read this thread's Studio controls, so the Studio call was refused. Try again.",
              }) as const,
          ),
        );
      }),
    };
  }),
);

export const layer = Layer.merge(visibilityLayer, callPolicyLayer);
