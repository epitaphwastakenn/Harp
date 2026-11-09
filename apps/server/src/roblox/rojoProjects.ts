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

export const parseInstancePath = (path: string): ReadonlyArray<string> | undefined => {
  const segments: string[] = [];
  let index = 0;
  const text = path.trim();
  while (index < text.length) {
    if (text[index] === ".") {
      index += 1;
      continue;
    }
    if (text[index] === "[") {
      const quote = text[index + 1];
      if (quote !== '"' && quote !== "'") return undefined;
      let value = "";
      index += 2;
      while (index < text.length && text[index] !== quote) {
        if (text[index] === "\\" && index + 1 < text.length) index += 1;
        value += text[index];
        index += 1;
      }
      if (text[index] !== quote || text[index + 1] !== "]") return undefined;
      segments.push(value);
      index += 2;
      continue;
    }
    const match = /^[^.[]+/u.exec(text.slice(index));
    if (match === null) return undefined;
    segments.push(match[0]);
    index += match[0].length;
  }
  if (segments[0] === "game") segments.shift();
  return segments.length === 0 ? undefined : segments;
};

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
