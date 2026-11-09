import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  buildSkillLibrary,
  forgetLoadedSkills,
  loadedSkillResources,
  loadStudioSkills,
  renderSkillResources,
  skillCatalog,
  splitSkillSections,
} from "./studioSkills.ts";

const library = buildSkillLibrary([
  {
    path: "roblox-gui/SKILL.md",
    text: '---\nname: roblox-gui\ndescription: "Use for UI."\n---\n# GUI\nUse inspect_ui.',
  },
  { path: "roblox-gui/references/full.md", text: "# Full\n" + "x".repeat(100) },
  { path: "broken/SKILL.md", text: "no frontmatter" },
  { path: "roblox-data/SKILL.md", text: "---\nname: other-name\ndescription: x\n---\n" },
]);

describe("studio skills", () => {
  it("keeps only skills whose frontmatter name matches their folder", () => {
    expect([...library.skills.keys()]).toEqual(["roblox-gui"]);
    expect(skillCatalog(library)).toBe("- `roblox-gui`: Use for UI.");
  });

  it("renders a resource once per thread, then points back to it", () => {
    const first = renderSkillResources({
      library,
      name: "roblox-gui",
      resources: ["SKILL.md"],
      alreadyLoaded: new Set(),
    });
    expect(first.ok).toBe(true);
    expect(first.loaded).toEqual(["roblox-gui/SKILL.md"]);
    expect(first.text).toContain('<skill name="roblox-gui" resource="SKILL.md">');
    expect(first.text).toContain("built on roblox-brain, MIT");
    const again = renderSkillResources({
      library,
      name: "roblox-gui",
      resources: ["SKILL.md"],
      alreadyLoaded: new Set(first.loaded),
    });
    expect(again.ok).toBe(true);
    expect(again.text).toContain("already loaded");
    expect(again.text).toContain("reload: true");
    const reloaded = renderSkillResources({
      library,
      name: "roblox-gui",
      resources: ["SKILL.md"],
      alreadyLoaded: new Set(first.loaded),
      reload: true,
    });
    expect(reloaded.text).toContain('<skill name="roblox-gui" resource="SKILL.md">');
  });

  it("forgets what a thread loaded when its conversation is compacted", () => {
    loadedSkillResources("thread-a").add("roblox-gui/SKILL.md");
    expect(loadedSkillResources("thread-a").has("roblox-gui/SKILL.md")).toBe(true);
    forgetLoadedSkills("thread-a");
    expect(loadedSkillResources("thread-a").size).toBe(0);
  });

  it("puts the symptom phrases of when_to_use in the catalog", () => {
    const withTriggers = buildSkillLibrary([
      {
        path: "roblox-data/SKILL.md",
        text: '---\nname: roblox-data\ndescription: "Use for saves."\nwhen_to_use: "Also when data is lost."\n---\n# Data',
      },
    ]);
    expect(skillCatalog(withTriggers)).toBe(
      "- `roblox-data`: Use for saves. Also when data is lost.",
    );
  });

  it("answers a file over the size cap with its sections, then one section at a time", () => {
    const big = buildSkillLibrary([
      { path: "roblox-big/SKILL.md", text: '---\nname: roblox-big\ndescription: "Big."\n---\n' },
      {
        path: "roblox-big/references/full.md",
        text: `# Big\nIntro line.\n\n## 1. First\n${"a".repeat(30_000)}\n\n## 2. Second part\n${"b".repeat(30_000)}\n\n\`\`\`md\n## not a heading\n\`\`\`\n`,
      },
    ]);
    const outline = renderSkillResources({
      library: big,
      name: "roblox-big",
      resources: ["references/full.md"],
      alreadyLoaded: new Set(),
    });
    expect(outline.text).toContain("Intro line.");
    expect(outline.text).toContain("`references/full.md#1` 1. First");
    expect(outline.text).toContain("`references/full.md#2` 2. Second part");
    expect(outline.text).not.toContain("aaaa");
    const section = renderSkillResources({
      library: big,
      name: "roblox-big",
      resources: ["references/full.md#second", "references/full.md#9"],
      alreadyLoaded: new Set(),
    });
    expect(section.loaded).toEqual(["roblox-big/references/full.md#second"]);
    expect(section.text).toContain("## not a heading");
    expect(section.text).not.toContain("aaaa");
    expect(section.text).toContain("no such section");
    const whole = renderSkillResources({
      library: big,
      name: "roblox-big",
      resources: ["references/full.md#all"],
      alreadyLoaded: new Set(),
    });
    expect(whole.text).toContain("aaaa");
    expect(whole.text).toContain("bbbb");
  });

  it("refuses paths outside the skill and unknown skills, keeping the good resources", () => {
    const mixed = renderSkillResources({
      library,
      name: "roblox-gui",
      resources: ["references/full.md", "../roblox-data/SKILL.md", "nope.md"],
      alreadyLoaded: new Set(),
    });
    expect(mixed.loaded).toEqual(["roblox-gui/references/full.md"]);
    expect(mixed.text).toContain("Not loaded: ../roblox-data/SKILL.md");
    expect(
      renderSkillResources({
        library,
        name: "nope",
        resources: ["SKILL.md"],
        alreadyLoaded: new Set(),
      }).ok,
    ).toBe(false);
  });

  it.effect("loads the vendored roblox-brain pack", () =>
    Effect.gen(function* () {
      const real = yield* loadStudioSkills;
      expect(real.skills.size).toBeGreaterThanOrEqual(25);
      expect(real.skills.get("roblox-gui")?.files.has("SKILL.md")).toBe(true);
      expect(real.skills.has("roblox-studio-mcp")).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps every skill loadable: triggers, linked files and sections for large files", () =>
    Effect.gen(function* () {
      const real = yield* loadStudioSkills;
      const problems: string[] = [];
      for (const skill of real.skills.values()) {
        if (skill.whenToUse === undefined) problems.push(`${skill.name}: no when_to_use`);
        for (const [file, text] of skill.files) {
          if (file.endsWith(".md")) {
            const links = text.matchAll(
              /`((?:references|templates)\/[\w./-]+\.(?:md|lua|luau))(?:#[\w-]+)?`/gu,
            );
            for (const link of links) {
              if (!skill.files.has(link[1]!)) {
                problems.push(`${skill.name}/${file}: missing ${link[1]!}`);
              }
            }
          }
          if (text.length > 48_000 && splitSkillSections(text).sections.length < 2) {
            problems.push(`${skill.name}/${file}: too large to load and has no sections`);
          }
        }
      }
      expect(problems).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("decodes the pack once for every caller", () =>
    Effect.gen(function* () {
      const first = yield* loadStudioSkills;
      const second = yield* loadStudioSkills;
      expect(second).toBe(first);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
