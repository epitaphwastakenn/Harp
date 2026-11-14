import { parseInstancePath } from "@t3tools/shared/instancePath";
import * as DateTime from "effect/DateTime";

export type RojoProjectKind = "place" | "model";

export interface RojoProject {
  readonly file: string;
  readonly name: string;
  readonly label: string;
  readonly kind: RojoProjectKind;
  readonly port: number;
  readonly placeIds: ReadonlyArray<number>;
  readonly tree: RojoTreeNode;
}

export type RojoTreeNode = { readonly [key: string]: unknown };

export type RojoLayout = "none" | "single" | "multi";

const defaultRojoPort = 34872;
export const maxRojoScanDepth = 3;
export const maxRojoScannedFolders = 400;

const skippedRojoFolder =
  /^(?:\..*|node_modules|Packages|DevPackages|ServerPackages|_Index|dist|build|out|target|vendor|__pycache__|backups?|archived?)$/i;

const projectFile = /^(?!tsconfig\.).+\.project\.json$/i;

const scriptSuffixes = [
  ".luau",
  ".lua",
  ".server.luau",
  ".server.lua",
  ".client.luau",
  ".client.lua",
  ".plugin.luau",
  ".plugin.lua",
  ".legacy.luau",
  ".legacy.lua",
  ".local.luau",
  ".local.lua",
];

export const isRojoProjectFile = (name: string) => projectFile.test(name);

export const shouldScanRojoFolder = (name: string) => !skippedRojoFolder.test(name);

const isNode = (value: unknown): value is RojoTreeNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const positiveInt = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536
    ? value
    : undefined;

export interface ParsedRojoProject {
  readonly file: string;
  readonly name: string;
  readonly kind: RojoProjectKind;
  readonly servePort: number | undefined;
  readonly placeIds: ReadonlyArray<number>;
  readonly tree: RojoTreeNode;
}

export const parseRojoProject = (file: string, text: string): ParsedRojoProject | undefined => {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/u, ""));
  } catch {
    return undefined;
  }
  if (!isNode(json) || !isNode(json.tree)) return undefined;
  const fallback =
    file
      .split("/")
      .at(-1)
      ?.replace(/\.project\.json$/i, "") ?? "project";
  return {
    file,
    name: typeof json.name === "string" && json.name.trim() !== "" ? json.name.trim() : fallback,
    kind: json.tree.$className === "DataModel" ? "place" : "model",
    servePort: positiveInt(json.servePort),
    placeIds: Array.isArray(json.servePlaceIds)
      ? json.servePlaceIds.filter((id): id is number => typeof id === "number")
      : [],
    tree: json.tree,
  };
};

export const rojoPortHints = (taskText: string): ReadonlyMap<string, number> => {
  const hints = new Map<string, number>();
  for (const match of taskText.matchAll(
    /rojo(?:\.exe)?\s+serve\s+(?:"([^"]+)"|(\S+))[^\n"]*?--port[=\s]+(\d+)/gi,
  )) {
    const file = (match[1] ?? match[2] ?? "").replaceAll("\\\\", "/").replaceAll("\\", "/");
    const port = positiveInt(Number(match[3]));
    if (file !== "" && port !== undefined)
      hints.set(file.replace(/^\.\//u, "").toLowerCase(), port);
  }
  return hints;
};

const baseLabel = (project: ParsedRojoProject): string => {
  const segments = project.file.split("/");
  const stem = (segments.at(-1) ?? "").replace(/\.project\.json$/i, "");
  if (stem.toLowerCase() !== "default") return stem;
  const folder = segments.at(-2);
  return folder ?? project.name;
};

export const arrangeRojoProjects = (
  parsed: ReadonlyArray<ParsedRojoProject>,
  hints: ReadonlyMap<string, number> = new Map(),
): ReadonlyArray<RojoProject> => {
  const sorted = parsed.toSorted(
    (left, right) =>
      Number(right.kind === "place") - Number(left.kind === "place") ||
      left.file.split("/").length - right.file.split("/").length ||
      left.file.localeCompare(right.file),
  );
  const labels = sorted.map(baseLabel);
  const taken = new Set<number>();
  for (const project of sorted) {
    const fixed = project.servePort ?? hints.get(project.file.toLowerCase());
    if (fixed !== undefined) taken.add(fixed);
  }
  let next = defaultRojoPort;
  return sorted.map((project, index) => {
    const label = labels[index]!;
    const duplicated = labels.filter((other) => other.toLowerCase() === label.toLowerCase());
    let port = project.servePort ?? hints.get(project.file.toLowerCase());
    if (port === undefined) {
      while (taken.has(next)) next += 1;
      port = next;
      taken.add(port);
    }
    return {
      file: project.file,
      name: project.name,
      label: duplicated.length > 1 ? project.file.replace(/\.project\.json$/i, "") : label,
      kind: project.kind,
      port,
      placeIds: project.placeIds,
      tree: project.tree,
    };
  });
};

export const rojoTreePaths = (tree: RojoTreeNode, limit: number): ReadonlyArray<string> => {
  const paths: string[] = [];
  const visit = (node: RojoTreeNode) => {
    if (paths.length >= limit) return;
    if (typeof node.$path === "string") paths.push(node.$path);
    for (const [key, child] of Object.entries(node)) {
      if (!key.startsWith("$") && isNode(child)) visit(child);
    }
  };
  visit(tree);
  return paths.slice(0, limit);
};

export const servedRojoProjects = (
  projects: ReadonlyArray<RojoProject>,
): ReadonlyArray<RojoProject> => {
  const places = projects.filter((project) => project.kind === "place");
  return places.length > 0 ? places : projects;
};

export const rojoLayout = (projects: ReadonlyArray<RojoProject>): RojoLayout => {
  const served = servedRojoProjects(projects);
  return served.length === 0 ? "none" : served.length === 1 ? "single" : "multi";
};

export { parseInstancePath };

const joinPath = (base: string, ...rest: ReadonlyArray<string>) =>
  [base, ...rest]
    .join("/")
    .replaceAll("\\", "/")
    .replace(/\/{2,}/gu, "/");

const isScriptFile = (path: string) => /\.luau?$/i.test(path);

export const rojoScriptCandidates = (
  project: Pick<RojoProject, "tree">,
  segments: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  let node = project.tree;
  let consumed = 0;
  while (consumed < segments.length) {
    const child = node[segments[consumed]!];
    if (segments[consumed]!.startsWith("$") || !isNode(child)) break;
    node = child;
    consumed += 1;
  }
  const base = typeof node.$path === "string" ? node.$path : undefined;
  if (base === undefined) return [];
  const rest = segments.slice(consumed);
  const inits = (folder: string) =>
    scriptSuffixes.map((suffix) => joinPath(folder, `init${suffix}`));
  if (rest.length === 0) return isScriptFile(base) ? [base] : inits(base);
  if (isScriptFile(base)) return [];
  const parent = joinPath(base, ...rest.slice(0, -1));
  const leaf = rest.at(-1)!;
  return [
    ...scriptSuffixes.map((suffix) => joinPath(parent, `${leaf}${suffix}`)),
    ...inits(joinPath(parent, leaf)),
  ];
};

const comparable = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export const rojoProjectsForPlace = (
  projects: ReadonlyArray<RojoProject>,
  place: { readonly placeId?: number | undefined; readonly placeName?: string | undefined },
): ReadonlyArray<RojoProject> => {
  const served = servedRojoProjects(projects);
  if (served.length <= 1) return served;
  const byId = served.filter(
    (project) => place.placeId !== undefined && project.placeIds.includes(place.placeId),
  );
  if (byId.length > 0) return byId;
  const placeName = comparable(place.placeName ?? "");
  const byName = served.filter((project) => {
    const label = comparable(project.label);
    const name = comparable(project.name);
    return (
      placeName.length >= 3 &&
      ((label.length >= 3 && (placeName.includes(label) || label.includes(placeName))) ||
        (name.length >= 4 && name !== "project" && placeName.includes(name)))
    );
  });
  return byName.length > 0 ? byName : served;
};

export interface ScriptEdit {
  readonly oldString: string;
  readonly newString: string;
  readonly line?: number | undefined;
}

const lineOfOffset = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

export const applyScriptEdits = (
  source: string,
  edits: ReadonlyArray<ScriptEdit>,
):
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string } => {
  const spans: Array<{ start: number; end: number; replacement: string }> = [];
  for (const [index, edit] of edits.entries()) {
    const label = `edits[${String(index)}]`;
    if (edit.oldString === "") return { ok: false, reason: `${label}: old_string is empty` };
    const offsets: number[] = [];
    let from = source.indexOf(edit.oldString);
    while (from !== -1) {
      offsets.push(from);
      from = source.indexOf(edit.oldString, from + 1);
    }
    if (offsets.length === 0) return { ok: false, reason: `${label}: old_string was not found` };
    if (offsets.length > 1 && edit.line === undefined) {
      return {
        ok: false,
        reason: `${label}: old_string matches ${String(offsets.length)} times; add context or pass line`,
      };
    }
    const start =
      edit.line === undefined
        ? offsets[0]!
        : offsets.toSorted(
            (left, right) =>
              Math.abs(lineOfOffset(source, left) - edit.line!) -
              Math.abs(lineOfOffset(source, right) - edit.line!),
          )[0]!;
    spans.push({ start, end: start + edit.oldString.length, replacement: edit.newString });
  }
  spans.sort((left, right) => left.start - right.start);
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index]!.start < spans[index - 1]!.end) {
      return { ok: false, reason: "edits overlap" };
    }
  }
  let text = "";
  let cursor = 0;
  for (const span of spans) {
    text += source.slice(cursor, span.start) + span.replacement;
    cursor = span.end;
  }
  return { ok: true, text: text + source.slice(cursor) };
};

export type RojoScriptClass = "Script" | "LocalScript" | "ModuleScript";

export const isRojoScriptClass = (value: unknown): value is RojoScriptClass =>
  value === "Script" || value === "LocalScript" || value === "ModuleScript";

const rojoScriptFileSuffix = (className: RojoScriptClass, runContext?: unknown): string =>
  className === "ModuleScript"
    ? ".luau"
    : className === "LocalScript" || runContext === "Client"
      ? ".client.luau"
      : ".server.luau";

export interface RojoNewNode {
  readonly name: string;
  readonly className: RojoScriptClass | "Folder";
  readonly source?: string | undefined;
  readonly runContext?: unknown;
  readonly children: ReadonlyArray<RojoNewNode>;
}

export interface RojoPlannedEntry {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly content?: string;
}

export const rojoEntryNameProblem = (name: string): string | undefined => {
  if (name.trim() === "" || name === "." || name === "..") return "the name is empty";
  if (/[/:*?"<>|\u0000-\u001F]/u.test(name)) return `"${name}" has characters a file name cannot`;
  if (/[. ]$/u.test(name)) return `"${name}" ends with a dot or space`;
  if (name.toLowerCase() === "init") {
    return `"${name}" would be read by Rojo as its parent's own script`;
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(name)) {
    return `"${name}" is a reserved device name on Windows`;
  }
  if (/\.(?:meta|project)$/iu.test(name)) {
    return `"${name}" would be read by Rojo as a sidecar or project file`;
  }
  return undefined;
};

export const planRojoCreation = (
  parentDirectory: string,
  nodes: ReadonlyArray<RojoNewNode>,
): ReadonlyArray<RojoPlannedEntry> => {
  const entries: RojoPlannedEntry[] = [];
  const visit = (directory: string, node: RojoNewNode) => {
    const here = joinPath(directory, node.name);
    if (node.className === "Folder") {
      entries.push({ path: here, kind: "directory" });
      for (const child of node.children) visit(here, child);
      return;
    }
    const suffix = rojoScriptFileSuffix(node.className, node.runContext);
    const content = node.source ?? "";
    if (node.children.length === 0) {
      entries.push({ path: `${here}${suffix}`, kind: "file", content });
      return;
    }
    entries.push({ path: here, kind: "directory" });
    entries.push({ path: joinPath(here, `init${suffix}`), kind: "file", content });
    for (const child of node.children) visit(here, child);
  };
  for (const node of nodes) visit(parentDirectory, node);
  return entries;
};

export const splitRojoScriptName = (basename: string) => {
  const suffix = scriptSuffixes
    .filter((candidate) => basename.toLowerCase().endsWith(candidate))
    .toSorted((left, right) => right.length - left.length)[0];
  return suffix === undefined
    ? undefined
    : { stem: basename.slice(0, basename.length - suffix.length), suffix };
};

export const renameRojoEntry = (
  basename: string,
  kind: "file" | "directory",
  name: string,
): string | undefined => {
  if (kind === "directory") return name;
  const parts = splitRojoScriptName(basename);
  return parts === undefined ? undefined : `${name}${parts.suffix}`;
};

export const rojoSidecarName = (basename: string): string | undefined => {
  const parts = splitRojoScriptName(basename);
  return parts === undefined ? undefined : `${parts.stem}.meta.json`;
};

export const rojoTrashStamp = (millis: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(millis)).replace(/[:.]/gu, "-");

export const rojoTrashTarget = (stamp: string, relative: string) =>
  joinPath(".harp/rojo-trash", stamp, relative);

export const rojoTextConflict = (input: {
  readonly baseline: string | undefined;
  readonly fileText: string;
  readonly studioText: string;
}): boolean => {
  if (input.baseline === undefined) return false;
  const eol = (text: string) => text.replaceAll("\r\n", "\n");
  const studio = eol(input.studioText);
  return studio !== eol(input.baseline) && studio !== eol(input.fileText);
};

export type RojoParentTarget =
  | { readonly kind: "directory"; readonly base: string; readonly rest: ReadonlyArray<string> }
  | { readonly kind: "file"; readonly file: string };

const unsyncedFile = /\.(?:json|rbxm|rbxmx|txt|csv|toml|yaml|yml|md)$/i;

const walkRojoTree = (project: Pick<RojoProject, "tree">, segments: ReadonlyArray<string>) => {
  let node = project.tree;
  let consumed = 0;
  while (consumed < segments.length) {
    const child = node[segments[consumed]!];
    if (segments[consumed]!.startsWith("$") || !isNode(child)) break;
    node = child;
    consumed += 1;
  }
  const base = typeof node.$path === "string" ? node.$path : undefined;
  return base === undefined ? undefined : { base, rest: segments.slice(consumed) };
};

export const rojoParentTarget = (
  project: Pick<RojoProject, "tree">,
  segments: ReadonlyArray<string>,
): RojoParentTarget | undefined => {
  const walked = walkRojoTree(project, segments);
  if (walked === undefined) return undefined;
  if (isScriptFile(walked.base)) {
    return walked.rest.length === 0 ? { kind: "file", file: walked.base } : undefined;
  }
  if (unsyncedFile.test(walked.base)) return undefined;
  return { kind: "directory", base: walked.base, rest: walked.rest };
};

export const rojoEntryParent = (
  project: Pick<RojoProject, "tree">,
  segments: ReadonlyArray<string>,
): { readonly directory: string; readonly name: string } | undefined => {
  const walked = walkRojoTree(project, segments);
  if (walked === undefined || walked.rest.length === 0) return undefined;
  if (isScriptFile(walked.base) || unsyncedFile.test(walked.base)) return undefined;
  return {
    directory: joinPath(walked.base, ...walked.rest.slice(0, -1)),
    name: walked.rest.at(-1)!,
  };
};

export const rojoScriptSuffixes = scriptSuffixes;
