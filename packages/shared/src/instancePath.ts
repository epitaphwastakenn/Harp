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

const services: Readonly<Record<string, string>> = { workspace: "Workspace" };

export const instancePathSegments = (path: string): ReadonlyArray<string> | undefined => {
  const parsed = parseInstancePath(path);
  if (parsed === undefined) return undefined;
  return [services[parsed[0]!.toLowerCase()] ?? parsed[0]!, ...parsed.slice(1)];
};

const segmentText = (name: string): string =>
  /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)
    ? `.${name}`
    : `["${name.replaceAll(/["\\]/gu, (char) => `\\${char}`)}"]`;

export const canonicalInstancePath = (path: string): string | undefined => {
  const segments = instancePathSegments(path);
  return segments === undefined ? undefined : `game${segments.map(segmentText).join("")}`;
};

/** A message for a path that cannot be a protected path, or undefined when it is fine. */
export const instancePathProblem = (path: string): string | undefined => {
  const trimmed = path.trim();
  if (trimmed === "") return "Enter an instance path such as game.ServerStorage.Data.";
  if (trimmed.includes("\n")) return "A path is one line.";
  if (instancePathSegments(trimmed) === undefined) {
    return 'Not a valid path. Use dots or ["quoted"] names, such as game.ReplicatedStorage.Packages.';
  }
  return undefined;
};
