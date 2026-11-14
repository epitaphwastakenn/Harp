/** Python that wraps every Blender job: Harp's modeling helpers first, the export checks after. */

export const PRELUDE = String.raw`
import bpy, bmesh, json, math, os, sys, traceback
from mathutils import Vector
JOB_DIR = os.environ["SEALCODE_JOB_DIR"]
if os.environ.get("SEALCODE_FRESH") == "1":
    bpy.ops.wm.read_homefile(use_empty=True)
def job_path(name):
    return os.path.join(JOB_DIR, name)

def _harp_rgba(color):
    if isinstance(color, str):
        text = color.lstrip("#")
        if len(text) == 3:
            text = "".join(ch * 2 for ch in text)
        raw = [int(text[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
        lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in raw]
        return (lin[0], lin[1], lin[2], 1.0)
    values = [float(v) for v in color]
    if len(values) == 3:
        values.append(1.0)
    return (values[0], values[1], values[2], values[3])

def harp_material(name, color=(0.8, 0.8, 0.8), roughness=0.8, metallic=0.0):
    rgba = _harp_rgba(color)
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    mat.diffuse_color = rgba
    return mat

def harp_color_material(color):
    rgba = _harp_rgba(color)
    name = "Harp_" + "".join("%02x" % round(max(0.0, min(1.0, c)) * 255) for c in rgba)
    return bpy.data.materials.get(name) or harp_material(name, rgba)

def _harp_select(objs):
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

def _harp_object(name, bm, color, location=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    me.materials.append(harp_color_material(color))
    harp_shade_flat(obj)
    return obj

def harp_shade_flat(obj):
    polys = obj.data.polygons
    polys.foreach_set("use_smooth", [False] * len(polys))
    obj.data.update()
    return obj

def _harp_cone(r1, r2, depth, segments):
    bm = bmesh.new()
    try:
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=r1, radius2=r2, depth=depth)
    except TypeError:
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, diameter1=r1, diameter2=r2, depth=depth)
    return bm

def harp_part(kind, a, b, radius=0.05, name="Part", color=(0.8, 0.8, 0.8), segments=12):
    pa, pb = Vector(a), Vector(b)
    axis = pb - pa
    length = axis.length
    if length < 1e-6:
        raise ValueError("harp_part: a and b are the same point")
    if isinstance(radius, (tuple, list)):
        rx, ry = float(radius[0]), float(radius[1])
    else:
        rx = ry = float(radius)
    if kind == "box":
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * rx * 2, v.co.y * ry * 2, v.co.z * length))
    elif kind in ("cylinder", "cone"):
        bm = _harp_cone(rx, rx if kind == "cylinder" else 0.0, length, segments)
        if ry != rx:
            for v in bm.verts:
                v.co.y *= ry / rx
    else:
        raise ValueError("harp_part: kind must be box, cylinder or cone")
    obj = _harp_object(name, bm, color, (pa + pb) / 2)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(axis.normalized())
    return obj

def harp_box(name, center, size, color=(0.8, 0.8, 0.8)):
    sx, sy, sz = size
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    return _harp_object(name, bm, color, center)

def harp_cylinder(name, center, radius, depth, color=(0.8, 0.8, 0.8), segments=12):
    return _harp_object(name, _harp_cone(radius, radius, depth, segments), color, center)

def harp_sphere(name, center, radius, color=(0.8, 0.8, 0.8), segments=12):
    bm = bmesh.new()
    try:
        bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=max(3, segments // 2), radius=radius)
    except TypeError:
        bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=max(3, segments // 2), diameter=radius)
    return _harp_object(name, bm, color, center)

def harp_vertex_colors(obj, color, name="Col"):
    me = obj.data
    fn = color if callable(color) else None
    base = None if fn else _harp_rgba(color)
    if hasattr(me, "color_attributes"):
        layer = me.color_attributes.get(name) or me.color_attributes.new(name, "FLOAT_COLOR", "CORNER")
        try:
            me.color_attributes.active_color = layer
            me.color_attributes.render_color_index = me.color_attributes.find(name)
        except Exception:
            pass
    else:
        layer = me.vertex_colors.get(name) or me.vertex_colors.new(name=name)
    if fn is None:
        layer.data.foreach_set("color", list(base) * len(me.loops))
    else:
        for loop in me.loops:
            layer.data[loop.index].color = _harp_rgba(fn(me.vertices[loop.vertex_index].co.copy()))
    me.update()
    return obj

def harp_join(objs, name=None):
    meshes = [o for o in objs if o.type == "MESH"]
    if not meshes:
        raise ValueError("harp_join: no mesh objects")
    _harp_select(meshes)
    if len(meshes) > 1:
        bpy.ops.object.join()
    result = bpy.context.view_layer.objects.active
    if name:
        result.name = name
        result.data.name = name
    return result

def harp_apply_scale(objs=None, rotation=False):
    meshes = [o for o in (objs if objs is not None else bpy.context.scene.objects) if o.type == "MESH"]
    if not meshes:
        return
    _harp_select(meshes)
    bpy.ops.object.transform_apply(location=False, rotation=rotation, scale=True, isolate_users=True)
`;

export const EPILOGUE = String.raw`
def _harp_clean(value):
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _harp_clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_harp_clean(v) for v in value]
    return value

def _harp_coords(me):
    try:
        import numpy as np
        buf = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get("co", buf)
        return int((~np.isfinite(buf)).sum())
    except Exception:
        return sum(1 for v in me.vertices if not all(math.isfinite(c) for c in v.co))

def _harp_nonfinite():
    found = []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        count = 0
        try:
            ev = obj.evaluated_get(depsgraph)
            me = ev.to_mesh()
            count = _harp_coords(me)
            ev.to_mesh_clear()
        except Exception:
            pass
        if any(not math.isfinite(x) for row in obj.matrix_world for x in row):
            count = max(count, 1)
        if count:
            found.append({"object": obj.name, "vertices": count})
    return found

def _sealcode_report():
    meshes = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        me = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        bm = bmesh.new()
        bm.from_mesh(me)
        ngons = sum(1 for f in bm.faces if len(f.verts) > 4)
        quads = sum(1 for f in bm.faces if len(f.verts) == 4)
        tris = sum(len(f.verts) - 2 for f in bm.faces)
        non_manifold = sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
        boundary = sum(1 for e in bm.edges if e.is_boundary)
        loose_verts = sum(1 for v in bm.verts if not v.link_edges)
        loose_edges = sum(1 for e in bm.edges if not e.link_faces)
        zero_faces = sum(1 for f in bm.faces if f.calc_area() < 1e-8)
        dims = obj.dimensions
        meshes.append({
            "name": obj.name,
            "faces": len(bm.faces), "triangles": tris, "quads": quads, "ngons": ngons,
            "nonManifoldEdges": non_manifold, "openBoundaryEdges": boundary,
            "looseVerts": loose_verts, "looseEdges": loose_edges, "zeroAreaFaces": zero_faces,
            "materials": [s.material.name for s in obj.material_slots if s.material],
            "dimensions": [round(dims.x, 3), round(dims.y, 3), round(dims.z, 3)],
            "scaleApplied": all(abs(s - 1) < 1e-6 for s in obj.scale),
        })
        bm.free()
        obj.to_mesh_clear()
    return {"meshes": meshes, "totalTriangles": sum(m["triangles"] for m in meshes)}

def _harp_has_vertex_colors(obj):
    me = obj.data
    try:
        return len(me.color_attributes) > 0
    except Exception:
        return len(me.vertex_colors) > 0

def _sealcode_preview(path):
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not objs:
        return False
    for mat in bpy.data.materials:
        try:
            if mat.use_nodes:
                bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                if bsdf is not None:
                    mat.diffuse_color = tuple(bsdf.inputs["Base Color"].default_value)
        except Exception:
            pass
    vertex_only = any(_harp_has_vertex_colors(o) for o in objs) and not any(s.material for o in objs for s in o.material_slots)
    lo = Vector((math.inf,) * 3); hi = Vector((-math.inf,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    center = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.01)
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_WORKBENCH"
    except TypeError:
        pass
    try:
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "VERTEX" if vertex_only else "MATERIAL"
        scene.display.shading.show_cavity = True
        scene.display.shading.show_object_outline = True
    except Exception:
        pass
    try:
        scene.world.color = (0.82, 0.84, 0.87)
    except Exception:
        pass
    cell_w, cell_h = 480, 360
    scene.render.resolution_x = cell_w
    scene.render.resolution_y = cell_h
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    cam_data = bpy.data.cameras.new("SealCodePreviewCam")
    cam_data.type = "ORTHO"
    extent = hi - lo
    cam_data.ortho_scale = radius * 2.3
    cam_data.clip_end = radius * 40
    cam = bpy.data.objects.new("SealCodePreviewCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    views = [
        ("front", Vector((0, -1, 0.0001)), "ORTHO", extent.x, extent.z),
        ("right", Vector((1, 0, 0.0001)), "ORTHO", extent.y, extent.z),
        ("top", Vector((0, -0.0001, 1)), "ORTHO", extent.x, extent.y),
        ("iso", Vector((1.0, -1.2, 0.8)), "PERSP", 0, 0),
    ]
    files = []
    for name, direction, kind, view_w, view_h in views:
        cam_data.type = kind
        if kind == "ORTHO":
            cam_data.ortho_scale = max(max(view_w, view_h * cell_w / cell_h) * 1.1, 0.02)
        direction = direction.normalized()
        cam.location = center + direction * radius * (3.2 if kind == "PERSP" else 6)
        cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        out = job_path("preview-" + name + ".png")
        scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        files.append(out)
    bpy.data.objects.remove(cam, do_unlink=True)
    try:
        import numpy as np
        sheet = np.ones((cell_h * 2, cell_w * 2, 4), dtype=np.float32)
        for index, file in enumerate(files):
            img = bpy.data.images.load(file)
            px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
            row, col = divmod(index, 2)
            y0 = (1 - row) * cell_h
            sheet[y0:y0 + cell_h, col * cell_w:(col + 1) * cell_w] = px[:cell_h, :cell_w]
            bpy.data.images.remove(img)
        out_img = bpy.data.images.new("SealCodePreviewSheet", cell_w * 2, cell_h * 2, alpha=True)
        out_img.pixels = sheet.ravel()
        out_img.filepath_raw = path
        out_img.file_format = "PNG"
        out_img.save()
    except Exception:
        import shutil
        shutil.copyfile(files[-1], path)
    return True

_harp_carried = None

def _harp_select_for_export():
    meshes = [o for o in bpy.context.view_layer.objects if o.type == "MESH"]
    extras = [o for o in bpy.context.view_layer.objects if o.type == "ARMATURE" or (o.type == "EMPTY" and o.animation_data is not None and o.animation_data.action is not None)]
    for o in bpy.context.view_layer.objects:
        try:
            o.select_set(False)
        except Exception:
            pass
    for o in meshes + extras:
        try:
            o.select_set(True)
        except Exception:
            pass
    selected = []
    for o in meshes:
        try:
            if o.select_get():
                selected.append(o.name)
        except Exception:
            pass
    return selected

def _sealcode_export(path):
    global _harp_carried
    if not any(o.type == "MESH" for o in bpy.context.view_layer.objects):
        return False
    _harp_carried = _harp_select_for_export()
    kwargs = dict(filepath=path, export_selected_objects=True, export_materials=True, forward_axis="NEGATIVE_Z", up_axis="Y", export_triangulated_mesh=True)
    try:
        bpy.ops.wm.obj_export(**kwargs)
    except TypeError:
        kwargs.pop("export_triangulated_mesh", None)
        bpy.ops.wm.obj_export(**kwargs)
    return True

def _harp_export_glb(path):
    if _harp_carried is None:
        _harp_select_for_export()
    base = dict(filepath=path, export_format="GLB", use_selection=True)
    attempts = [
        dict(base, export_vertex_color="ACTIVE", export_animations=True),
        dict(base, export_colors=True, export_animations=True),
        dict(base),
    ]
    last = None
    for kwargs in attempts:
        try:
            bpy.ops.export_scene.gltf(**kwargs)
            return True
        except TypeError as e:
            last = e
    raise last

def _harp_bbox(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    return (Vector(map(min, *[(p.x, p.y, p.z) for p in pts])), Vector(map(max, *[(p.x, p.y, p.z) for p in pts])))

def _harp_side(name):
    import re
    m = re.search(r"(?:^|[._\-\s])(left|right|l|r)(?=$|[._\-\s\d])", name, re.I)
    if m:
        side = "L" if m.group(1).lower() in ("left", "l") else "R"
        return side, (name[:m.start(1)] + "*" + name[m.end(1):])
    m = re.match(r"^(Left|Right)(?=[A-Z_])", name)
    if m:
        return ("L" if m.group(1) == "Left" else "R"), "*" + name[m.end(1):]
    m = re.search(r"(?<=[a-z])(Left|Right)(?=$|[A-Z0-9_.])", name)
    if m:
        return ("L" if m.group(1) == "Left" else "R"), name[:m.start(1)] + "*" + name[m.end(1):]
    return None, None

def _harp_color_carriers(meshes):
    groups = {"vertexColors": [], "materialColor": [], "imageTexture": [], "none": []}
    for obj in meshes:
        vc = _harp_has_vertex_colors(obj)
        tex = flat = False
        for slot in obj.material_slots:
            mat = slot.material
            if mat is None:
                continue
            bsdf = None
            if mat.use_nodes:
                bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf is not None:
                socket = bsdf.inputs["Base Color"]
                if socket.is_linked:
                    if any(l.from_node.type == "TEX_IMAGE" for l in socket.links):
                        tex = True
                    else:
                        flat = True
                elif any(abs(c - 0.8) > 0.01 for c in socket.default_value[:3]):
                    flat = True
            elif any(abs(c - 0.8) > 0.01 for c in mat.diffuse_color[:3]):
                flat = True
        if vc:
            groups["vertexColors"].append(obj.name)
        if flat:
            groups["materialColor"].append(obj.name)
        if tex:
            groups["imageTexture"].append(obj.name)
        if not (vc or flat or tex):
            groups["none"].append(obj.name)
    present = {k: v[:12] for k, v in groups.items() if v}
    facts = []
    if groups["vertexColors"]:
        facts.append("Vertex colours go into the GLB (COLOR_0) and the preview. import_mesh ignores them: it builds MeshParts from material colours only.")
    if groups["materialColor"]:
        facts.append("Material base colours survive import_mesh (one MeshPart per material) and the GLB.")
    if groups["imageTexture"]:
        facts.append("Image textures are not read by import_mesh. They travel only inside the GLB and must be uploaded to Roblox as an image asset.")
    if groups["none"]:
        facts.append("Objects with no colour and no material import as default grey.")
    return {"carriers": present, "survivesImport": facts}

def _harp_near(tree, pts, tol):
    for p in pts:
        hit = tree.find_nearest(p)
        if hit is not None and hit[3] is not None and hit[3] <= tol:
            return True
    return False

def _harp_lint(report):
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    lint = {}
    tri_by_name = {m["name"]: m["triangles"] for m in report.get("meshes", [])}
    nonfinite = _harp_nonfinite()
    if nonfinite:
        lint["nonFiniteVertices"] = nonfinite
    hidden = []
    for o in meshes:
        flags = []
        if o.hide_viewport:
            flags.append("hide_viewport")
        if o.hide_render:
            flags.append("hide_render")
        try:
            if o.hide_get():
                flags.append("hidden_in_view_layer")
        except Exception:
            flags.append("not_in_view_layer")
        if flags:
            entry = {"object": o.name, "flags": flags}
            if _harp_carried is not None:
                entry["exported"] = o.name in _harp_carried
            hidden.append(entry)
    if hidden:
        lint["hiddenObjects"] = hidden
    lint["colorCarrier"] = _harp_color_carriers(meshes)
    objects = []
    for o in bpy.context.scene.objects:
        d = o.dimensions
        text = "%s %s %.3gx%.3gx%.3g" % (o.name, o.type, d.x, d.y, d.z)
        if o.parent is not None:
            text += " parent=" + o.parent.name
        objects.append(text)
    lint["objects"] = objects[:80]
    if len(objects) > 80:
        lint["objectsOmitted"] = len(objects) - 80
    sides = {}
    for o in meshes:
        side, key = _harp_side(o.name)
        if side is not None:
            sides.setdefault(key, {})[side] = o
    mismatched = []
    for key, pair in sides.items():
        if "L" in pair and "R" in pair:
            a, b = pair["L"], pair["R"]
            da, db = sorted(abs(x) for x in a.dimensions), sorted(abs(x) for x in b.dimensions)
            if any(abs(x - y) > max(0.002, 0.03 * max(x, y)) for x, y in zip(da, db)):
                mismatched.append({"left": a.name, "right": b.name, "leftDimensions": [round(x, 3) for x in a.dimensions], "rightDimensions": [round(x, 3) for x in b.dimensions]})
            elif tri_by_name.get(a.name) != tri_by_name.get(b.name):
                mismatched.append({"left": a.name, "right": b.name, "leftTriangles": tri_by_name.get(a.name), "rightTriangles": tri_by_name.get(b.name)})
    if mismatched:
        lint["sidesNotMirrored"] = mismatched[:20]
    carried = [o for o in meshes if _harp_carried is None or o.name in _harp_carried]
    if carried:
        los, his = zip(*[_harp_bbox(o) for o in carried])
        lo = Vector(map(min, *[(v.x, v.y, v.z) for v in los])) if len(los) > 1 else los[0]
        hi = Vector(map(max, *[(v.x, v.y, v.z) for v in his])) if len(his) > 1 else his[0]
        size = hi - lo
        lint["model"] = {"dimensions": [round(size.x, 3), round(size.y, 3), round(size.z, 3)], "triangles": sum(tri_by_name.get(o.name, 0) for o in carried), "parts": len(carried)}
    if len(carried) > 150:
        lint["partChecksSkipped"] = "More than 150 mesh objects: floating and overlap checks were not run."
        return lint
    if len(carried) >= 2 and not nonfinite:
        from mathutils.bvhtree import BVHTree
        depsgraph = bpy.context.evaluated_depsgraph_get()
        items = []
        for o in carried:
            try:
                ev = o.evaluated_get(depsgraph)
                me = ev.to_mesh()
                bm = bmesh.new()
                bm.from_mesh(me)
                ev.to_mesh_clear()
                bm.transform(o.matrix_world)
                if len(bm.faces) == 0:
                    bm.free()
                    continue
                pts = [v.co.copy() for v in bm.verts]
                lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
                hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
                step = max(1, len(pts) // 300)
                items.append({"name": o.name, "tree": BVHTree.FromBMesh(bm), "lo": lo, "hi": hi, "pts": pts[::step]})
                bm.free()
            except Exception:
                continue
        if len(items) >= 2:
            glo = Vector(map(min, *[(i["lo"].x, i["lo"].y, i["lo"].z) for i in items]))
            ghi = Vector(map(max, *[(i["hi"].x, i["hi"].y, i["hi"].z) for i in items]))
            tol = max(0.002, (ghi - glo).length * 0.004)
            parent = list(range(len(items)))
            def find(i):
                while parent[i] != i:
                    parent[i] = parent[parent[i]]
                    i = parent[i]
                return i
            touching = [0] * len(items)
            overlaps = []
            for i in range(len(items)):
                for j in range(i + 1, len(items)):
                    a, b = items[i], items[j]
                    if any(a["lo"][k] - tol > b["hi"][k] or b["lo"][k] - tol > a["hi"][k] for k in range(3)):
                        continue
                    cross = len(a["tree"].overlap(b["tree"])) > 0
                    near = cross or _harp_near(b["tree"], a["pts"], tol) or _harp_near(a["tree"], b["pts"], tol)
                    if near:
                        touching[i] += 1
                        touching[j] += 1
                        parent[find(i)] = find(j)
                    if cross:
                        ov = 1.0
                        for k in range(3):
                            ov *= max(0.0, min(a["hi"][k], b["hi"][k]) - max(a["lo"][k], b["lo"][k]))
                        va = (a["hi"] - a["lo"]).x * (a["hi"] - a["lo"]).y * (a["hi"] - a["lo"]).z
                        vb = (b["hi"] - b["lo"]).x * (b["hi"] - b["lo"]).y * (b["hi"] - b["lo"]).z
                        small = min(va, vb)
                        if small > 1e-9 and ov / small > 0.35:
                            overlaps.append({"a": a["name"], "b": b["name"], "overlapOfSmallerBox": round(ov / small, 2)})
            floating = [items[i]["name"] for i in range(len(items)) if touching[i] == 0]
            if floating:
                lint["floatingParts"] = floating[:20]
            comps = {}
            for i in range(len(items)):
                if touching[i]:
                    comps.setdefault(find(i), []).append(items[i]["name"])
            if len(comps) > 1:
                ordered = sorted(comps.values(), key=len, reverse=True)
                lint["separateGroups"] = [g[:12] for g in ordered[:8]]
            if overlaps:
                overlaps.sort(key=lambda e: e["overlapOfSmallerBox"], reverse=True)
                lint["interpenetrating"] = overlaps[:20]
            lint["touchTolerance"] = round(tol, 4)
    return lint

_status = {"scriptError": _sealcode_error}
try:
    _status["report"] = _sealcode_report()
except Exception as e:
    _status["reportError"] = str(e)
if os.environ.get("SEALCODE_PREVIEW") == "1":
    try:
        _status["preview"] = _sealcode_preview(job_path("preview.png"))
    except Exception as e:
        _status["previewError"] = str(e)
if os.environ.get("SEALCODE_EXPORT") == "1":
    try:
        _status["exported"] = _sealcode_export(job_path("model.obj"))
    except Exception as e:
        _status["exportError"] = str(e)
    try:
        if any(o.type == "MESH" for o in bpy.context.scene.objects):
            bad = _harp_nonfinite()
            if bad:
                raise ValueError("Non-finite vertex coordinates in: " + ", ".join(b["object"] for b in bad))
            _status["glb"] = _harp_export_glb(job_path("model.glb"))
    except Exception as e:
        _status["glbError"] = str(e)[:600]
try:
    _status["lint"] = _harp_lint(_status.get("report") or {})
except Exception as e:
    _status["lintError"] = str(e)
if os.environ.get("SEALCODE_SAVE_BLEND") == "1":
    try:
        bpy.ops.wm.save_as_mainfile(filepath=job_path("scene.blend"))
    except Exception as e:
        _status["saveError"] = str(e)
with open(job_path("sealcode-status.json"), "w") as f:
    json.dump(_harp_clean(_status), f)
`;
