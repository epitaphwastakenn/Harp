export type SecretKind =
  | "openai"
  | "anthropic"
  | "github"
  | "aws"
  | "google"
  | "roblox-cookie"
  | "roblox-open-cloud"
  | "bearer"
  | "assigned-secret";

export interface SecretFinding {
  readonly kind: SecretKind;
  readonly label: string;
  readonly line: number;
}

const labels: Record<SecretKind, string> = {
  openai: "an OpenAI API key",
  anthropic: "an Anthropic API key",
  github: "a GitHub token",
  aws: "an AWS access key",
  google: "a Google API key",
  "roblox-cookie": "a Roblox .ROBLOSECURITY cookie",
  "roblox-open-cloud": "a Roblox Open Cloud API key",
  bearer: "a Bearer token",
  "assigned-secret": "a hard-coded secret",
};

const shapes: ReadonlyArray<readonly [SecretKind, RegExp]> = [
  ["anthropic", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["openai", /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
  ["github", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/],
  ["aws", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["google", /\bAIza[0-9A-Za-z_-]{35}\b/],
  [
    "roblox-cookie",
    /_\|WARNING:-DO-NOT-SHARE-THIS[^\s"']{20,}|\.ROBLOSECURITY\s*[=:]\s*["']?[A-Za-z0-9%_|.\-:]{40,}/,
  ],
  ["roblox-open-cloud", /\b[A-Za-z0-9+/]{40,}={0,2}\.ey[A-Za-z0-9_-]{20,}/],
  ["bearer", /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/],
];

const secretName = /(?:api[_-]?key|apikey|token|secret|passw(?:or)?d|credential|private[_-]?key)/i;
const assignment = /([A-Za-z_][A-Za-z0-9_.-]*)\s*(?:=|:)\s*["']([^"'\r\n]{20,})["']/g;

const entropy = (value: string): number => {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const share = count / value.length;
    bits -= share * Math.log2(share);
  }
  return bits;
};

const looksRandom = (value: string): boolean =>
  !/\s/.test(value) &&
  !/^[a-z]+(?:[_.-][a-z]+)*$/i.test(value) &&
  !/^(?:https?:|rbxassetid:|\/|\.{1,2}\/)/.test(value) &&
  /[A-Za-z]/.test(value) &&
  /\d/.test(value) &&
  entropy(value) >= 3.5;

export const scanForSecrets = (code: string): ReadonlyArray<SecretFinding> => {
  const found = new Map<SecretKind, SecretFinding>();
  const lines = code.split(/\r?\n/);
  lines.forEach((text, index) => {
    for (const [kind, pattern] of shapes) {
      if (!found.has(kind) && pattern.test(text)) {
        found.set(kind, { kind, label: labels[kind], line: index + 1 });
      }
    }
    if (found.has("assigned-secret")) return;
    for (const match of text.matchAll(assignment)) {
      const [, name, value] = match;
      if (
        name !== undefined &&
        value !== undefined &&
        secretName.test(name) &&
        looksRandom(value)
      ) {
        found.set("assigned-secret", {
          kind: "assigned-secret",
          label: labels["assigned-secret"],
          line: index + 1,
        });
        return;
      }
    }
  });
  return [...found.values()];
};

export const secretWarning = (findings: ReadonlyArray<SecretFinding>): string | undefined =>
  findings.length === 0
    ? undefined
    : `Warning: this code contains what looks like ${findings.map((finding) => finding.label).join(", ")}. Do not keep secrets in scripts; use Roblox secrets (HttpService:GetSecret) or server configuration.`;

export const secretChipText = (finding: SecretFinding): string =>
  finding.kind === "assigned-secret"
    ? "Contains what looks like a hard-coded secret"
    : `Contains what looks like ${finding.label}`;
