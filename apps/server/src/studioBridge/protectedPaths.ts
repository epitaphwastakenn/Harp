import { instancePathSegments } from "@t3tools/shared/instancePath";
import { errorResult, type StudioToolResult } from "./toolResult.ts";

type Args = Record<string, unknown>;

/** `within` changes what is at or under the path; `subtree` also covers moving, renaming or deleting an ancestor. */
export type ProtectedReach = "within" | "subtree";

export interface ProtectedTarget {
  readonly path: string;
  readonly reach: ProtectedReach;
}

export interface ProtectedHit {
  readonly rule: string;
  readonly path: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const segmentsOf = instancePathSegments;

const sameName = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

const isPrefix = (prefix: ReadonlyArray<string>, whole: ReadonlyArray<string>) =>
  prefix.length <= whole.length && prefix.every((name, index) => sameName(name, whole[index]!));

/** Instance boundaries, not string prefixes: game.Workspace.Map does not cover game.Workspace.Map2. */
export const firstProtectedHit = (
  rules: ReadonlyArray<string>,
  targets: ReadonlyArray<ProtectedTarget>,
): ProtectedHit | undefined => {
  const parsedRules = rules.flatMap((rule) => {
    const segments = segmentsOf(rule);
    return segments === undefined ? [] : [{ rule, segments }];
  });
  for (const target of targets) {
    const segments = segmentsOf(target.path);
    if (segments === undefined) continue;
    for (const { rule, segments: ruleSegments } of parsedRules) {
      if (
        isPrefix(ruleSegments, segments) ||
        (target.reach === "subtree" && isPrefix(segments, ruleSegments))
      ) {
        return { rule, path: target.path };
      }
    }
  }
  return undefined;
};

export const isProtectedPath = (rules: ReadonlyArray<string>, path: string): boolean =>
  firstProtectedHit(rules, [{ path, reach: "within" }]) !== undefined;

const movesInstance = (properties: unknown): boolean =>
  isRecord(properties) && ("Name" in properties || "Parent" in properties);

const parentOf = (properties: unknown): string | undefined =>
  isRecord(properties) ? text(properties.Parent) : undefined;

/** Paths a call would change, apart from instance refs (the plugin resolves those). */
export const protectedTargetsOf = (tool: string, args: Args): ReadonlyArray<ProtectedTarget> => {
  const found: ProtectedTarget[] = [];
  const add = (path: unknown, reach: ProtectedReach = "within") => {
    const value = text(path);
    if (value !== undefined && !value.startsWith("$")) found.push({ path: value, reach });
  };
  switch (tool) {
    case "set_properties":
      add(args.path, movesInstance(args.properties) ? "subtree" : "within");
      add(parentOf(args.properties));
      break;
    case "delete_instances":
      if (Array.isArray(args.paths)) for (const path of args.paths) add(path, "subtree");
      break;
    case "set_script_source":
    case "edit_script":
      add(args.path);
      break;
    case "find_and_replace_in_scripts":
      if (args.dryRun === false) add(args.path);
      break;
    case "build_instances": {
      add(args.path);
      const operations = Array.isArray(args.operations) ? args.operations : [];
      for (const step of operations) {
        if (!isRecord(step)) continue;
        add(step.parent);
        add(parentOf(step.properties));
        if (step.op === "remove") add(step.target, "subtree");
        else if (step.op === "set")
          add(step.target, movesInstance(step.properties) ? "subtree" : "within");
      }
      break;
    }
    case "insert_asset":
    case "import_mesh":
    case "import_rbxm":
      add(text(args.parentPath) ?? "game.Workspace");
      break;
    case "animation":
      if (args.action === "create") {
        add(args.rig);
        add(args.parent === "ServerStorage" ? "game.ServerStorage" : args.parent);
      }
      break;
    default:
      break;
  }
  return found;
};

/** Instance refs a call carries, for the plugin to turn into paths. */
export const instanceRefsOf = (tool: string, args: Args): ReadonlyArray<string> => {
  const refs = new Set<string>();
  const add = (value: unknown) => {
    const ref = text(value);
    if (ref !== undefined) refs.add(ref);
  };
  switch (tool) {
    case "set_properties":
    case "set_script_source":
    case "edit_script":
      add(args.instanceRef);
      break;
    case "delete_instances":
      if (Array.isArray(args.instanceRefs)) for (const ref of args.instanceRefs) add(ref);
      break;
    default:
      break;
  }
  return [...refs].slice(0, 500);
};

export const refTargetReach = (tool: string, args: Args): ProtectedReach =>
  tool === "delete_instances" || (tool === "set_properties" && movesInstance(args.properties))
    ? "subtree"
    : "within";

export const protectedRefusal = (hit: ProtectedHit, tool: string): StudioToolResult =>
  errorResult(
    "protected_path",
    `${tool} was refused: ${hit.path} is at, under or above ${hit.rule}, a path the user protected in Harp's Roblox Studio settings. Reads stay allowed. Do not change it or work around it (not with another tool, not with Luau); say what you wanted to change and ask the user to edit it or lift the protection.`,
    { protectedPath: hit.rule, target: hit.path },
  );

export const protectedInstructions = (
  places: ReadonlyArray<{ readonly placeName: string; readonly paths: ReadonlyArray<string> }>,
): string | undefined => {
  const lines = places.flatMap((place) =>
    place.paths.length === 0
      ? []
      : [`- ${place.placeName === "" ? "this place" : place.placeName}: ${place.paths.join(", ")}`],
  );
  return lines.length === 0 ? undefined : lines.join("\n");
};

export const protectedPlacesFor = <
  T extends { readonly placeKey: string; readonly paths: ReadonlyArray<string> },
>(
  places: ReadonlyArray<T>,
  placeKey: string,
): ReadonlyArray<string> => places.find((place) => place.placeKey === placeKey)?.paths ?? [];
