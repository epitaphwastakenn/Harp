# Modeling playbook (Harp)

How to model props and creatures in Blender for a Roblox game, alone or as a set of many in one
style. It extends "Modeling a custom mesh" in `full.md` (house style, colour, topology, lettering,
chips, review before upload), which still applies to every model made this way.

Written by Harp on 2026-10-31 from a study of a batch-modeling workflow the user shared. Nothing
here was re-tested in Studio or Blender yet, so every rule is marked (guideline) unless it says
(verified) or names the Roblox docs. Upgrade a line to (verified) only after it held in a real run.

## 1. Pick the route

| Request                                        | Route                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| One prop for a place                           | `full.md` "Modeling a custom mesh", plus section 3 and 6 here      |
| "Make N more like this one", a pet or prop set | The set workflow below (sections 2 to 7)                           |
| A whole map or scene                           | `building-sealcode.md`; model only the hero pieces kits can't give |

A set always has a reference model: the user's own file (.blend, .fbx, .glb, .obj) or the first
model you make and the user approves. Without one there is nothing to stay faithful to, so make and
approve the reference first (guideline).

## 2. Lock the style before the second model

Most "samey" or "off-style" sets go wrong here, not in the modeling (guideline).

1. **Measure the reference** in one script run, not by eye. Vision misjudges density and colour, so
   record numbers (guideline):
   - triangles in the game, object and shell count, materials, texture sizes;
   - bounding size and height in studs;
   - a scale-free detail figure: triangles divided by surface area over the squared bounding
     diagonal, so a bigger model with the same density scores the same;
   - how much is smooth-shaded and how many edges are hard (face angle over about 30°);
   - colour: count of distinct colours that cover more than a few percent of the area, mean
     saturation and value, and how the colour gets there (flat material, palette texture, painted
     texture, vertex colour).
2. **Dump its makeup**: how each part is built (eyes, mouth, trims, gems), segment counts,
   modifiers, bevel widths, and whether bevels share a UV island with their face. Look at its
   texture image itself, not only the render.
3. **Write a style card** of at most about 30 lines, kept next to the work: makeup (forms,
   signature parts, edge treatment, how many secondary pieces), surface (texture method, palette
   rules, finish), proportion (size class, head to body ratio, ground contact) and a "never" list
   that grows with every user correction (guideline).
4. **Build a kit**: the style as code that every model calls. Constants (segment counts, bevel
   width, palette cells) and the signature parts as functions with shape and expression parameters
   (eye shape, lid angle, brow, mouth type, size), never one fixed stamp. The kit holds how things
   look; it never holds what a model is (no body plans) (guideline).
5. **Kit check**: rebuild the reference's head and one body part with the kit only, render it beside
   the reference at full size and compare edges, bevel colour, texture and shading. Fix the kit until
   they read the same. This check was the one step the source called essential; keep it (guideline).
6. **Harden the kit before anyone else uses it**: every optional argument has a working default,
   numeric sizes take a scalar or a tuple, eyes and mouths scale with a size argument and support
   one-eye or covered-eye faces, and the props the plan needs (tail, spike, horn) exist. A kit bug
   costs every model a rebuild (guideline).

## 3. Modeling rules that keep a set on style

These also apply to a single prop (guideline unless marked):

- Spend triangles on the silhouette and where the eye rests (face, hands, hilt, the prop the model
  holds); keep flat areas light. Match the reference's detail with separate pieces and texture, not
  with denser main surfaces.
- Overlap forms instead of butting them edge to edge; one dominant shape language per set.
- It must read in greyscale: check the solid view with colour off.
- Blades, plates and fins: flat prisms with knife-edge outlines and sharp edges; smooth only parts
  that are truly curved.
- Palettes vary only inside the style's rules: hue may move per model, saturation, value and the
  number of colours may not.
- Roblox limits (Roblox docs): at most 20,000 triangles per mesh, textures are downscaled above
  1024 by 1024. Export facing −Y with the origin at the feet, so the Model's pivot lands on the
  ground (guideline; check the first export's size and facing in Studio).
- Rigs and animation clips: build one rig and one clip function into the kit at style lock and reuse
  it on every model, instead of rigging each model by hand.

## 4. Plan the set as a table first

Write every row before building anything, starting with a row for the reference itself (guideline):

| #   | slug | concept | body plan | mass | silhouette | face/expression | signature | palette | tier and triangle band |
| --- | ---- | ------- | --------- | ---- | ---------- | --------------- | --------- | ------- | ---------------------- |

- **Five diversity axes**: body plan (biped, quadruped, blob, serpent, floater, object with a face),
  mass (bottom-heavy, top-heavy, even, split), silhouette (tall, wide, round, spiky, long),
  face/expression (where the face sits, how it is built, mood) and one signature feature only this
  model has (horns, shell, wings, crown, tool).
- **No two rows share more than two axes**, the reference row included. Write each cell as short
  comma-separated terms and spell the same idea the same way, then check the pairs mechanically (a
  short script that counts shared terms per axis), not by eye. Fix a clash by changing the design,
  never the wording.
- **The face axis matters most** for a set that looks samey: vary where the face sits and how it is
  built (snout, beak, muzzle, visor, one eye, side eyes, mouth type, mood), not just the body under
  one stamped face.
- **Triangle bands, not targets**: give each row a tier with a band measured from the reference,
  for example Medium 1.2 to 1.8 times and High 1.8 to 2.8 times its triangles. Bands that are too
  tight cause rebuild loops just to trim detail. Over the band, cut secondary pieces once.
- Show the table to the user once; go on unless they edit it.

## 5. One short build script per model

Each model is its own file that calls the kit and returns the finished objects, about 20 to 80
lines (guideline). Keep these files: when the kit changes, rebuild every model whose file or kit is
newer than its output, instead of hand-editing meshes.

- Build headless (`blender -b --factory-startup -P <script>`) into separate files, so the user's open
  Blender is never touched and a crash costs one model. With a Blender MCP, still build each model
  in a fresh scene and save it before the next (guideline).
- Keep a build cheap: measure the seconds per build at the kit check; every extra second is paid on
  every rebuild of every model.
- Keep all of a set's state in its own folder: style card, kit, plan, one script per model, outputs.
  Start a new folder for a new set and never mix two runs in one.
- Several models per worker: when your harness can run subagents, give each one about 5 models (3 for
  a small set), all started at once, with a short brief: the folder, its rows with tier and band, the
  kit's function signatures pasted in, and one example script to copy from. Builders never edit the
  kit, the style card or the plan; a missing part goes in their own script and gets reported as a kit
  candidate. Use a cheaper model for standard-quality builders (guideline).

**Two quality levels**: ask which one, every time. Both must be faithful to the reference.

- _Standard_: write the script from the row, build, compare the render with the reference, one fix
  round only if something reads off.
- _High_: before writing, a short design pass per model: what it is, its attitude, and the 3 or 4
  details that make it this thing and not a box with the set's face. After the build, compare the
  front and three-quarter views at full size with the reference and ask whether it would sit in the
  reference's set without looking simpler or copied. A second fix round only for something still
  visibly off.

## 6. Review by rendering at equal scale

Renders are the check; numbers only point at what to look at (guideline).

- **Same camera for every model**: four orthographic views (front, three-quarter, side, back
  three-quarter) at one fixed frame size for the whole set, the same two sun lights, a neutral grey
  background and the Standard view transform. Different framing per model hides scale drift.
- **Each builder looks at its own render beside the reference.** This catches hidden faces, props
  buried in the body and heads swallowed by shells, which no number shows.
- **One info line per build**, read at a glance: triangles and detail figure as multiples of the
  reference, and the most similar earlier model by silhouette overlap (front and side outlines
  rasterised to a small grid, overlap over union). Act only when the picture agrees: a model that
  reads thinner than the reference, or one that looks like a repeat.
- **Lineup pages after each wave**: the reference plus about 11 models per page, so every tile is
  read at full size, then a similarity pass over all pairs (the per-build check only saw models that
  finished earlier). Look at each listed pair and decide by eye.
- Move a part that two or more models made on their own into the kit, rebuild what changed, and show
  the pages. Drift the user calls out is fixed in the kit or the style card, then rebuilt.

## 7. Deliver

- All models in one .blend laid out in a row, plus one export per model in the format asked for
  (FBX for Roblox). Remove text blocks and scripts from a delivered .blend.
- Report per model: its info line and export path; say plainly what has not been tested in Studio.
- Then follow `full.md` "Reviewing a model before upload": wireframe and counts, insert, read back,
  screenshot at play distance, and the provenance attribute.

## Don't skip

The kit check against the reference, each builder looking at its own render, the High design pass,
the lineup read after every wave, and triangles spent on the face and the prop (guideline: the
source workflow reported these as the steps that mattered most).
