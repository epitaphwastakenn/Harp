import { metresPerStud } from "./modelPreviewVersions";

const gridStudSteps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
const maxGridCells = 24;

export interface GridPlan {
  readonly sizeMetres: number;
  readonly divisions: number;
  readonly studsPerCell: number;
}

/** A grid in whole studs that reaches past the model without drawing more than a couple dozen lines. */
export function planGrid(footprintMetres: number): GridPlan {
  const extentStuds = (Math.max(footprintMetres, metresPerStud) * 2.4) / metresPerStud;
  const studsPerCell =
    gridStudSteps.find((step) => extentStuds / step <= maxGridCells) ?? gridStudSteps.at(-1)!;
  const divisions = Math.max(2, Math.ceil(extentStuds / studsPerCell));
  return { sizeMetres: divisions * studsPerCell * metresPerStud, divisions, studsPerCell };
}

/** How far a camera with this vertical field of view must sit to fit a sphere in view, with margin. */
export function framingDistance(radius: number, fovDegrees: number, aspect: number): number {
  const vertical = (fovDegrees * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(aspect, 0.1));
  return (radius / Math.sin(Math.min(vertical, horizontal))) * 1.15;
}
