import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** A folder is the name its threads share inside a project; it has no record of its own. */
export const ThreadFolderName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.makeFilter((value) =>
    /[\p{Cc}]/u.test(value) ? "A thread folder name must be a single line of text." : true,
  ),
);
export type ThreadFolderName = typeof ThreadFolderName.Type;
