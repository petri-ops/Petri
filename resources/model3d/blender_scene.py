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


def material_for(spec):
    color = (spec or {}).get('color', '#8899aa')
    rgba = tuple(srgb_to_linear(int(color[i:i + 2], 16) / 255.0) for i in (1, 3, 5)) + (1.0,)
    mat = bpy.data.materials.new(name=f"mat-{color}")
    mat.diffuse_color = rgba
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = rgba
        bsdf.inputs['Roughness'].default_value = float((spec or {}).get('roughness', 0.7))
    return mat


def apply_transform(obj, node):
    transform = node.get('transform') or {}
    position = transform.get('position') or [0, 0, 0]
    rotation = transform.get('rotation') or [0, 0, 0]
    obj.location = Vector(position)
    obj.rotation_euler = tuple(math.radians(float(v)) for v in rotation)


def add_node(node):
    dimensions = node.get('dimensions') or {}
    kind = node.get('type')
    if kind == 'box':
        bpy.ops.mesh.primitive_cube_add(size=1)
        obj = bpy.context.object
        obj.scale = (
            float(dimensions['width']),
            float(dimensions['depth']),
            float(dimensions['height']),
        )
    elif kind == 'cylinder':
        bpy.ops.mesh.primitive_cylinder_add(radius=float(dimensions['radius']), depth=float(dimensions['height']))
        obj = bpy.context.object
    elif kind == 'sphere':
        bpy.ops.mesh.primitive_uv_sphere_add(radius=float(dimensions['radius']))
        obj = bpy.context.object
    elif kind == 'plane':
        bpy.ops.mesh.primitive_plane_add(size=1)
        obj = bpy.context.object
        obj.scale = (float(dimensions['width']), float(dimensions['height']), 1.0)
    elif kind in ('group', 'mesh-reference'):
        return None
    else:
        raise ValueError(f'unsupported_node_type:{kind}')
    obj.name = node.get('id') or kind
    obj.data.name = f"{obj.name}-mesh"
    obj.data.materials.append(material_for(node.get('material')))
    apply_transform(obj, node)
    return obj


MAX_MESH_BYTES = 64 * 1024 * 1024
MESH_EXTENSIONS = {'.stl', '.obj', '.glb', '.gltf'}


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


def mesh_report(objects):
    report = {'objects': 0, 'vertices': 0, 'triangles': 0, 'nonManifoldEdges': 0, 'watertight': True, 'volumesMm3': {}}
    for obj in objects:
        if obj.type != 'MESH':
            continue
        report['objects'] += 1
        bm = bmesh.new()
        bm.from_mesh(obj.data)
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
    return report


def scene_bounds(objects):
    points = []
    for obj in objects:
        if obj.type != 'MESH':
            continue
        for corner in obj.bound_box:
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


def aim(camera, location, target):
    camera.location = location
    direction = Vector(target) - Vector(location)
    camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def render_views(out_dir, views, bounds):
    camera, center, size = setup_camera(bounds)
    bpy.context.scene.render.engine = 'BLENDER_WORKBENCH'
    bpy.context.scene.display.shading.light = 'STUDIO'
    bpy.context.scene.display.shading.color_type = 'MATERIAL'
    bpy.context.scene.display.shading.show_shadows = True
    bpy.context.scene.display.shading.show_cavity = True
    bpy.context.scene.render.resolution_x = 800
    bpy.context.scene.render.resolution_y = 600
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
        if view not in locations:
            continue
        aim(camera, locations[view], center)
        path = os.path.join(out_dir, f'{view}.png')
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths[view] = path
    return paths


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
    for node in scene.get('nodes', []):
        try:
            if node.get('type') == 'mesh-reference':
                objects.extend(import_mesh_reference(node, args.root))
                continue
            obj = add_node(node)
            if obj is not None:
                objects.append(obj)
        except Exception as error:
            unsupported.append({'id': node.get('id'), 'error': str(error)})
    views = [item.strip() for item in args.views.split(',') if item.strip()]
    formats = [item.strip() for item in args.formats.split(',') if item.strip()]
    bounds = scene_bounds(objects)
    render_paths = render_views(args.out, views, bounds)
    export_paths = export_formats(args.out, formats, objects)
    report = {
        'ok': len(unsupported) == 0,
        'blenderVersion': bpy.app.version_string,
        'renderEngine': bpy.context.scene.render.engine,
        'mesh': mesh_report(objects),
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
