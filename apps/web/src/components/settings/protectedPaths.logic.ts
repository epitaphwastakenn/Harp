import type { RobloxStudioProtectedPlace } from "@t3tools/contracts";
import {
  canonicalInstancePath,
  instancePathProblem,
  instancePathSegments,
} from "@t3tools/shared/instancePath";

export interface ProtectedPlaceRef {
  readonly placeKey: string;
  readonly placeName: string;
}

const sameSegments = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.length === right.length &&
  left.every((name, index) => name.toLowerCase() === right[index]!.toLowerCase());

export const protectedPlaceRows = (
  saved: ReadonlyArray<RobloxStudioProtectedPlace>,
  connected: ReadonlyArray<{
    readonly placeKey?: string;
    readonly instanceId: string;
    readonly placeName?: string;
  }>,
): ReadonlyArray<{
  readonly placeKey: string;
  readonly placeName: string;
  readonly paths: ReadonlyArray<string>;
  readonly connected: boolean;
}> => {
  const rows = new Map<
    string,
    { placeKey: string; placeName: string; paths: ReadonlyArray<string>; connected: boolean }
  >();
  for (const entry of saved) {
    rows.set(entry.placeKey, {
      ...entry,
      placeName: entry.placeName || entry.placeKey,
      connected: false,
    });
  }
  for (const place of connected) {
    const placeKey = place.placeKey ?? place.instanceId;
    const existing = rows.get(placeKey);
    rows.set(placeKey, {
      placeKey,
      placeName: place.placeName ?? existing?.placeName ?? placeKey,
      paths: existing?.paths ?? [],
      connected: true,
    });
  }
  return [...rows.values()];
};

export const addProtectedPath = (
  saved: ReadonlyArray<RobloxStudioProtectedPlace>,
  place: ProtectedPlaceRef,
  input: string,
):
  | { readonly ok: true; readonly places: ReadonlyArray<RobloxStudioProtectedPlace> }
  | { readonly ok: false; readonly error: string } => {
  const problem = instancePathProblem(input);
  if (problem !== undefined) return { ok: false, error: problem };
  const path = canonicalInstancePath(input)!;
  const current = saved.find((entry) => entry.placeKey === place.placeKey);
  const segments = instancePathSegments(path)!;
  if (
    current?.paths.some((existing) => sameSegments(instancePathSegments(existing) ?? [], segments))
  ) {
    return { ok: false, error: "That path is already protected." };
  }
  const next = {
    placeKey: place.placeKey,
    placeName: place.placeName,
    paths: [...(current?.paths ?? []), path],
  };
  return {
    ok: true,
    places:
      current === undefined
        ? [...saved, next]
        : saved.map((entry) => (entry.placeKey === place.placeKey ? next : entry)),
  };
};

export const removeProtectedPath = (
  saved: ReadonlyArray<RobloxStudioProtectedPlace>,
  placeKey: string,
  path: string,
): ReadonlyArray<RobloxStudioProtectedPlace> =>
  saved.flatMap((entry) => {
    if (entry.placeKey !== placeKey) return [entry];
    const paths = entry.paths.filter((existing) => existing !== path);
    return paths.length === 0 ? [] : [{ ...entry, paths }];
  });
