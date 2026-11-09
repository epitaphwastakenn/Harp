import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";
import { GlobalMcpStatus } from "./mcp.ts";
import { RobloxStudioMode } from "./settings.ts";

/** One place the Studio plugin connected, as the bridge reports it. */
export const RobloxStudioPlace = Schema.Struct({
  instanceId: Schema.String,
  placeKey: Schema.optionalKey(Schema.String),
  role: Schema.optionalKey(Schema.String),
  placeId: Schema.optionalKey(Schema.Number),
  placeName: Schema.optionalKey(Schema.String),
  isRunning: Schema.optionalKey(Schema.Boolean),
  pluginVersion: Schema.optionalKey(Schema.String),
  paused: Schema.optionalKey(Schema.Boolean),
  readOnly: Schema.optionalKey(Schema.Boolean),
  luauOff: Schema.optionalKey(Schema.Boolean),
  toolsOff: Schema.optionalKey(Schema.Number),
});
export type RobloxStudioPlace = typeof RobloxStudioPlace.Type;

export const RobloxStudioBridgeStatus = Schema.Struct({
  state: Schema.String,
  version: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  restarts: Schema.Number,
  /** The plugin file was just replaced: a Studio opened earlier must be restarted to load it. */
  pluginUpdated: Schema.Boolean,
  pluginProblem: Schema.optionalKey(Schema.String),
  /** A Studio connected with a plugin of another version and was refused. */
  pluginRejected: Schema.optionalKey(Schema.String),
  pluginConnected: Schema.Boolean,
  places: Schema.Array(RobloxStudioPlace),
  warning: Schema.optionalKey(Schema.String),
});
export type RobloxStudioBridgeStatus = typeof RobloxStudioBridgeStatus.Type;

/** Something in Roblox Studio the user should hear about: Studio went away, or a playtest errored. */
export const RobloxStudioAlert = Schema.Struct({
  kind: Schema.Literals(["disconnected", "playtest_error"]),
  instanceId: Schema.String,
  placeName: Schema.String,
  /** Text from the place (an error message): shown to the user, never treated as instructions. */
  message: Schema.String,
  /** Errors folded into this alert since the last one for the place. */
  count: Schema.Number,
  at: Schema.Number,
});
export type RobloxStudioAlert = typeof RobloxStudioAlert.Type;

export const RobloxProjectDetection = Schema.Struct({
  applies: Schema.Boolean,
  reason: Schema.Literals([
    "studio-off",
    "user-choice",
    "all-projects",
    "game-icon",
    "project-files",
    "folder-name",
    "studio-place",
    "studio-open",
    "no-signal",
  ]),
  detail: Schema.optionalKey(Schema.String),
});
export type RobloxProjectDetection = typeof RobloxProjectDetection.Type;

export const RobloxStudioStatus = Schema.Struct({
  mode: RobloxStudioMode,
  studioInstalled: Schema.Boolean,
  officialMcpAvailable: Schema.Boolean,
  /** Status of every MCP server these settings run, by the ids Harp gave them. */
  servers: Schema.Array(GlobalMcpStatus),
  bridge: Schema.optionalKey(RobloxStudioBridgeStatus),
  blender: Schema.Struct({
    executable: Schema.optionalKey(Schema.String),
    version: Schema.optionalKey(Schema.String),
    problem: Schema.optionalKey(Schema.String),
  }),
  blenderMcp: Schema.Struct({
    command: Schema.optionalKey(Schema.String),
    args: Schema.Array(Schema.String),
    problem: Schema.optionalKey(Schema.String),
  }),
});
export type RobloxStudioStatus = typeof RobloxStudioStatus.Type;

export const RojoServerState = Schema.Literals(["stopped", "starting", "running", "failed"]);
export type RojoServerState = typeof RojoServerState.Type;

export const RojoProjectStatus = Schema.Struct({
  file: Schema.String,
  label: Schema.String,
  kind: Schema.Literals(["place", "model"]),
  port: Schema.Number,
  state: RojoServerState,
  startedByHarp: Schema.Boolean,
  message: Schema.optionalKey(Schema.String),
});
export type RojoProjectStatus = typeof RojoProjectStatus.Type;

export const RojoWorkspaceStatus = Schema.Struct({
  layout: Schema.Literals(["none", "single", "multi"]),
  rojoFound: Schema.Boolean,
  projects: Schema.Array(RojoProjectStatus),
});
export type RojoWorkspaceStatus = typeof RojoWorkspaceStatus.Type;

export const RojoControlInput = Schema.Struct({
  projectId: ProjectId,
  action: Schema.Literals(["start", "stop"]),
  file: Schema.optionalKey(Schema.String),
});
export type RojoControlInput = typeof RojoControlInput.Type;
