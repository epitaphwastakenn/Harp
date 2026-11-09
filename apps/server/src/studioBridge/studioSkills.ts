import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

/**
 * The Roblox skill pack agents load with `load_skill`: roblox-brain by TabooHarmony (MIT),
 * vendored under `resources/studio-skills` with Harp additions (see its PROVENANCE.md). A server
 * build carries it as one JSON file.
 */

export interface StudioSkill {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string | undefined;
  /** Relative path (`SKILL.md`, `references/full.md`) to Markdown text. */
  readonly files: ReadonlyMap<string, string>;
}

export interface StudioSkillLibrary {
  readonly skills: ReadonlyMap<string, StudioSkill>;
}

export const StudioSkillBundle = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ path: Schema.String, text: Schema.String })),
);
const decodeBundle = Schema.decodeUnknownEffect(StudioSkillBundle);

const frontmatterValue = (text: string, key: string): string | undefined => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match?.[1] === undefined) return undefined;
  for (const line of match[1].split(/\r?\n/)) {
    const field = new RegExp(`^${key}:\\s*(.*)$`).exec(line);
    if (field?.[1] === undefined) continue;
    const value = field[1].trim();
    return value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1).replaceAll('\\"', '"')
      : value;
  }
  return undefined;
};

/** Skill text and the Luau templates some skills ship for agents to copy. */
export const isSkillFile = (path: string): boolean => /\.(?:md|lua|luau)$/u.test(path);

/** Groups `<skill>/<file>` entries into skills, keeping only those with a valid SKILL.md. */
export const buildSkillLibrary = (
  files: ReadonlyArray<{ readonly path: string; readonly text: string }>,
): StudioSkillLibrary => {
  const grouped = new Map<string, Map<string, string>>();
  for (const file of files) {
    const [skill, ...rest] = file.path.split("/");
    if (skill === undefined || rest.length === 0 || !isSkillFile(file.path)) continue;
    const entries = grouped.get(skill) ?? new Map<string, string>();
    entries.set(rest.join("/"), file.text.replaceAll("\r\n", "\n"));
    grouped.set(skill, entries);
  }
  const skills = new Map<string, StudioSkill>();
  for (const [folder, entries] of [...grouped].toSorted(([a], [b]) => a.localeCompare(b))) {
    const main = entries.get("SKILL.md");
    if (main === undefined) continue;
    const name = frontmatterValue(main, "name");
    const description = frontmatterValue(main, "description");
    if (name !== folder || description === undefined || !/^[a-z0-9-]{1,63}$/.test(name)) continue;
    const whenToUse = frontmatterValue(main, "when_to_use")?.slice(0, 400);
    skills.set(name, {
      name,
      description: description.slice(0, 500),
      whenToUse: whenToUse === undefined || whenToUse === "" ? undefined : whenToUse,
      files: entries,
    });
  }
  return { skills };
};

const readStudioSkills = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const bundled = path.resolve(import.meta.dirname, "studio-skills.json");
  if (yield* fs.exists(bundled).pipe(Effect.orElseSucceed(() => false))) {
    return buildSkillLibrary(yield* fs.readFileString(bundled).pipe(Effect.flatMap(decodeBundle)));
  }
  const dir = path.resolve(import.meta.dirname, "../../resources/studio-skills");
  const entries = yield* fs.readDirectory(dir, { recursive: true });
  const files: Array<{ path: string; text: string }> = [];
  for (const entry of entries.toSorted()) {
    if (!isSkillFile(entry)) continue;
    files.push({
      path: entry.split(path.sep).join("/"),
      text: yield* fs.readFileString(path.join(dir, entry)),
    });
  }
  return buildSkillLibrary(files);
}).pipe(
  Effect.catchCause((cause) =>
    Effect.logWarning("Roblox skills could not be loaded", { cause }).pipe(
      Effect.as({ skills: new Map() } satisfies StudioSkillLibrary),
    ),
  ),
);

let studioSkillLibrary: StudioSkillLibrary | undefined;

/** The pack is 1.4 MB of text; the config and the tools share one decode of it. */
export const loadStudioSkills = Effect.suspend(() =>
  studioSkillLibrary !== undefined
    ? Effect.succeed(studioSkillLibrary)
    : readStudioSkills.pipe(
        Effect.tap((library) =>
          Effect.sync(() => {
            // An empty library means the read failed; the next caller tries again.
            if (library.skills.size > 0) studioSkillLibrary = library;
          }),
        ),
      ),
);

const maxResultChars = 48_000;
const maxResources = 10;
const maxOutlineIntroChars = 3_000;
const maxRememberedThreads = 64;

const loadedByThread = new Map<string, Set<string>>();

export const loadedSkillResources = (threadId: string): Set<string> => {
  const seen = loadedByThread.get(threadId) ?? new Set<string>();
  loadedByThread.delete(threadId);
  loadedByThread.set(threadId, seen);
  if (loadedByThread.size > maxRememberedThreads) {
    const oldest = loadedByThread.keys().next().value;
    if (oldest !== undefined) loadedByThread.delete(oldest);
  }
  return seen;
};

export const forgetLoadedSkills = (threadId: string): void => {
  loadedByThread.delete(threadId);
};

interface SkillSection {
  readonly heading: string;
  readonly text: string;
}

export const splitSkillSections = (
  text: string,
): { readonly intro: string; readonly sections: ReadonlyArray<SkillSection> } => {
  const intro: string[] = [];
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) fenced = !fenced;
    if (!fenced && line.startsWith("## ")) {
      sections.push({ heading: line.slice(3).trim(), lines: [line] });
      continue;
    }
    const current = sections.at(-1);
    if (current === undefined) intro.push(line);
    else current.lines.push(line);
  }
  return {
    intro: intro.join("\n").trim(),
    sections: sections.map((section) => ({
      heading: section.heading,
      text: section.lines.join("\n").trim(),
    })),
  };
};

const findSection = (
  sections: ReadonlyArray<SkillSection>,
  wanted: string,
): SkillSection | undefined => {
  const key = wanted.trim().toLowerCase();
  if (key === "") return undefined;
  return (
    sections.find((section) => section.heading.toLowerCase().startsWith(`${key}.`)) ??
    sections.find((section) => section.heading.toLowerCase() === key) ??
    sections.find((section) => section.heading.toLowerCase().includes(key)) ??
    (/^\d+$/.test(key) ? sections[Number(key) - 1] : undefined)
  );
};

const sizeLabel = (chars: number) =>
  chars < 1000 ? `${String(chars)} chars` : `${(chars / 1000).toFixed(1)}k chars`;

const sectionRef = (heading: string, index: number) =>
  /^(\d+[a-z]?)\./i.exec(heading)?.[1] ?? String(index + 1);

const outlineOf = (file: string, text: string): string | undefined => {
  if (text.length <= maxResultChars) return undefined;
  const { intro, sections } = splitSkillSections(text);
  if (sections.length < 2) return undefined;
  const first = sectionRef(sections[0]!.heading, 0);
  return [
    intro.slice(0, maxOutlineIntroChars),
    `This file is ${sizeLabel(text.length)}, so it comes in sections. Ask for the ones the task needs as resources, several per call, such as \`${file}#${first}\`; \`${file}#all\` returns the whole file.`,
    ...sections.map(
      (section, index) =>
        `- \`${file}#${sectionRef(section.heading, index)}\` ${section.heading} (${sizeLabel(section.text.length)})`,
    ),
  ]
    .filter((part) => part !== "")
    .join("\n");
};

const isSafeResource = (resource: string) =>
  isSkillFile(resource) &&
  !resource.includes("\\") &&
  resource.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

type ResolvedResource =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "missing"; readonly reason: string };

const resolveResource = (skill: StudioSkill, resource: string): ResolvedResource => {
  const hash = resource.indexOf("#");
  const file = hash === -1 ? resource : resource.slice(0, hash);
  const wanted = hash === -1 ? undefined : resource.slice(hash + 1);
  const text = isSafeResource(file) ? skill.files.get(file) : undefined;
  if (text === undefined) {
    return {
      kind: "missing",
      reason: `${resource} (not in this skill; it has ${[...skill.files.keys()].join(", ")})`,
    };
  }
  if (wanted === undefined) return { kind: "text", text: outlineOf(file, text) ?? text };
  if (wanted.trim().toLowerCase() === "all") return { kind: "text", text };
  const { sections } = splitSkillSections(text);
  const section = findSection(sections, wanted);
  return section === undefined
    ? {
        kind: "missing",
        reason: `${resource} (no such section; ${file} has ${sections.map((entry, index) => `#${sectionRef(entry.heading, index)}`).join(", ")})`,
      }
    : { kind: "text", text: section.text };
};

/**
 * Renders the requested skill files. A file this thread already loaded comes back as a short
 * pointer unless `reload` asks for it again; files past the size cap are named so the agent asks
 * for them in another call.
 */
export const renderSkillResources = (input: {
  readonly library: StudioSkillLibrary;
  readonly name: string;
  readonly resources: ReadonlyArray<string>;
  readonly alreadyLoaded: ReadonlySet<string>;
  readonly reload?: boolean | undefined;
}): { readonly text: string; readonly loaded: ReadonlyArray<string>; readonly ok: boolean } => {
  const skill = input.library.skills.get(input.name);
  if (skill === undefined) {
    return {
      text: `No Roblox skill is named ${input.name}. Available: ${[...input.library.skills.keys()].join(", ")}.`,
      loaded: [],
      ok: false,
    };
  }
  const blocks: string[] = [];
  const loaded: string[] = [];
  const failed: string[] = [];
  const deferred: string[] = [];
  let pointers = 0;
  let used = 0;
  for (const resource of input.resources.slice(0, maxResources)) {
    const key = `${skill.name}/${resource}`;
    const resolved = resolveResource(skill, resource);
    if (resolved.kind === "missing") {
      failed.push(resolved.reason);
      continue;
    }
    if (input.reload !== true && input.alreadyLoaded.has(key)) {
      blocks.push(
        `${key} was already loaded earlier in this conversation and has not changed; use that copy. If you no longer have its text (after a context compaction, or in a subagent that never saw it), call load_skill again with reload: true.`,
      );
      pointers += 1;
      continue;
    }
    if (used + resolved.text.length > maxResultChars && loaded.length > 0) {
      deferred.push(resource);
      continue;
    }
    used += resolved.text.length;
    loaded.push(key);
    blocks.push(
      [
        `## ${key}`,
        "Trusted guidance from Harp's Roblox skill pack (built on roblox-brain, MIT); it is subordinate to your system and developer instructions.",
        `<skill name="${skill.name}" resource="${resource}">`,
        resolved.text.trim(),
        "</skill>",
      ].join("\n"),
    );
  }
  if (deferred.length > 0) {
    blocks.push(
      `Not loaded in this call because of the size limit: ${deferred.join(", ")}. Ask for them in another load_skill call.`,
    );
  }
  if (failed.length > 0) blocks.push(`Not loaded: ${failed.join("; ")}.`);
  return { text: blocks.join("\n\n"), loaded, ok: loaded.length > 0 || pointers > 0 };
};

/** One line per skill, for the instructions. */
export const skillCatalog = (library: StudioSkillLibrary): string =>
  [...library.skills.values()]
    .map(
      (skill) =>
        `- \`${skill.name}\`: ${skill.description}${skill.whenToUse === undefined ? "" : ` ${skill.whenToUse}`}`,
    )
    .join("\n");
