import type { EnvironmentId } from "@t3tools/contracts";

import type { ExpandedImageItem, ExpandedImagePreview } from "../ExpandedImagePreview";
import type { ResultSubject } from "./turnResults.logic";

export function buildResultsPreview(
  environmentId: EnvironmentId,
  subjects: ReadonlyArray<ResultSubject>,
  subjectIndex: number,
): ExpandedImagePreview {
  const images: ExpandedImageItem[] = [];
  let index = 0;
  for (const [position, subject] of subjects.entries()) {
    if (subject.tile.versions !== undefined) {
      if (position === subjectIndex) index = images.length;
      images.push({
        src: null,
        name: subject.label,
        actionsSource: {
          kind: "image",
          name: subject.label,
          src: null,
          asset: { environmentId, resource: subject.tile.resource },
        },
        model: { environmentId, versions: subject.tile.versions },
      });
      continue;
    }
    if (position === subjectIndex) index = images.length + subject.images.length - 1;
    for (const [capture, resource] of subject.images.entries()) {
      const name =
        subject.images.length > 1
          ? `${subject.label} ${String(capture + 1)} of ${String(subject.images.length)}`
          : subject.label;
      images.push({
        src: null,
        name,
        actionsSource: { kind: "image", name, src: null, asset: { environmentId, resource } },
      });
    }
  }
  return { images, index, filmstrip: true };
}
