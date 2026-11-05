import type { RobloxProjectDetection, RobloxProjectMode } from "@t3tools/contracts";

const robloxFile =
  /^(?:(?!tsconfig\.).+\.project\.json|.+\.rbxlx?|.+\.rbxmx?|wally\.toml|pesde\.toml|aftman\.toml|rokit\.toml|foreman\.toml|selene\.toml|\.sealcode-roblox)$/i;

const otherStackFile =
  /^(?:package\.json|pnpm-workspace\.yaml|deno\.jsonc?|cargo\.toml|go\.mod|pyproject\.toml|requirements\.txt|gemfile|composer\.json|pom\.xml|build\.gradle(?:\.kts)?|cmakelists\.txt|makefile|mix\.exs|project\.godot|.+\.uproject|.+\.sln|.+\.csproj|.+\.xcodeproj)$/i;

const skippedFolder = /^(?:\..*|node_modules|dist|build|out|target|vendor|packages|__pycache__)$/i;

const robloxName = /roblox|(?:^|[^a-z0-9])rbx(?:[^a-z0-9]|$)/i;

const defaultPlaceName = /^(?:place\d*|baseplate|unsaved.*|untitled.*|)$/i;

const maxBlankFolderEntries = 32;
const minMatchedNameLength = 4;

export const maxScannedSubfolders = 32;

export interface RobloxFolderListing {
  readonly root: ReadonlyArray<string>;
  readonly nested: ReadonlyArray<string>;
}

export interface RobloxProjectSignals {
  readonly mode: RobloxProjectMode;
  readonly allProjects: boolean;
  readonly hasGameIcon: boolean;
  readonly containerFolder: boolean;
  readonly folderNames: ReadonlyArray<string>;
  readonly title: string | undefined;
  readonly listing: RobloxFolderListing;
  readonly placeNames: ReadonlyArray<string>;
}

export const isRobloxProjectListing = (entries: ReadonlyArray<string>): boolean =>
  entries.some((entry) => robloxFile.test(entry));

const firstRobloxFile = (listing: RobloxFolderListing) =>
  listing.root.find((entry) => robloxFile.test(entry)) ??
  listing.nested.find((entry) => robloxFile.test(entry));

const isBlankFolder = (listing: RobloxFolderListing) =>
  listing.root.filter((entry) => !entry.startsWith(".")).length <= maxBlankFolderEntries &&
  !listing.root.some((entry) => otherStackFile.test(entry));

const comparableName = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const namesMatch = (left: string, right: string) => {
  const a = comparableName(left);
  const b = comparableName(right);
  return Math.min(a.length, b.length) >= minMatchedNameLength && (a.includes(b) || b.includes(a));
};

export const subfoldersToScan = (entries: ReadonlyArray<string>): ReadonlyArray<string> =>
  entries.filter((entry) => !skippedFolder.test(entry)).slice(0, maxScannedSubfolders);

export const decideRobloxProject = (signals: RobloxProjectSignals): RobloxProjectDetection => {
  if (signals.mode !== "auto") {
    return { applies: signals.mode === "roblox", reason: "user-choice" };
  }
  if (signals.allProjects) return { applies: true, reason: "all-projects" };
  if (signals.hasGameIcon) return { applies: true, reason: "game-icon" };
  if (signals.containerFolder) return { applies: false, reason: "no-signal" };

  const file = firstRobloxFile(signals.listing);
  if (file !== undefined) return { applies: true, reason: "project-files", detail: file };

  const names = [...signals.folderNames, ...(signals.title === undefined ? [] : [signals.title])];
  const named = names.find((name) => robloxName.test(name));
  if (named !== undefined) return { applies: true, reason: "folder-name", detail: named };

  const places = signals.placeNames.filter((name) => !defaultPlaceName.test(name.trim()));
  const matched = places.find((place) => names.some((name) => namesMatch(place, name)));
  if (matched !== undefined) return { applies: true, reason: "studio-place", detail: matched };

  const open = signals.placeNames[0];
  return open !== undefined && isBlankFolder(signals.listing)
    ? { applies: true, reason: "studio-place", detail: open }
    : { applies: false, reason: "no-signal" };
};
