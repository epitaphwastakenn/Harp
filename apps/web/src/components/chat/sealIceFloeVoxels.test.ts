import { describe, expect, it } from "vite-plus/test";

import { buildVoxelScene, sealIceFloeVoxels } from "./sealIceFloeVoxels";

describe("buildVoxelScene", () => {
  it("hides faces that touch another voxel", () => {
    const scene = buildVoxelScene([
      { x: 0, y: 0, z: 0, material: "ice" },
      { x: 0, y: 0, z: 1, material: "ice" },
    ]);
    const faces = scene.paths.map((path) => path.face);
    expect(faces.filter((face) => face === "top")).toHaveLength(1);
    expect(faces.filter((face) => face === "left")).toHaveLength(2);
  });

  it("paints far voxels before near ones", () => {
    const scene = buildVoxelScene([
      { x: 1, y: 1, z: 0, material: "fur" },
      { x: 0, y: 0, z: 0, material: "ice" },
    ]);
    expect(scene.paths[0]?.material).toBe("ice");
    expect(scene.paths.at(-1)?.material).toBe("fur");
  });
});

describe("sealIceFloeVoxels", () => {
  it("draws a seal with a face on an ice floe", () => {
    const materials = new Set(sealIceFloeVoxels().map((voxel) => voxel.material));
    expect([...materials].sort()).toEqual(["blush", "eye", "fur", "ice", "nose", "shine"]);
  });
});
