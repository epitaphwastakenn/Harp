import { studioCodeToolRisks } from "@t3tools/shared/studioCode";
import { describe, expect, it } from "vite-plus/test";

import { withSecretWarning } from "./secretWarning.ts";

const ok = { content: [{ type: "text" as const, text: "{}" }] };
const key = `AKIAIOSFODNN7EXAMPLE`;

describe("withSecretWarning", () => {
  it("appends a warning to Luau runs and script writes that hold a key", () => {
    const run = withSecretWarning("execute_luau", { code: `local k = "${key}"` }, ok);
    expect(run.content).toHaveLength(2);
    expect(run.content[1]).toMatchObject({ text: expect.stringContaining("an AWS access key") });
    const write = withSecretWarning("set_script_source", { source: `x = "${key}"` }, ok);
    expect(write.content).toHaveLength(2);
    const edit = withSecretWarning(
      "edit_script",
      { edits: [{ old_string: "a", new_string: `"${key}"` }] },
      ok,
    );
    expect(edit.content).toHaveLength(2);
  });

  it("leaves clean code, reads and Blender alone", () => {
    expect(withSecretWarning("execute_luau", { code: "print(1)" }, ok)).toBe(ok);
    expect(withSecretWarning("get_script_source", { code: `"${key}"` }, ok)).toBe(ok);
    expect(withSecretWarning("blender", { script: `"${key}"` }, ok)).toBe(ok);
  });

  it("knows the tools that run or write code", () => {
    expect(Object.keys(studioCodeToolRisks).toSorted()).toEqual([
      "blender",
      "edit_script",
      "eval_client_runtime",
      "eval_server_runtime",
      "execute_luau",
      "set_script_source",
    ]);
  });
});
