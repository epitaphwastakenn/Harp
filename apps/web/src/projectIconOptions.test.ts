import { AlarmClockCheck, ArrowDown01, Layers3 } from "lucide-react";
import { describe, expect, it } from "vite-plus/test";
import { lucideIconByName } from "./lib/lucideIconByName";
import { filterProjectIconNames, firstEmoji, gameProjectIcons } from "./projectIconOptions";

describe("projectIconOptions", () => {
  it("offers a small set of distinct game icons that all resolve", () => {
    expect(gameProjectIcons.length).toBeGreaterThanOrEqual(20);
    expect(gameProjectIcons.length).toBeLessThanOrEqual(30);
    expect(new Set(gameProjectIcons.map((icon) => icon.name)).size).toBe(gameProjectIcons.length);
    expect(new Set(gameProjectIcons.map((icon) => icon.label)).size).toBe(gameProjectIcons.length);
    for (const { name } of gameProjectIcons) {
      expect(lucideIconByName(name), name).toBeDefined();
      expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("resolves every offered icon name, including saved legacy spellings", () => {
    for (const name of filterProjectIconNames("")) expect(lucideIconByName(name)).toBeDefined();
    expect(lucideIconByName("layers-3")).toBe(Layers3);
    expect(lucideIconByName("arrow-down-01")).toBe(ArrowDown01);
    expect(lucideIconByName("arrow-down-0-1")).toBe(ArrowDown01);
    expect(lucideIconByName("alarm-check")).toBe(AlarmClockCheck);
    expect(lucideIconByName("create-lucide-icon")).toBeUndefined();
  });

  it("extracts one complete emoji grapheme", () => {
    expect(firstEmoji("  👩🏽‍💻 hello")).toBe("👩🏽‍💻");
    expect(firstEmoji("🇺🇸 project")).toBe("🇺🇸");
    expect(firstEmoji("1️⃣ project")).toBe("1️⃣");
    expect(firstEmoji("plain text")).toBeNull();
  });
});
