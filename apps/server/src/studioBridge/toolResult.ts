import { StudioLimits } from "./protocol.ts";

export type StudioContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

export interface StudioToolResult {
  readonly content: ReadonlyArray<StudioContentBlock>;
  readonly isError?: boolean;
  readonly structuredContent?: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Fields the bridge or plugin use for themselves that the model never needs. */
const INTERNAL_KEYS = new Set(["requestId", "pluginSessionId", "sessionToken", "_debug"]);

const stripInternal = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripInternal);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!INTERNAL_KEYS.has(key)) out[key] = stripInternal(entry);
  }
  return out;
};

/** A plugin answer is a failure when it carries `error` without `success: true`, or `success: false`. */
export const isFailurePayload = (payload: unknown): boolean =>
  isRecord(payload) &&
  (payload.success === false || ("error" in payload && payload.success !== true));

const keepNewestKeys = new Set(["logs", "entries", "messages", "output"]);
const cursorKeys = new Set(["cursor", "nextCursor", "truncated"]);
const truncationNoteChars = 300;

interface ArrayRef {
  readonly path: string;
  readonly keepNewest: boolean;
  readonly holder: Record<string, unknown> | unknown[];
  readonly key: string | number;
  readonly array: unknown[];
}

const collectArrays = (
  value: unknown,
  path: string,
  holder: Record<string, unknown> | unknown[] | undefined,
  key: string | number,
  out: ArrayRef[],
  depth: number,
) => {
  if (depth > 6) return;
  if (Array.isArray(value)) {
    if (holder !== undefined && value.length > 1 && !cursorKeys.has(String(key))) {
      out.push({ path, keepNewest: keepNewestKeys.has(String(key)), holder, key, array: value });
    }
    value.forEach((entry, index) =>
      collectArrays(entry, `${path}[${String(index)}]`, value, index, out, depth + 1),
    );
  } else if (isRecord(value)) {
    for (const [name, entry] of Object.entries(value)) {
      if (name === "truncated" && depth === 0) continue;
      collectArrays(entry, path === "" ? name : `${path}.${name}`, value, name, out, depth + 1);
    }
  }
};

interface Cut {
  readonly original: number;
  readonly kept: number;
}

/**
 * Drops items from the largest array until the result fits, keeping the newest items of log-like
 * arrays. Mutates `root`, which must be a private copy. Returns undefined when arrays alone
 * cannot make it fit.
 */
const truncateStructure = (
  root: Record<string, unknown>,
  extraChars: number,
): Record<string, unknown> | undefined => {
  const limit = StudioLimits.maxResultChars;
  const cuts = new Map<string, Cut>();
  const withNote = (): Record<string, unknown> => {
    if (cuts.size === 0) return root;
    const [first, ...rest] = [...cuts].map(([field, cut]) => ({
      field,
      kept: cut.kept,
      dropped: cut.original - cut.kept,
    }));
    return { ...root, truncated: rest.length === 0 ? first : { ...first, also: rest } };
  };
  for (let round = 0; round < 60; round += 1) {
    const candidate = withNote();
    const size = JSON.stringify(candidate).length + extraChars;
    if (size <= limit) return candidate;
    const refs: ArrayRef[] = [];
    collectArrays(root, "", undefined, "", refs, 0);
    let target: ArrayRef | undefined;
    let targetSize = 0;
    for (const ref of refs) {
      const refSize = JSON.stringify(ref.array).length;
      if (refSize > targetSize) {
        target = ref;
        targetSize = refSize;
      }
    }
    if (target === undefined) return undefined;
    const room = Math.max(0, targetSize - (size - limit) - truncationNoteChars);
    const keep = Math.min(
      target.array.length - 1,
      Math.floor(target.array.length * (room / targetSize)),
    );
    const kept = target.keepNewest
      ? target.array.slice(target.array.length - keep)
      : target.array.slice(0, keep);
    if (Array.isArray(target.holder)) target.holder[target.key as number] = kept;
    else target.holder[target.key as string] = kept;
    cuts.set(target.path, {
      original: cuts.get(target.path)?.original ?? target.array.length,
      kept: keep,
    });
  }
  return undefined;
};

/**
 * One JSON object for the model, mirrored as text for clients that ignore structured content.
 * An oversized result loses items from its largest array (keeping the newest log entries) and
 * says so in `truncated`; only when that is not enough is the text cut.
 */
export const jsonResult = (
  value: unknown,
  options: { readonly isError?: boolean; readonly suffix?: string } = {},
): StudioToolResult => {
  const cleaned = stripInternal(value);
  let text = JSON.stringify(cleaned);
  const suffix =
    options.suffix === undefined
      ? ""
      : `

${options.suffix}`;
  text = `${text}${suffix}`;
  const isError = options.isError ?? isFailurePayload(cleaned);
  let structured = isRecord(cleaned) && options.suffix === undefined ? cleaned : undefined;
  if (text.length > StudioLimits.maxResultChars && isRecord(cleaned)) {
    const shrunk = truncateStructure(cleaned, suffix.length);
    if (shrunk !== undefined) {
      text = `${JSON.stringify(shrunk)}${suffix}`;
      structured = options.suffix === undefined ? shrunk : undefined;
    }
  }
  if (text.length > StudioLimits.maxResultChars) {
    return {
      content: [
        {
          type: "text",
          text: `${text.slice(0, StudioLimits.maxResultChars)}

[Result cut at ${String(StudioLimits.maxResultChars)} characters. Ask for less: a narrower path, a line_range, a lower maxResults or a filter.]`,
        },
      ],
      ...(isError ? { isError } : {}),
    };
  }
  return {
    content: [{ type: "text", text }],
    ...(structured === undefined ? {} : { structuredContent: structured }),
    ...(isError ? { isError } : {}),
  };
};

/** A text block holding one compact JSON value. */
export const jsonText = (value: unknown): StudioContentBlock => ({
  type: "text",
  text: JSON.stringify(value),
});

export const errorResult = (
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
): StudioToolResult => jsonResult({ error, message, ...extra }, { isError: true });
