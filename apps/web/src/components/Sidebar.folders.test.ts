import { describe, expect, it } from "vite-plus/test";

import { legacyProjectCwdPreferenceKey } from "../uiStateStore";
import {
  buildSidebarFolderLayout,
  groupSidebarThreadsByFolder,
  nextThreadFolderName,
  planSidebarActiveList,
  planSidebarFolderDrop,
  sidebarGroupHeaderId,
  sidebarListItemId,
  threadFolderKey,
  type SidebarFolderLayout,
} from "./Sidebar.logic";

const thread = (id: string, projectId: string | null, folder: string | null = null) => ({
  id,
  environmentId: "env",
  projectId,
  folder,
});

const plan = (
  threads: readonly ReturnType<typeof thread>[],
  options: {
    readonly layout?: SidebarFolderLayout | null;
    readonly collapsedFolders?: readonly string[];
    readonly routeThreadKey?: string;
    readonly pinnedProjectKeys?: readonly string[];
  } = {},
) => {
  const activeLayout = options.layout === undefined ? layout() : options.layout;
  return planSidebarActiveList({
    groupedThreads: groupSidebarThreadsByFolder(threads, activeLayout),
    layout: activeLayout,
    projectKeyOf: (entry) => (entry.projectId === null ? null : `folder-${entry.projectId}`),
    isFolderCollapsed: (key) => options.collapsedFolders?.includes(key) === true,
    pinnedProjectKeys: options.pinnedProjectKeys ?? [],
    keyOf: (entry) => entry.id,
    routeThreadKey: options.routeThreadKey ?? null,
  });
};
const projectHeader = (key: string) => sidebarGroupHeaderId("project", key);
const uiFolder = threadFolderKey("folder-web", "UI");
const uiHeader = sidebarGroupHeaderId("folder", uiFolder);
const ids = (result: ReturnType<typeof plan>) => result.items.map(sidebarListItemId);

const layout = (collapsed: readonly string[] = []): SidebarFolderLayout => ({
  folderKeyByProject: new Map([
    ["env:api", "folder-api"],
    ["env:web", "folder-web"],
  ]),
  order: ["folder-web", "folder-api"],
  collapsed: new Set(collapsed),
});

describe("sidebar project folders", () => {
  it("groups threads by folder order and keeps each folder's thread order", () => {
    const grouped = groupSidebarThreadsByFolder(
      [thread("a1", "api"), thread("loose", null), thread("w1", "web"), thread("a2", "api")],
      layout(),
    );
    expect(grouped.map((entry) => entry.id)).toEqual(["w1", "a1", "a2", "loose"]);
  });

  it("keeps a collapsed project's header and count but hides its rows", () => {
    const result = plan([thread("w1", "web"), thread("a1", "api"), thread("loose", null)], {
      layout: layout(["folder-web"]),
    });
    expect(ids(result)).toEqual([
      projectHeader("folder-web"),
      projectHeader("folder-api"),
      "a1",
      "loose",
    ]);
    expect(result.projectThreadCount.get("folder-web")).toBe(1);
  });

  it("keeps the header of a collapsed project with nothing after it", () => {
    const result = plan([thread("w1", "web"), thread("a1", "api")], {
      layout: layout(["folder-api"]),
    });
    expect(ids(result)).toEqual([projectHeader("folder-web"), "w1", projectHeader("folder-api")]);
  });

  it("marks where pinned projects end with one divider", () => {
    const result = plan([thread("w1", "web"), thread("a1", "api")], {
      pinnedProjectKeys: ["folder-web"],
    });
    expect(ids(result)).toEqual([
      projectHeader("folder-web"),
      "w1",
      sidebarGroupHeaderId("divider", "folder-api"),
      projectHeader("folder-api"),
      "a1",
    ]);
  });
});

describe("thread folders", () => {
  const threads = [
    thread("newest-loose", "web"),
    thread("u1", "web", "UI"),
    thread("b1", "web", "bugs"),
    thread("u2", "web", "UI"),
  ];

  it("lists a project's folders by name, then its loose threads", () => {
    expect(ids(plan(threads))).toEqual([
      projectHeader("folder-web"),
      sidebarGroupHeaderId("folder", threadFolderKey("folder-web", "bugs")),
      "b1",
      uiHeader,
      "u1",
      "u2",
      "newest-loose",
    ]);
  });

  it("closes each tray on its last row", () => {
    const result = plan(threads);
    expect(result.trayPositionByThread.get("b1")).toBe("last");
    expect(result.trayPositionByThread.get("u1")).toBe("middle");
    expect(result.trayPositionByThread.get("u2")).toBe("last");
    expect(result.trayPositionByThread.has("newest-loose")).toBe(false);
  });

  it("collapses to the name and count, keeping only the route's row", () => {
    const collapsed = plan(threads, { collapsedFolders: [uiFolder] });
    expect(ids(collapsed)).not.toContain("u1");
    expect(collapsed.threadFolders.get(uiFolder)?.threads).toHaveLength(2);
    expect(collapsed.threadFolders.get(uiFolder)?.trayOpen).toBe(false);

    const routed = plan(threads, { collapsedFolders: [uiFolder], routeThreadKey: "u2" });
    expect(ids(routed)).toContain("u2");
    expect(ids(routed)).not.toContain("u1");
    expect(routed.threadFolders.get(uiFolder)?.trayOpen).toBe(true);
  });

  it("hides folder headers inside a collapsed project", () => {
    const result = plan(threads, { layout: layout(["folder-web"]) });
    expect(ids(result)).toEqual([projectHeader("folder-web")]);
  });

  it("still groups by folder when a project scope hides project headers", () => {
    expect(ids(plan(threads, { layout: null }))).toEqual([
      sidebarGroupHeaderId("folder", threadFolderKey("folder-web", "bugs")),
      "b1",
      uiHeader,
      "u1",
      "u2",
      "newest-loose",
    ]);
  });

  it("names new folders around the ones a project already has", () => {
    expect(nextThreadFolderName(["UI"])).toBe("New folder");
    expect(nextThreadFolderName(["new folder", "New Folder 2"])).toBe("New folder 3");
  });
});

describe("planSidebarFolderDrop", () => {
  const rows = {
    loose: { section: "active", projectKey: "web", folder: null },
    other: { section: "active", projectKey: "web", folder: null },
    filed: { section: "active", projectKey: "web", folder: "UI" },
    sibling: { section: "active", projectKey: "web", folder: "UI" },
    bug: { section: "active", projectKey: "web", folder: "Bugs" },
    elsewhere: { section: "active", projectKey: "api", folder: null },
    pinned: { section: "pinned", projectKey: "web", folder: null },
  } as const;
  const drop = (
    activeKey: keyof typeof rows,
    over: Parameters<typeof planSidebarFolderDrop>[0]["over"],
  ) =>
    planSidebarFolderDrop({
      activeKey,
      over,
      rowOf: (key) => rows[key as keyof typeof rows] ?? null,
      folderOf: (key) =>
        key === "web-ui" ? { projectKey: "web", name: "UI" } : { projectKey: "api", name: "Far" },
    });
  const row = (key: keyof typeof rows) =>
    ({ kind: "thread", key, section: rows[key].section }) as const;
  const header = (group: "project" | "folder", key: string) =>
    ({ kind: "group", group, id: key, key }) as const;

  it("makes a folder from two loose threads", () => {
    expect(drop("loose", row("other"))).toEqual({ kind: "create", targetKey: "other" });
  });

  it("joins through a folder's row or its header", () => {
    expect(drop("loose", row("filed"))).toEqual({ kind: "join", folder: "UI" });
    expect(drop("bug", row("filed"))).toEqual({ kind: "join", folder: "UI" });
    expect(drop("loose", header("folder", "web-ui"))).toEqual({ kind: "join", folder: "UI" });
  });

  it("takes a filed thread out through a loose row or the project header", () => {
    expect(drop("filed", row("loose"))).toEqual({ kind: "leave" });
    expect(drop("filed", header("project", "web"))).toEqual({ kind: "leave" });
  });

  it("does nothing for its own folder, its own row, or a loose thread on the project", () => {
    expect(drop("filed", row("sibling"))).toBeNull();
    expect(drop("filed", header("folder", "web-ui"))).toBeNull();
    expect(drop("loose", row("loose"))).toBeNull();
    expect(drop("loose", header("project", "web"))).toBeNull();
  });

  it("never crosses projects, since a thread's project is its workspace", () => {
    expect(drop("loose", row("elsewhere"))).toBeNull();
    expect(drop("loose", header("folder", "far"))).toBeNull();
    expect(drop("filed", header("project", "api"))).toBeNull();
  });

  it("leaves other sections to their own drop rules", () => {
    expect(drop("pinned", row("other"))).toBeNull();
    expect(drop("loose", row("pinned"))).toBeNull();
  });
});

describe("buildSidebarFolderLayout", () => {
  const group = (projectKey: string, physicalProjectKey: string, workspaceRoot: string) => ({
    projectKey,
    memberProjects: [{ physicalProjectKey, workspaceRoot }],
    memberProjectRefs: [{ environmentId: "env", projectId: `${projectKey}-id` }],
  });
  const groups = [
    group("alpha", "alpha-physical", "/repo/alpha"),
    group("beta", "beta-physical", "/repo/beta"),
    group("gamma", "gamma-physical", "/repo/gamma"),
  ] as unknown as Parameters<typeof buildSidebarFolderLayout>[0]["projectGroups"];
  const build = (overrides: Partial<Parameters<typeof buildSidebarFolderLayout>[0]> = {}) =>
    buildSidebarFolderLayout({
      projectGroups: groups,
      pinnedProjectKeys: [],
      projectExpandedById: {},
      projectOrder: [],
      ...overrides,
    });

  it("leads with pinned projects and ignores pins for projects that are gone", () => {
    expect(build({ pinnedProjectKeys: ["gamma", "missing", "beta"] }).order).toEqual([
      "gamma",
      "beta",
      "alpha",
    ]);
  });

  it("lets a manual drag order win, whichever key it was recorded under", () => {
    expect(build({ projectOrder: ["gamma-physical", "alpha"] }).order).toEqual([
      "gamma",
      "alpha",
      "beta",
    ]);
  });

  it("honors collapse state saved under the project, physical or legacy path key", () => {
    const layout = build({
      projectExpandedById: {
        alpha: false,
        "beta-physical": false,
        [legacyProjectCwdPreferenceKey("/repo/gamma")]: false,
      },
    });
    expect([...layout.collapsed].toSorted()).toEqual(["alpha", "beta", "gamma"]);
    expect(build({ projectExpandedById: { alpha: true } }).collapsed.size).toBe(0);
  });

  it("maps every member project to its folder", () => {
    expect(build().folderKeyByProject.get("env:beta-id")).toBe("beta");
  });
});
