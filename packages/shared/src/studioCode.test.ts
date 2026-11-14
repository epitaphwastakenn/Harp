import { describe, expect, it } from "vite-plus/test";

import { studioCodeConsequence, studioCodeOfCall } from "./studioCode.ts";

describe("studioCodeOfCall", () => {
  it("reads the code of tools that run or write it, with or without an MCP prefix", () => {
    expect(studioCodeOfCall("mcp__studio__execute_luau", { code: "print(1)" })).toEqual({
      tool: "execute_luau",
      language: "luau",
      code: "print(1)",
      risk: "irreversible",
      peer: "edit",
    });
    expect(studioCodeOfCall("eval_client_runtime", { code: "x", target: "client-2" })?.peer).toBe(
      "client-2",
    );
    expect(studioCodeOfCall("set_script_source", { source: "return 1" })?.risk).toBe("mutation");
    expect(studioCodeOfCall("blender", { script: "import bpy" })?.language).toBe("python");
    expect(
      studioCodeOfCall("edit_script", {
        edits: [
          { old_string: "a", new_string: "b" },
          { old_string: "c", new_string: "d" },
        ],
      })?.code,
    ).toBe("b\n\nd");
  });

  it("ignores other tools and empty code", () => {
    expect(studioCodeOfCall("get_script_source", { code: "x" })).toBeUndefined();
    expect(studioCodeOfCall("execute_luau", { code: "  " })).toBeUndefined();
  });

  it("describes the consequence by risk and peer", () => {
    expect(
      studioCodeConsequence({ tool: "execute_luau", risk: "irreversible", peer: "server" }),
    ).toBe("Runs code in the running playtest server; its changes may not be undoable");
    expect(studioCodeConsequence({ tool: "edit_script", risk: "mutation", peer: "edit" })).toBe(
      "Changes a script in the open place in Studio (undoable in Studio)",
    );
  });
});
