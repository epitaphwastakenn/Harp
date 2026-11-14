import { describe, expect, it } from "vite-plus/test";

import { scanForSecrets, secretChipText, secretWarning } from "./secretScan.ts";

const kinds = (code: string) => scanForSecrets(code).map((finding) => finding.kind);

describe("scanForSecrets", () => {
  it("flags provider key shapes", () => {
    expect(kinds(`local k = "sk-ant-api03-${"a1B2".repeat(8)}"`)).toEqual(["anthropic"]);
    expect(kinds(`key = "sk-proj-${"Ab3dE6gH".repeat(5)}"`)).toEqual(["openai"]);
    expect(kinds(`gh = "ghp_${"a1B2c3".repeat(7)}"`)).toEqual(["github"]);
    expect(kinds(`id = "AKIAIOSFODNN7EXAMPLE"`)).toEqual(["aws"]);
    expect(kinds(`k = "AIzaSyA-1234567890abcdefghijklmnopqrstu"`)).toEqual(["google"]);
  });

  it("flags Roblox cookies and Bearer tokens", () => {
    expect(kinds(`cookie = ".ROBLOSECURITY=${"x9Y8".repeat(15)}"`)).toEqual(["roblox-cookie"]);
    expect(kinds(`_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone`)).toEqual([
      "roblox-cookie",
    ]);
    expect(kinds(`headers.Authorization = "Bearer ${"abcDEF123456".repeat(3)}"`)).toEqual([
      "bearer",
    ]);
  });

  it("flags long random literals assigned to secret-like names", () => {
    expect(kinds(`local apiKey = "Zk3Qm9Xv2LpR7sTw4Yh8Nc1B"`)).toEqual(["assigned-secret"]);
    expect(kinds(`password: "q8W3e7R1t5Y9u2I4o6P0aS"`)).toEqual(["assigned-secret"]);
  });

  it("leaves ordinary code alone", () => {
    expect(kinds(`local tokenName = "player_token_display_name"`)).toEqual([]);
    expect(kinds(`local apiKey = "short"`)).toEqual([]);
    expect(kinds(`local url = "https://example.com/api/v1/some/path/here"`)).toEqual([]);
    expect(kinds(`local label = "A very long ordinary sentence for a text label"`)).toEqual([]);
    expect(kinds(`workspace.Door.Transparency = 0.5`)).toEqual([]);
  });

  it("reports the first line and one finding per kind", () => {
    const found = scanForSecrets(
      `print(1)\nlocal a = "AKIAIOSFODNN7EXAMPLE"\nlocal b = "AKIAIOSFODNN7EXAMPLF"`,
    );
    expect(found).toEqual([{ kind: "aws", label: "an AWS access key", line: 2 }]);
  });
});

describe("secret messages", () => {
  it("words the chip and the warning", () => {
    const found = scanForSecrets(`local k = "AKIAIOSFODNN7EXAMPLE"`);
    expect(secretChipText(found[0]!)).toBe("Contains what looks like an AWS access key");
    expect(secretWarning(found)).toContain("an AWS access key");
    expect(secretWarning([])).toBeUndefined();
  });
});
