"""Petri controlled Blender scene builder (no arbitrary user Python).

Invoked as:
  blender --background --factory-startup --python blender_scene.py -- \
    --scene scene.json --out outdir --views front,top,side,iso --formats glb,stl,obj

Input is a resolved SceneSpec v1 JSON. Only whitelisted primitive nodes are built.
"""
import argparse
import json
import math
import os
import sys

import bpy
import bmesh
import hashlib
from mathutils import Euler, Matrix, Vector


def parse_args():
    argv = sys.argv
    tail = argv[argv.index('--') + 1:] if '--' in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--scene', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--views', default='front,top,side,iso')
    parser.add_argument('--formats', default='glb,stl,obj')
    parser.add_argument('--root', default='')
    return parser.parse_args(tail)


def srgb_to_linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def set_bsdf_input(bsdf, names, value):
    """按候选属性名设置 Principled 输入。

    Blender 小版本会改输入名（实测布尔的 solver/solver_mode 同名漂移），设错名字是**静默无效**
    而非报错——因此按候选名探测，探不到就不假装生效。
    """
    for name in names:
        if name in bsdf.inputs:
            bsdf.inputs[name].default_value = value
            return True
    return False


def apply_base_color_texture(mat, bsdf, texture, root):
    """基础色贴图：工作区相对路径 + 逐字节 sha256 复验，再挂 Image Texture → Base Color。

    路径守卫复用 resolve_mesh_path（同一份工作区逃逸检查，不另写第二套；因此逃逸错误沿用
    mesh_ 前缀）。缺失/越界/篡改一律显式抛错，由 main() 落进 unsupported[]——「贴图没生效但
    渲染照常出图」正是要防的静默失真（红线 3 + 红线 4）。
    """
    relative_path = str(texture.get('path') or '')
    expected = str(texture.get('sourceSha256') or '').lower()
    if not root:
        raise ValueError('texture_root_required')
    if not expected:
        raise ValueError('texture_source_hash_required')
    full = resolve_mesh_path(root, relative_path)
    if os.path.splitext(full)[1].lower() not in TEXTURE_EXTENSIONS:
        raise ValueError('texture_format_unsupported')
    if not os.path.isfile(full):
        raise ValueError('texture_not_found')
    if os.path.getsize(full) > MAX_TEXTURE_BYTES:
        raise ValueError('texture_too_large')
    if sha256_file(full) != expected:
        raise ValueError('texture_source_hash_mismatch')
    image = bpy.data.images.load(full)
    image.colorspace_settings.name = 'sRGB'
    tree = mat.node_tree
    texture_node = tree.nodes.new(type='ShaderNodeTexImage')
    texture_node.image = image
    texture_node.location = (-420, 300)
    tree.links.new(texture_node.outputs['Color'], bsdf.inputs['Base Color'])
    return image


def material_for(spec, root=''):
    color = (spec or {}).get('color', '#8899aa')
    rgba = tuple(srgb_to_linear(int(color[i:i + 2], 16) / 255.0) for i in (1, 3, 5)) + (1.0,)
    mat = bpy.data.materials.new(name=f"mat-{color}")
    mat.diffuse_color = rgba
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = rgba
        bsdf.inputs['Roughness'].default_value = float((spec or {}).get('roughness', 0.7))
        # BLOCK-322 P2-03 — PBR 扩展：未声明的字段保持 Blender 默认，不顺手改存量外观。
        if (spec or {}).get('metallic') is not None:
            set_bsdf_input(bsdf, ('Metallic',), float(spec['metallic']))
        if (spec or {}).get('emissive'):
            set_bsdf_input(bsdf, ('Emission Color', 'Emission'), hex_to_rgbaf(spec['emissive']))
            set_bsdf_input(bsdf, ('Emission Strength',), 1.0)
        if (spec or {}).get('baseColorTexture'):
            apply_base_color_texture(mat, bsdf, spec['baseColorTexture'], root)
    return mat


def apply_transform(obj, node):
    transform = node.get('transform') or {}
    position = transform.get('position') or [0, 0, 0]
    rotation = transform.get('rotation') or [0, 0, 0]
    obj.location = Vector(position)
    obj.rotation_euler = tuple(math.radians(float(v)) for v in rotation)


def bake_scale(obj, dimensions):
    """把尺寸烘进 mesh 顶点，使 obj.scale 归一。

    modifier（bevel 宽度、array 偏移、boolean 余量）都在**局部单位**下工作：
    留着 obj.scale 就等于让「8mm 倒角」按缩放后的倍数生效（实测把 40mm 的边削掉一半、
    140mm 阵列偏移变成 67200mm）。世界矩阵不变 ⇒ 未加 modifier 的存量场景体积与出图不受影响。
    """
    for vert in obj.data.vertices:
        vert.co.x *= dimensions[0]
        vert.co.y *= dimensions[1]
        vert.co.z *= dimensions[2]
    obj.scale = (1.0, 1.0, 1.0)


def add_node(node, root=''):
    dimensions = node.get('dimensions') or {}
    kind = node.get('type')
    if kind == 'box':
        bpy.ops.mesh.primitive_cube_add(size=1)
        obj = bpy.context.object
        bake_scale(obj, (
            float(dimensions['width']),
            float(dimensions['depth']),
            float(dimensions['height']),
        ))
    elif kind == 'cylinder':
        bpy.ops.mesh.primitive_cylinder_add(radius=float(dimensions['radius']), depth=float(dimensions['height']))
        obj = bpy.context.object
    elif kind == 'sphere':
        bpy.ops.mesh.primitive_uv_sphere_add(radius=float(dimensions['radius']))
        obj = bpy.context.object
    elif kind == 'plane':
        bpy.ops.mesh.primitive_plane_add(size=1)
        obj = bpy.context.object
        bake_scale(obj, (float(dimensions['width']), float(dimensions['height']), 1.0))
    elif kind in ('group', 'mesh-reference'):
        return None
    else:
        raise ValueError(f'unsupported_node_type:{kind}')
    obj.name = node.get('id') or kind
    obj.data.name = f"{obj.name}-mesh"
    obj.data.materials.append(material_for(node.get('material'), root))
    apply_transform(obj, node)
    return obj


MAX_MESH_BYTES = 64 * 1024 * 1024
MESH_EXTENSIONS = {'.stl', '.obj', '.glb', '.gltf'}
# BLOCK-322 P2-03 — 基础色贴图白名单与上限（与 core/petri-server/helpers/mesh-assets.js 逐值对账）。
MAX_TEXTURE_BYTES = 16 * 1024 * 1024
TEXTURE_EXTENSIONS = {'.png', '.jpg', '.jpeg'}


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_mesh_path(root, relative_path):
    if not root:
        raise ValueError('mesh_import_root_required')
    if os.path.isabs(relative_path) or any(part == '..' for part in relative_path.replace('\\', '/').split('/')):
        raise ValueError('mesh_path_outside_workspace')
    root_real = os.path.realpath(root)
    full = os.path.realpath(os.path.join(root_real, relative_path))
    if full != root_real and not full.startswith(root_real + os.sep):
        raise ValueError('mesh_path_outside_workspace')
    return full


def import_mesh_reference(node, root):
    source = node.get('source') or {}
    relative_path = str(source.get('path') or '')
    expected = str(source.get('sourceSha256') or '').lower()
    full = resolve_mesh_path(root, relative_path)
    extension = os.path.splitext(full)[1].lower()
    if extension not in MESH_EXTENSIONS:
        raise ValueError('mesh_format_unsupported')
    if not os.path.isfile(full):
        raise ValueError('mesh_not_found')
    if os.path.getsize(full) > MAX_MESH_BYTES:
        raise ValueError('mesh_too_large')
    if sha256_file(full) != expected:
        raise ValueError('mesh_source_hash_mismatch')
    before = set(bpy.data.objects)
    if extension == '.stl':
        try:
            bpy.ops.wm.stl_import(filepath=full)
        except Exception:
            bpy.ops.import_mesh.stl(filepath=full)
    elif extension in ('.glb', '.gltf'):
        # BLOCK-322 P1 — GLB/GLTF 作为场景资产：glTF 导入保留自带节点层级与材质。
        bpy.ops.import_scene.gltf(filepath=full)
    else:
        bpy.ops.wm.obj_import(filepath=full)
    imported = [obj for obj in bpy.data.objects if obj not in before]
    meshes = [obj for obj in imported if obj.type == 'MESH']
    if not meshes:
        raise ValueError('mesh_import_empty')
    transform = node.get('transform') or {}
    position = transform.get('position') or [0, 0, 0]
    rotation = transform.get('rotation') or [0, 0, 0]
    matrix = Matrix.Translation(Vector(position)) @ Euler(
        tuple(math.radians(float(v)) for v in rotation), 'XYZ'
    ).to_matrix().to_4x4()
    prefix = node.get('id') or 'mesh'
    for obj in imported:
        if obj.parent is None:
            obj.matrix_world = matrix @ obj.matrix_world
        obj.name = f'{prefix}:{obj.name}'
    return meshes


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)


MODIFIER_KINDS = {'bevel': 'BEVEL', 'array': 'ARRAY', 'boolean': 'BOOLEAN'}
BOOLEAN_OPERATIONS = {'union': 'UNION', 'difference': 'DIFFERENCE', 'intersect': 'INTERSECT'}


def apply_modifiers(nodes, hosts):
    """按声明顺序给节点挂 modifier（BLOCK-322 P3-01）。

    求值发生在 Blender 一侧：预览端不重做几何（客户端 CSG 会造出第二套几何执行器，
    且两侧结果不一致时 SceneSpec 就不再是唯一真值），故预览只显示基元并显式声明差异。
    boolean 的刀体在求值后被消费（它不是产品几何的一部分），因此导出与网格报告都不含它。
    """
    consumed = []
    applied = []
    for node in nodes:
        node_id = node.get('id')
        modifiers = node.get('modifiers') or []
        targets = hosts.get(node_id) or []
        if not modifiers:
            continue
        for spec in modifiers:
            kind = str(spec.get('kind') or '')
            modifier_kind = MODIFIER_KINDS.get(kind)
            if not modifier_kind:
                raise ValueError(f"unsupported_modifier:{kind or 'unknown'}")
            if kind == 'boolean':
                cutter_id = spec.get('target')
                cutters = hosts.get(cutter_id) or []
                if not cutters:
                    raise ValueError(f'boolean_target_missing:{cutter_id}')
                operation = BOOLEAN_OPERATIONS.get(str(spec.get('operation') or 'difference'))
                if not operation:
                    raise ValueError(f"boolean_operation_unknown:{spec.get('operation')}")
                for obj in targets:
                    modifier = obj.modifiers.new(f'petri-boolean-{cutter_id}', modifier_kind)
                    modifier.operation = operation
                    modifier.object = cutters[0]
                    # Blender 4.x 属性名是 solver（旧版为 solver_mode）；EXACT 才给体积/水密可信结果。
                    for attr in ('solver', 'solver_mode'):
                        if hasattr(modifier, attr):
                            setattr(modifier, attr, 'EXACT')
                            break
                consumed.append({'target': cutter_id, 'on': node_id, 'operation': operation})
            elif kind == 'array':
                offset = spec.get('offset') or [0, 0, 0]
                for obj in targets:
                    modifier = obj.modifiers.new('petri-array', modifier_kind)
                    modifier.count = int(spec.get('count') or 1)
                    modifier.use_relative_offset = False
                    modifier.use_constant_offset = True
                    modifier.constant_offset_displace = Vector(offset)
            else:
                for obj in targets:
                    modifier = obj.modifiers.new('petri-bevel', modifier_kind)
                    modifier.width = float(spec.get('width') or 1.0)
                    modifier.segments = int(spec.get('segments') or 2)
                    modifier.limit_method = 'NONE'
            applied.append({'node': node_id, 'kind': kind})
    return {'applied': applied, 'consumed': [item for item in consumed if item]}


def realize_modifiers(objects):
    """把 modifier 结果烘焙回真实 mesh 数据。

    必须先烘焙再删刀体：Boolean modifier 引用被删对象后会失效，
    求值结果连带丢失（表现为「刀白切了」）。
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        if obj.type != 'MESH' or not obj.modifiers:
            continue
        evaluated = obj.evaluated_get(depsgraph)
        if evaluated is None:
            continue
        baked = bpy.data.meshes.new_from_object(evaluated)
        previous = obj.data
        obj.data = baked
        evaluated.to_mesh_clear()
        # 烘焙即消费：modifier 留着会被下游二次求值（实测阵列被平方成 ×9 而非 ×3）。
        obj.modifiers.clear()
        if previous is not None and previous.users == 0:
            bpy.data.meshes.remove(previous)


def drop_consumed(objects, consumed):
    """刀体求值后从场景移除：留在场景里会被当成产品几何导出（体积与外观都会双计）。"""
    if not consumed:
        return objects, []
    doomed = set()
    for item in consumed:
        for obj in objects:
            if obj.name == item['target'] or obj.name.startswith(f"{item['target']}:"):
                doomed.add(obj.name)
    kept = []
    for obj in objects:
        if obj.name in doomed:
            try:
                bpy.data.objects.remove(obj, do_unlink=True)
            except Exception:
                kept.append(obj)
            continue
        kept.append(obj)
    return kept, sorted(doomed)


def evaluated_mesh(obj, depsgraph):
    evaluated = obj.evaluated_get(depsgraph)
    return evaluated.to_mesh() if evaluated is not None else None


def mesh_report(objects):
    report = {'objects': 0, 'vertices': 0, 'triangles': 0, 'nonManifoldEdges': 0, 'watertight': True, 'volumesMm3': {}}
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        if obj.type != 'MESH':
            continue
        mesh = evaluated_mesh(obj, depsgraph) or obj.data
        if not mesh or not mesh.polygons:
            if mesh is not None:
                obj.evaluated_get(depsgraph).to_mesh_clear()
            continue
        report['objects'] += 1
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bm.transform(obj.matrix_world)
        bm.verts.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        non_manifold = sum(1 for edge in bm.edges if len(edge.link_faces) != 2)
        volume = abs(bm.calc_volume(signed=False)) if bm.faces else 0
        report['vertices'] += len(bm.verts)
        report['triangles'] += sum(max(0, len(face.verts) - 2) for face in bm.faces)
        report['nonManifoldEdges'] += non_manifold
        report['volumesMm3'][obj.name] = round(volume, 6)
        if non_manifold > 0:
            report['watertight'] = False
        bm.free()
        if mesh is not obj.data:
            obj.evaluated_get(depsgraph).to_mesh_clear()
    return report


def scene_bounds(objects):
    points = []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        if obj.type != 'MESH':
            continue
        source = obj.evaluated_get(depsgraph) or obj
        for corner in source.bound_box:
            points.append(obj.matrix_world @ Vector(corner))
    if not points:
        points = [Vector((0, 0, 0)), Vector((10, 10, 10))]
    min_v = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    max_v = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return min_v, max_v


def setup_camera(bounds):
    min_v, max_v = bounds
    center = (min_v + max_v) / 2.0
    size = max(1.0, max(max_v.x - min_v.x, max_v.y - min_v.y, max_v.z - min_v.z))
    camera_data = bpy.data.cameras.new('petri-camera')
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = size * 1.5
    camera = bpy.data.objects.new('petri-camera', camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    return camera, center, size

# BLOCK-322 P2-01 — 声明相机：Sensor 垂直贴合，使 camera.fovDeg 与 Three.js
# PerspectiveCamera 的垂直 fov 同轴可对账（Blender 默认 sensor_fit 为 AUTO，
# 不显式指定时会按宽边折算，两侧就不是同一个角）。
BLENDER_VERTICAL_SENSOR_MM = 24.0


def fov_to_lens(fov_deg):
    return BLENDER_VERTICAL_SENSOR_MM / 2.0 / math.tan(math.radians(float(fov_deg)) / 2.0)


def aim_with_up(camera, position, target, up):
    """显式上向量的 look-at：Blender 相机沿 -Z 看、+Y 为上，故旋转矩阵列=(右, 上, 后)。"""
    forward = (Vector(target) - Vector(position)).normalized()
    up_vec = Vector(up).normalized()
    right = forward.cross(up_vec)
    if right.length < 1e-9:
        return False
    right.normalize()
    true_up = right.cross(forward).normalized()
    backward = forward * -1.0
    rotation = Matrix((
        (right[0], true_up[0], backward[0]),
        (right[1], true_up[1], backward[1]),
        (right[2], true_up[2], backward[2]),
    ))
    camera.rotation_mode = 'QUATERNION'
    camera.rotation_quaternion = rotation.to_quaternion()
    return True


def build_declared_camera(spec):
    data = bpy.data.cameras.new('petri-declared-camera')
    data.sensor_fit = 'VERTICAL'
    projection = str(spec.get('projection') or 'perspective').lower()
    fov_deg = float(spec.get('fovDeg') or 40.0)
    if projection == 'orthographic':
        data.type = 'ORTHO'
        data.ortho_scale = float(spec.get('orthoScaleMm') or 100.0)
    else:
        data.type = 'PERSP'
        data.sensor_height = BLENDER_VERTICAL_SENSOR_MM
        data.lens = fov_to_lens(fov_deg)
    camera = bpy.data.objects.new('petri-declared-camera', data)
    bpy.context.scene.collection.objects.link(camera)
    position = spec.get('position') or [0, 0, 0]
    target = spec.get('target') or [0, 0, 0]
    camera.location = Vector(position)
    up_applied = False
    if spec.get('up'):
        up_applied = aim_with_up(camera, position, target, spec['up'])
    if not up_applied:
        aim(camera, position, target)
    return {
        'object': camera,
        'summary': {
            'projection': data.type,
            'declaredFovDeg': fov_deg,
            'effectiveAngleYDeg': round(math.degrees(data.angle_y), 6) if data.type == 'PERSP' else None,
            'orthoScaleMm': float(data.ortho_scale) if data.type == 'ORTHO' else None,
            'sensorFit': str(data.sensor_fit),
            'position': [float(v) for v in position],
            'target': [float(v) for v in target],
            'declaredUp': [float(v) for v in spec['up']] if spec.get('up') else None,
            'upApplied': up_applied,
        },
    }


DEFAULT_RESOLUTION = (800, 600)
MIN_RESOLUTION_PX = 16
MAX_RESOLUTION_PX = 4096


def effective_resolution(render_spec):
    """渲染分辨率取值的唯一判定：非法/缺失一律回落 800×600（与校验层同界）。"""
    spec = render_spec if isinstance(render_spec, dict) else {}

    def pick(value, fallback):
        if isinstance(value, bool) or not isinstance(value, int):
            return fallback
        return value if MIN_RESOLUTION_PX <= value <= MAX_RESOLUTION_PX else fallback

    return pick(spec.get('width'), DEFAULT_RESOLUTION[0]), pick(spec.get('height'), DEFAULT_RESOLUTION[1])


def apply_render_settings(render_spec):
    width, height = effective_resolution(render_spec)
    bpy.context.scene.render.resolution_x = width
    bpy.context.scene.render.resolution_y = height
    return {'width': width, 'height': height, 'declared': bool(render_spec)}


def aim(camera, location, target):
    camera.location = location
    direction = Vector(target) - Vector(location)
    camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


LIGHT_KINDS = {'sun': 'SUN', 'point': 'POINT', 'spot': 'SPOT', 'area': 'AREA'}


def hex_to_rgbaf(value, fallback=(1.0, 1.0, 1.0, 1.0)):
    color = str(value or '')
    if len(color) != 7 or not color.startswith('#'):
        return fallback
    try:
        return tuple(srgb_to_linear(int(color[i:i + 2], 16) / 255.0) for i in (1, 3, 5)) + (1.0,)
    except ValueError:
        return fallback


def has_pbr_material(scene_spec):
    """场景是否声明了 Workbench 不认的材质项（metallic/emissive/基础色贴图）。"""
    for node in scene_spec.get('nodes') or []:
        spec = (node or {}).get('material') or {}
        if float(spec.get('metallic') or 0) > 0 or spec.get('emissive') or spec.get('baseColorTexture'):
            return True
    return False


def materials_report(scene_spec):
    """回显声明的 PBR 材质项：报告里能看到「哪个节点声明了什么」，与像素对照可复核。"""
    rows = []
    for node in scene_spec.get('nodes') or []:
        spec = (node or {}).get('material') or {}
        if spec.get('metallic') is None and not spec.get('emissive') and not spec.get('baseColorTexture'):
            continue
        texture = spec.get('baseColorTexture') or {}
        rows.append({
            'id': node.get('id'),
            'metallic': float(spec.get('metallic') or 0),
            'emissive': spec.get('emissive') or None,
            'baseColorTexture': texture.get('path') or None,
        })
    return rows


def configure_display(scene_spec):
    """引擎与着色策略（BLOCK-322 P2-02 / P2-03）。

    实测：Blender 4.5.10 无头 CYCLES(CPU) 640×480/8 采样 0.61s 可用；BLENDER_EEVEE_NEXT
    无头走软件回退，同场景 13.34s 不可用。故只在场景**声明**灯光/环境/PBR 材质时才切 CYCLES，
    未声明仍是 WORKBENCH——既让灯真的起作用，也不给存量场景加时延。
    P2-03 同一条理由扩到材质：Workbench 的 MATERIAL 着色只看基础色，metallic/emissive/贴图
    在它下面完全不生效，若不同步切引擎就是「加了贴图但图上看不见」的第二类静默失真。
    """
    environment = scene_spec.get('environment')
    lights = scene_spec.get('lights') or []
    declared_material = has_pbr_material(scene_spec)
    declared = bool(environment) or bool(lights) or declared_material
    requested = str((environment or {}).get('engine') or ('cycles' if declared else 'workbench')).lower()
    scene = bpy.context.scene
    if requested == 'cycles':
        scene.render.engine = 'CYCLES'
        scene.cycles.device = 'CPU'
        scene.cycles.use_denoising = False
        scene.cycles.samples = int((environment or {}).get('samples') or 8)
    else:
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.color_type = 'MATERIAL'
        scene.display.shading.show_shadows = True
        scene.display.shading.show_cavity = True
    return {
        'engine': scene.render.engine,
        'declaredLighting': declared,
        'declaredMaterial': declared_material,
        'requestedEngine': requested,
        'samples': int(scene.cycles.samples) if scene.render.engine == 'CYCLES' else None,
        'device': 'CPU' if scene.render.engine == 'CYCLES' else None,
    }


def apply_environment(environment):
    """World 背景：声明即写入；未声明则保留工厂默认并在回显里说明（预览端同基准）。"""
    world = bpy.context.scene.world or bpy.data.worlds.new('petri-world')
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get('Background')
    echo = {'declared': bool(environment), 'background': None, 'worldStrength': None}
    if isinstance(environment, dict):
        strength = float(environment.get('worldStrength') if environment.get('worldStrength') is not None else 1.0)
        if background is not None:
            if environment.get('background'):
                background.inputs['Color'].default_value = hex_to_rgbaf(environment['background'])
            background.inputs['Strength'].default_value = strength
        echo['background'] = environment.get('background')
        echo['worldStrength'] = strength
    echo['effectiveWorldStrength'] = float(background.inputs['Strength'].default_value) if background is not None else None
    echo['effectiveColor'] = [round(float(v), 6) for v in background.inputs['Color'].default_value[:3]] if background is not None else None
    return echo


def add_lights(lights):
    created = []
    for spec in lights:
        kind = LIGHT_KINDS.get(str(spec.get('kind') or '').lower())
        if not kind:
            raise ValueError(f"unsupported_light_kind:{spec.get('kind')}")
        data = bpy.data.lights.new(str(spec.get('id') or 'light'), kind)
        data.energy = float(spec.get('energy') if spec.get('energy') is not None else 1.0)
        if spec.get('color'):
            data.color = hex_to_rgbaf(spec['color'])[:3]
        position = spec.get('position') or [0, 0, 0]
        target = spec.get('target') or [0, 0, 0]
        if kind in ('POINT', 'SPOT') and spec.get('size') is not None:
            data.shadow_soft_size = float(spec['size'])
        if kind == 'AREA' and spec.get('size') is not None:
            data.size = float(spec['size'])
        if kind == 'SPOT' and spec.get('spotDeg') is not None:
            data.spot_size = math.radians(float(spec['spotDeg']))
        obj = bpy.data.objects.new(data.name, data)
        bpy.context.scene.collection.objects.link(obj)
        aim(obj, position, target)
        created.append({
            'id': data.name,
            'kind': kind,
            'energy': data.energy,
            'color': [round(float(v), 6) for v in data.color],
            'position': [float(v) for v in position],
            'target': [float(v) for v in target],
        })
    return created


def render_views(out_dir, views, bounds, declared_spec=None):
    camera, center, size = setup_camera(bounds)
    declared = build_declared_camera(declared_spec) if isinstance(declared_spec, dict) else None
    bpy.context.scene.render.resolution_percentage = 100
    bpy.context.scene.render.image_settings.file_format = 'PNG'
    paths = {}
    distance = size * 2.5
    locations = {
        'front': (center.x, center.y - distance, center.z),
        'top': (center.x, center.y, center.z + distance),
        'side': (center.x + distance, center.y, center.z),
        'iso': (center.x + distance * 0.75, center.y - distance * 0.75, center.z + distance * 0.8),
    }
    for view in views:
        if view == 'camera':
            # 未声明相机即跳过：不出「假装是声明机位」的图。
            if declared is None:
                continue
            bpy.context.scene.camera = declared['object']
        elif view in locations:
            bpy.context.scene.camera = camera
            aim(camera, locations[view], center)
        else:
            continue
        path = os.path.join(out_dir, f'{view}.png')
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths[view] = path
    return paths, declared


def select_mesh_objects(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def export_formats(out_dir, formats, objects):
    select_mesh_objects(objects)
    paths = {}
    if 'glb' in formats:
        path = os.path.join(out_dir, 'scene.glb')
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_cameras=False, export_lights=False)
        paths['glb'] = path
    if 'stl' in formats:
        path = os.path.join(out_dir, 'scene.stl')
        bpy.ops.wm.stl_export(filepath=path, export_selected_objects=True)
        paths['stl'] = path
    if 'obj' in formats:
        path = os.path.join(out_dir, 'scene.obj')
        bpy.ops.wm.obj_export(filepath=path, export_selected_objects=True)
        paths['obj'] = path
    return paths


def main():
    args = parse_args()
    with open(args.scene, 'r', encoding='utf-8') as handle:
        scene = json.load(handle)
    os.makedirs(args.out, exist_ok=True)
    clear_scene()
    objects = []
    unsupported = []
    hosts = {}
    for node in scene.get('nodes', []):
        try:
            if node.get('type') == 'mesh-reference':
                built = import_mesh_reference(node, args.root)
            else:
                obj = add_node(node, args.root)
                built = [obj] if obj is not None else []
            if built:
                objects.extend(built)
                hosts[str(node.get('id'))] = built
        except Exception as error:
            unsupported.append({'id': node.get('id'), 'error': str(error)})
    geometry_errors = []
    geometry = {'applied': [], 'consumed': [], 'dropped': []}
    try:
        geometry = apply_modifiers(scene.get('nodes', []), hosts)
        realize_modifiers(objects)
        objects, dropped = drop_consumed(objects, geometry['consumed'])
        geometry['dropped'] = dropped
    except Exception as error:
        geometry_errors.append(str(error))
    views = [item.strip() for item in args.views.split(',') if item.strip()]
    formats = [item.strip() for item in args.formats.split(',') if item.strip()]
    bounds = scene_bounds(objects)
    display = configure_display(scene)
    environment_echo = apply_environment(scene.get('environment'))
    light_errors = []
    try:
        lights_created = add_lights(scene.get('lights') or [])
    except Exception as error:
        lights_created = []
        light_errors.append(str(error))
    render_settings = apply_render_settings(scene.get('render'))
    render_paths, declared = render_views(args.out, views, bounds, scene.get('camera'))
    export_paths = export_formats(args.out, formats, objects)
    report = {
        'ok': len(unsupported) == 0 and not light_errors and not geometry_errors,
        'blenderVersion': bpy.app.version_string,
        'renderEngine': bpy.context.scene.render.engine,
        'display': display,
        'environment': environment_echo,
        'lights': {'created': lights_created, 'errors': light_errors},
        'geometry': {**geometry, 'errors': geometry_errors},
        'materials': {'declared': materials_report(scene)},
        'mesh': mesh_report(objects),
        'camera': {
            'declared': isinstance(scene.get('camera'), dict),
            'applied': declared is not None,
            **((declared or {}).get('summary') or {}),
        },
        'render': render_settings,
        'boundsMm': {
            'min': list(bounds[0]),
            'max': list(bounds[1]),
            'size': list(bounds[1] - bounds[0]),
        },
        'renders': render_paths,
        'exports': export_paths,
        'unsupported': unsupported,
    }
    report_path = os.path.join(args.out, 'blender-report.json')
    with open(report_path, 'w', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print('PETRI_BLENDER_REPORT=' + report_path)


if __name__ == '__main__':
    main()
