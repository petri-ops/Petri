/**
 * BLOCK-322 P1 — 外部资产格式契约（GBL/GLTF 进 SceneSpec）。
 *
 * 机械门禁：blender_scene.py 的 MESH_EXTENSIONS 必须覆盖 stl/obj/glb/gltf，
 * 且 glb/gltf 走 import_scene.gltf 分支（不能落到 obj_import 误读）。
 * 真实构建由实机腿（REST 导出）承索，本测防"扩展名加了但导入分支没加"的漂移。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILDER = fs.readFileSync(path.join(ROOT, 'resources/model3d/blender_scene.py'), 'utf8');

describe('BLOCK-322 P1 外部资产格式契约', () => {
  it('MESH_EXTENSIONS 覆盖 stl/obj/glb/gltf', () => {
    const match = BUILDER.match(/MESH_EXTENSIONS\s*=\s*\{([^}]*)\}/);
    assert.ok(match, '找不到 MESH_EXTENSIONS');
    for (const ext of ["'.stl'", "'.obj'", "'.glb'", "'.gltf'"]) {
      assert.ok(match[1].includes(ext), `MESH_EXTENSIONS 缺 ${ext}`);
    }
  });

  it('glb/gltf 走 glTF 导入分支（不落 obj_import）', () => {
    assert.match(BUILDER, /extension in \('\.glb', '\.gltf'\)/);
    assert.match(BUILDER, /import_scene\.gltf\(filepath=full\)/);
  });
});
