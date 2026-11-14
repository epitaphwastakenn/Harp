export type StudioCodeRisk = "mutation" | "irreversible";
export type StudioCodeLanguage = "luau" | "python";

export interface StudioCodeCall {
  readonly tool: string;
  readonly language: StudioCodeLanguage;
  readonly code: string;
  readonly risk: StudioCodeRisk;
  readonly peer: string;
}

const maxCodeChars = 20_000;

const specs = {
  execute_luau: { language: "luau", risk: "irreversible" },
  eval_server_runtime: { language: "luau", risk: "irreversible" },
  eval_client_runtime: { language: "luau", risk: "irreversible" },
  set_script_source: { language: "luau", risk: "mutation" },
  edit_script: { language: "luau", risk: "mutation" },
  blender: { language: "python", risk: "mutation" },
} as const;

export const studioCodeToolRisks: Readonly<Record<string, StudioCodeRisk>> = Object.fromEntries(
  Object.entries(specs).map(([tool, spec]) => [tool, spec.risk]),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

const bareToolName = (name: string) => name.split("__").at(-1) ?? name;

const codeOf = (tool: keyof typeof specs, input: Record<string, unknown>): string | undefined => {
  if (tool === "set_script_source") return text(input.source);
  if (tool === "blender") return text(input.script);
  if (tool === "edit_script") {
    if (!Array.isArray(input.edits)) return undefined;
    const added = input.edits.flatMap((edit) =>
      isRecord(edit) && typeof edit.new_string === "string" ? [edit.new_string] : [],
    );
    return text(added.join("\n\n"));
  }
  return text(input.code);
};

const peerOf = (tool: keyof typeof specs, input: Record<string, unknown>) => {
  if (tool === "blender") return "blender";
  if (tool === "eval_server_runtime") return "server";
  if (tool === "eval_client_runtime") return text(input.target) ?? "client-1";
  if (tool === "execute_luau") return text(input.target) ?? "edit";
  return "edit";
};

export const studioCodeOfCall = (toolName: string, input: unknown): StudioCodeCall | undefined => {
  const tool = bareToolName(toolName);
  if (!(tool in specs) || !isRecord(input)) return undefined;
  const key = tool as keyof typeof specs;
  const code = codeOf(key, input);
  if (code === undefined) return undefined;
  return {
    tool,
    language: specs[key].language,
    code: code.slice(0, maxCodeChars),
    risk: specs[key].risk,
    peer: peerOf(key, input),
  };
};

export const studioCodeConsequence = (call: Pick<StudioCodeCall, "risk" | "peer" | "tool">) => {
  if (call.tool === "blender") return "Runs Python in headless Blender on this computer";
  const where =
    call.peer === "edit"
      ? "the open place in Studio"
      : call.peer === "server"
        ? "the running playtest server"
        : `playtest ${call.peer}`;
  if (call.tool === "set_script_source" || call.tool === "edit_script") {
    return `Changes a script in ${where} (undoable in Studio)`;
  }
  return call.risk === "irreversible"
    ? `Runs code in ${where}; its changes may not be undoable`
    : `Runs code in ${where}`;
};
