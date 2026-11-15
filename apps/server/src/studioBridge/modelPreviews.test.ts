// @effect-diagnostics nodeBuiltinImport:off globalDateInEffect:off globalDate:off -Fixture job folders on a real temp directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { compactDynamicToolOutput, modelPreviewFromToolItem } from "@t3tools/shared/toolOutput";
import { describe, expect, it } from "@effect/vitest";

import {
  glbStats,
  JOB_KEEP_NEWEST,
  JOB_MAX_AGE_MS,
  MAX_GLB_BYTES,
  MODEL_PREVIEW_FILE,
  pruneJobFolders,
  registerModelPreview,
  resolveModelPreview,
  showModelFile,
  validateGlb,
} from "./modelPreviews.ts";

const glb = (json: Record<string, unknown>, bin = new Uint8Array(0)): Uint8Array => {
  const text = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPadded = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const total = 12 + 8 + jsonPadded.length + (bin.length > 0 ? 8 + binPadded.length : 0);
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonPadded.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonPadded.copy(out, 20);
  if (bin.length > 0) {
    const at = 20 + jsonPadded.length;
    out.writeUInt32LE(binPadded.length, at);
    out.writeUInt32LE(0x004e4942, at + 4);
    binPadded.copy(out, at + 8);
  }
  return out;
};

const asset = { asset: { version: "2.0" } };

const reasonOf = (bytes: Uint8Array) => {
  const checked = validateGlb(bytes);
  return checked.ok ? "ok" : checked.reason;
};

describe("validateGlb", () => {
  it("accepts a self-contained GLB and counts animation clips", () => {
    const checked = validateGlb(
      glb({ ...asset, buffers: [{ byteLength: 4 }], animations: [{}, {}] }, new Uint8Array(4)),
    );
    expect(checked.ok && checked.info.animationClips).toBe(2);
  });

  it("rejects what a viewer cannot load", () => {
    expect(reasonOf(glb({ ...asset, buffers: [{ uri: "model.bin", byteLength: 4 }] }))).toContain(
      "external",
    );
    expect(reasonOf(glb({ ...asset, images: [{ uri: "https://example.com/a.png" }] }))).toContain(
      "external",
    );
    expect(reasonOf(glb({ ...asset, extensionsUsed: ["KHR_draco_mesh_compression"] }))).toContain(
      "KHR_draco_mesh_compression",
    );
    expect(reasonOf(glb({ ...asset, extensionsRequired: ["EXT_meshopt_compression"] }))).toContain(
      "EXT_meshopt_compression",
    );
    expect(reasonOf(glb({ asset: { version: "1.0" } }))).toContain("2.0");
    expect(reasonOf(new TextEncoder().encode("not a glb at all, really not"))).toContain(
      "binary glTF",
    );
    expect(reasonOf(glb(asset).slice(0, 30))).toContain("size");
  });

  it("caps the size", () => {
    expect(validateGlb({ byteLength: MAX_GLB_BYTES + 1 } as Uint8Array).ok).toBe(false);
  });
});

const halfTurn = Math.SQRT1_2;

const scene = {
  ...asset,
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [
    { mesh: 0, translation: [10, 0, 0], scale: [2, 2, 2], children: [1] },
    { mesh: 1, matrix: [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1] },
    { mesh: 0, translation: [100, 0, 0], rotation: [0, halfTurn, 0, halfTurn] },
  ],
  meshes: [
    { primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] },
    { primitives: [{ attributes: { POSITION: 2 } }, { attributes: { POSITION: 2 }, mode: 1 }] },
  ],
  accessors: [
    { count: 24, min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
    { count: 36 },
    { count: 9, min: [0, 0, 0], max: [1, 2, 3] },
  ],
};

describe("glbStats", () => {
  it("counts triangles and measures the default scene through node transforms", () => {
    expect(glbStats(glb(scene))).toEqual({ triangles: 15, dimensions: [7, 3, 5] });
  });

  it("walks parentless nodes when there is no scene and reports nothing for a broken file", () => {
    const { scene: _, scenes: __, ...sceneless } = scene;
    const rotated = glbStats(
      glb({ ...sceneless, nodes: [scene.nodes[2]!], meshes: [scene.meshes[0]!] }),
    );
    expect(rotated).toEqual({ triangles: 12, dimensions: [1, 1, 1] });
    expect(glbStats(new TextEncoder().encode("not a glb at all, really not"))).toEqual({
      triangles: 0,
      dimensions: [0, 0, 0],
    });
  });
});

const tempRoot = () => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "harp-previews-"));

describe("model previews", () => {
  it("resolves an id from memory and, after a restart, from the job folder index", () => {
    const root = tempRoot();
    const jobDir = NodePath.join(root, "job-2026-a");
    NodeFS.mkdirSync(jobDir);
    NodeFS.writeFileSync(NodePath.join(jobDir, MODEL_PREVIEW_FILE), glb(asset));
    const reference = registerModelPreview(jobDir, {
      triangles: 12,
      dimensions: [1, 2, 3],
      animationClips: 0,
      sizeBytes: 100,
    });
    expect(reference.previewId).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    const resolved = resolveModelPreview(root, reference.previewId);
    expect(resolved?.path).toBe(NodePath.join(jobDir, MODEL_PREVIEW_FILE));
    expect(resolveModelPreview(root, "../../etc/passwd")).toBeUndefined();
    expect(resolveModelPreview(root, "A".repeat(24))).toBeUndefined();
    NodeFS.rmSync(jobDir, { recursive: true });
    expect(resolveModelPreview(root, reference.previewId)).toBeUndefined();
  });

  it("prunes folders only when beyond the newest and older than the age limit", () => {
    const root = tempRoot();
    const now = 1_800_000_000_000;
    const make = (name: string, ageMs: number) => {
      const dir = NodePath.join(root, name);
      NodeFS.mkdirSync(dir);
      const at = new Date(now - ageMs);
      NodeFS.utimesSync(dir, at, at);
      return dir;
    };
    const oldAge = JOB_MAX_AGE_MS + 3_600_000;
    for (let index = 0; index < JOB_KEEP_NEWEST; index += 1) {
      make(`job-new-${index}`, oldAge + index * 1000);
    }
    const doomed = make("job-doomed", oldAge + 10_000_000);
    const protectedDir = make("job-continued", oldAge + 20_000_000);
    const unrelated = make("notes", oldAge * 3);
    expect(pruneJobFolders(root, now, { protect: [protectedDir] })).toBe(1);
    expect(NodeFS.existsSync(doomed)).toBe(false);
    expect(NodeFS.existsSync(protectedDir)).toBe(true);
    expect(NodeFS.existsSync(unrelated)).toBe(true);
    const recent = make("job-recent", 1000);
    expect(pruneJobFolders(root, now)).toBe(2);
    expect(NodeFS.existsSync(recent)).toBe(true);
  });
});

describe("showModelFile", () => {
  const setup = () => {
    const root = tempRoot();
    const project = NodePath.join(root, "project");
    NodeFS.mkdirSync(project);
    NodeFS.writeFileSync(NodePath.join(project, "ship.glb"), glb(scene));
    NodeFS.writeFileSync(NodePath.join(project, "broken.glb"), "not a glb at all, really not");
    NodeFS.writeFileSync(NodePath.join(project, "ship.obj"), "v 0 0 0");
    const jobsRoot = NodePath.join(root, "jobs");
    const show = (path: string) =>
      showModelFile({ path, cwd: project, jobsRoot, now: 1_800_000_000_000 });
    return { project, jobsRoot, show };
  };

  it("copies a GLB into a new job folder and registers it", () => {
    const { project, jobsRoot, show } = setup();
    const shown = show("ship.glb");
    if (!shown.ok) throw new Error(shown.reason);
    expect(shown.file).toBe(NodePath.join(project, "ship.glb"));
    expect(NodePath.basename(shown.jobDir)).toMatch(/^job-/);
    expect(shown.modelPreview).toMatchObject({
      triangles: 15,
      dimensions: [7, 3, 5],
      jobId: NodePath.basename(shown.jobDir),
    });
    expect(resolveModelPreview(jobsRoot, shown.modelPreview.previewId)?.path).toBe(
      NodePath.join(shown.jobDir, MODEL_PREVIEW_FILE),
    );
    expect(show(NodePath.join(project, "ship.glb")).ok).toBe(true);
  });

  it("refuses what it cannot show", () => {
    const { show } = setup();
    const failure = (path: string) => {
      const shown = show(path);
      return shown.ok ? "ok" : `${shown.error}: ${shown.reason}`;
    };
    expect(failure("ship.obj")).toMatch(/^not_glb: /);
    expect(failure("broken.glb")).toBe("invalid_glb: Not a binary glTF file.");
    expect(failure("missing.glb")).toMatch(/^file_not_found: No file at /);
    expect(
      showModelFile({ path: "ship.glb", cwd: undefined, jobsRoot: "/unused", now: 0 }).ok,
    ).toBe(false);
  });
});

describe("modelPreview in tool output", () => {
  const preview = {
    previewId: "abcdefghijklmnop1234",
    triangles: 120,
    dimensions: [1, 2, 3],
    animationClips: 1,
    sizeBytes: 5000,
  };

  it("survives compaction of a blender result", () => {
    const output = [
      { type: "text", text: JSON.stringify({ success: true, modelPreview: preview, output: "x" }) },
      { type: "image", mimeType: "image/png", data: "AAAA" },
    ];
    expect(compactDynamicToolOutput(output)?.modelPreview).toEqual(preview);
    expect(modelPreviewFromToolItem({ output })).toEqual(preview);
  });

  it("keeps the job lineage and drops an oversized one", () => {
    const lineage = { ...preview, jobId: "job-2", continuedFrom: "job-1" };
    const output = [{ type: "text", text: JSON.stringify({ modelPreview: lineage }) }];
    expect(modelPreviewFromToolItem({ output })).toEqual(lineage);
    const long = [
      {
        type: "text",
        text: JSON.stringify({ modelPreview: { ...preview, jobId: "x".repeat(300) } }),
      },
    ];
    expect(modelPreviewFromToolItem({ output: long })).toEqual(preview);
  });

  it("ignores malformed references", () => {
    const output = [
      { type: "text", text: JSON.stringify({ modelPreview: { ...preview, previewId: "../x" } }) },
    ];
    expect(modelPreviewFromToolItem({ output })).toBeUndefined();
  });
});
