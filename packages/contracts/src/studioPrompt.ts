import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const STUDIO_PROMPT_MAX_TEXT_CHARS = 20_000;
export const STUDIO_PROMPT_MAX_ATTACHMENTS = 12;
export const STUDIO_PROMPT_MAX_ATTACHMENT_CHARS = 60_000;

/** An instance the user attached in Studio; its text is place data, never instructions. */
export const StudioPromptAttachment = Schema.Struct({
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(1_000)),
  className: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  details: Schema.String.check(Schema.isMaxLength(STUDIO_PROMPT_MAX_ATTACHMENT_CHARS)),
});
export type StudioPromptAttachment = typeof StudioPromptAttachment.Type;

export const StudioPromptTargetChoice = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("thread"), threadId: TrimmedNonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("new") }),
]);
export type StudioPromptTargetChoice = typeof StudioPromptTargetChoice.Type;

export const StudioPromptSendRequest = Schema.Struct({
  sessionToken: TrimmedNonEmptyString,
  requestId: TrimmedNonEmptyString.check(Schema.isMaxLength(64), Schema.isPattern(/^[a-z0-9-]+$/i)),
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(STUDIO_PROMPT_MAX_TEXT_CHARS)),
  target: StudioPromptTargetChoice,
  attachments: Schema.Array(StudioPromptAttachment).check(
    Schema.isMaxLength(STUDIO_PROMPT_MAX_ATTACHMENTS),
  ),
});
export type StudioPromptSendRequest = typeof StudioPromptSendRequest.Type;

export const StudioPromptState = Schema.Literals(["idle", "working", "waiting", "done", "failed"]);
export type StudioPromptState = typeof StudioPromptState.Type;

/** A thread the plugin can send to; `linked` means its agent already worked on this place. */
export const StudioPromptTarget = Schema.Struct({
  threadId: Schema.String,
  title: Schema.String,
  projectTitle: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  state: StudioPromptState,
  linked: Schema.Boolean,
  updatedAt: Schema.String,
});
export type StudioPromptTarget = typeof StudioPromptTarget.Type;

export const StudioPromptTargets = Schema.Struct({
  targets: Schema.Array(StudioPromptTarget),
  defaultThreadId: Schema.NullOr(Schema.String),
  canCreate: Schema.Boolean,
});
export type StudioPromptTargets = typeof StudioPromptTargets.Type;

export const StudioPromptSendResult = Schema.Struct({
  threadId: Schema.String,
  title: Schema.String,
  delivery: Schema.Literals(["started", "queued", "steered", "restarted"]),
});
export type StudioPromptSendResult = typeof StudioPromptSendResult.Type;

export const StudioPromptStatus = Schema.Struct({
  threadId: Schema.String,
  title: Schema.String,
  state: StudioPromptState,
  /** The latest visible agent text, shortened for the panel. */
  reply: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type StudioPromptStatus = typeof StudioPromptStatus.Type;
