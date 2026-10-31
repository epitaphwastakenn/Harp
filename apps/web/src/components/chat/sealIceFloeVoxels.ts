export type VoxelMaterial = "ice" | "fur" | "eye" | "nose" | "blush" | "shine";
export type VoxelFace = "top" | "left" | "right";

type Voxel = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly material: VoxelMaterial;
};
type Ellipsoid = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  number,
];

export type VoxelPath = {
  readonly level: number;
  readonly material: VoxelMaterial;
  readonly face: VoxelFace;
  readonly d: string;
};

export type VoxelScene = {
  readonly paths: ReadonlyArray<VoxelPath>;
  readonly viewBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
};

const unit = 5;
const cos30 = Math.sqrt(3) / 2;

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

function inEllipsoid(x: number, y: number, z: number, [center, radii, power]: Ellipsoid) {
  const dx = Math.abs((x + 0.5 - center[0]) / radii[0]);
  const dy = Math.abs((y + 0.5 - center[1]) / radii[1]);
  const dz = Math.abs((z + 0.5 - center[2]) / radii[2]);
  return dx ** power + dy ** power + dz ** power <= 1;
}

function superEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number) {
  return ((x + 0.5 - cx) / rx) ** 4 + ((y + 0.5 - cy) / ry) ** 4;
}

function jagged(x: number, y: number) {
  return ((Math.floor(x / 2) * 73856093) ^ (Math.floor(y / 2) * 19349663)) % 4 === 0;
}

const sealParts: ReadonlyArray<Ellipsoid> = [
  [[17, 10, 5.6], [6.2, 8, 3.2], 2.6],
  [[17, 18.5, 8.4], [6.2, 4.6, 5.6], 3.4],
  [[17, 1.8, 3.9], [3.6, 2.2, 1.4], 2],
  [[10.4, 15.2, 3.5], [2.4, 1.6, 1], 2],
  [[23.6, 15.2, 3.5], [2.4, 1.6, 1], 2],
];

export function sealIceFloeVoxels(): ReadonlyArray<Voxel> {
  const voxels = new Map<string, Voxel>();
  const add = (x: number, y: number, z: number, material: VoxelMaterial) =>
    voxels.set(key(x, y, z), { x, y, z, material });

  for (let x = 0; x < 34; x++) {
    for (let y = 0; y < 28; y++) {
      const shape = superEllipse(x, y, 17, 12.5, 15, 11.5);
      if (shape <= 1 && !(shape > 0.72 && jagged(x, y))) {
        add(x, y, 2, "ice");
        add(x, y, 1, "ice");
      }
      if (superEllipse(x, y, 17, 12.5, 13.8, 10.4) <= 1) add(x, y, 0, "ice");
    }
  }
  for (const [x, y] of [
    [34, 19],
    [35, 19],
    [34, 20],
    [35, 20],
    [-1, 8],
    [0, 8],
    [-1, 9],
  ] as const) {
    add(x, y, 0, "ice");
    add(x, y, 1, "ice");
  }

  for (let x = 6; x < 29; x++) {
    for (let y = 0; y < 26; y++) {
      for (let z = 3; z < 15; z++) {
        if (sealParts.some((part) => inEllipsoid(x, y, z, part))) add(x, y, z, "fur");
      }
    }
  }

  const front = new Map<string, number>();
  for (const voxel of voxels.values()) {
    if (voxel.material !== "fur" || voxel.y < 16) continue;
    const column = `${voxel.x},${voxel.z}`;
    front.set(column, Math.max(front.get(column) ?? -1, voxel.y));
  }
  const mark = (x: number, z: number, material: VoxelMaterial) => {
    const y = front.get(`${x},${z}`);
    if (y !== undefined) add(x, y, z, material);
  };
  for (const [x, z] of [
    [13, 10],
    [14, 10],
    [13, 9],
    [14, 9],
    [19, 10],
    [20, 10],
    [19, 9],
    [20, 9],
  ] as const)
    mark(x, z, "eye");
  for (const [x, z] of [
    [16, 8],
    [17, 8],
    [16, 7],
    [17, 7],
  ] as const)
    mark(x, z, "nose");
  for (const [x, z] of [
    [12, 7],
    [13, 7],
    [20, 7],
    [21, 7],
  ] as const)
    mark(x, z, "blush");
  for (const [x, z] of [
    [14, 10],
    [20, 10],
  ] as const)
    mark(x, z, "shine");

  return [...voxels.values()];
}

function point(x: number, y: number, z: number): readonly [number, number] {
  return [(x - y) * cos30 * unit, ((x + y) / 2 - z) * unit];
}

function facePath(corners: ReadonlyArray<readonly [number, number, number]>) {
  return `${corners
    .map(([x, y, z], index) => {
      const [sx, sy] = point(x, y, z);
      return `${index === 0 ? "M" : "L"}${Math.round(sx * 10) / 10} ${Math.round(sy * 10) / 10}`;
    })
    .join("")}Z`;
}

export function buildVoxelScene(voxels: ReadonlyArray<Voxel>): VoxelScene {
  const occupied = new Set(voxels.map((voxel) => key(voxel.x, voxel.y, voxel.z)));
  const levels = new Map<number, Map<string, VoxelPath>>();
  const push = (level: number, material: VoxelMaterial, face: VoxelFace, d: string) => {
    const group = levels.get(level) ?? new Map<string, VoxelPath>();
    levels.set(level, group);
    const existing = group.get(`${material}:${face}`);
    group.set(`${material}:${face}`, { level, material, face, d: (existing?.d ?? "") + d });
  };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y, z, material } of voxels) {
    const level = x + y + z;
    for (const [cx, cy, cz] of [
      [x, y, z],
      [x + 1, y + 1, z + 1],
      [x + 1, y, z],
      [x, y + 1, z],
      [x, y, z + 1],
    ] as const) {
      const [sx, sy] = point(cx, cy, cz);
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    if (!occupied.has(key(x, y + 1, z)))
      push(
        level,
        material,
        "left",
        facePath([
          [x, y + 1, z],
          [x + 1, y + 1, z],
          [x + 1, y + 1, z + 1],
          [x, y + 1, z + 1],
        ]),
      );
    if (!occupied.has(key(x + 1, y, z)))
      push(
        level,
        material,
        "right",
        facePath([
          [x + 1, y, z],
          [x + 1, y + 1, z],
          [x + 1, y + 1, z + 1],
          [x + 1, y, z + 1],
        ]),
      );
    if (!occupied.has(key(x, y, z + 1)))
      push(
        level,
        material,
        "top",
        facePath([
          [x, y, z + 1],
          [x + 1, y, z + 1],
          [x + 1, y + 1, z + 1],
          [x, y + 1, z + 1],
        ]),
      );
  }
  const paths = [...levels.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, group]) => [...group.values()]);
  return { paths, viewBox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } };
}
