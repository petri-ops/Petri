import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const assetContract = require('../core/petri-server/helpers/mesh-assets.js');
const scene3d = require('../core/petri-server/helpers/scene3d.js');

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

function tempWorkspace(prefix = 'b322-texture-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeAsset(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function box(id, extra = {}) {
  return {
    id,
    type: 'box',
    dimensions: { width: 120, height: 40, depth: 80 },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    ...extra,
  };
}

function scene(nodes) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes,
  };
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

test('BLOCK-322 P2-03 — 材质白名单通过校验且随值换哈希', () => {
  const nodes = [box('a', {
    material: {
      color: '#4c78a8',
      roughness: 0.35,
      metallic: 0.9,
      emissive: '#123456',
      baseColorTexture: { path: 'model3d/textures/panel.png', sourceSha256: 'b'.repeat(64) },
    },
  })];
  const validated = scene3d.validateSceneSpec(scene(nodes));
  assert.equal(validated.ok, true, JSON.stringify(validated.errors));
  const tweaked = scene([box('a', {
    material: { color: '#4c78a8', metallic: 0.2, baseColorTexture: { path: 'model3d/textures/panel.png', sourceSha256: 'c'.repeat(64) } },
  })]);
  assert.notEqual(scene3d.hashSceneSpec(scene(nodes)), scene3d.hashSceneSpec(tweaked), '材质/贴图变更必须换哈希');
});

test('BLOCK-322 P2-03 — 非法材质逐条 fail-closed（未知键不静默忽略）', () => {
  const cases = [
    [{ metalness: 0.5 }, '.material.metalness 不在材质白名单'],
    [{ roughness: 1.4 }, '.material.roughness 须在 0..1'],
    [{ metallic: -1 }, '.material.metallic 须在 0..1'],
    [{ metallic: 'shiny' }, '.material.metallic 须在 0..1'],
    [{ emissive: 'white' }, '.material.emissive 非法'],
    [{ color: '#4c78a' }, '.material.color 非法'],
    ['not-an-object', '.material 必须是对象'],
    [{ baseColorTexture: { path: 'panel.svg', sourceSha256: 'a'.repeat(64) } }, 'texture_format_unsupported'],
    [{ baseColorTexture: { path: '/etc/passwd.png', sourceSha256: 'a'.repeat(64) } }, 'baseColorTexture.path 非法'],
    [{ baseColorTexture: { path: '../outside.png', sourceSha256: 'a'.repeat(64) } }, 'baseColorTexture.path 非法'],
    [{ baseColorTexture: { path: 'a.png' } }, 'texture_source_hash_required'],
    [{ baseColorTexture: 'a.png' }, 'baseColorTexture.path 非法'],
  ];
  for (const [material, keyword] of cases) {
    const result = scene3d.validateSceneSpec(scene([box('a', { material })]));
    assert.equal(result.ok, false, JSON.stringify(material));
    assert.ok(result.errors.some((error) => error.includes(keyword)), `${keyword} 缺位：${JSON.stringify(result.errors)}`);
  }
});

test('BLOCK-322 P2-03 — 贴图缺失/篡改走独立错误码（不被 mesh 语义吞掉）', () => {
  const noSha = scene3d.validateSceneSpec(scene([box('a', { material: { baseColorTexture: { path: 'a.png' } } })]));
  assert.equal(noSha.error, 'texture_source_hash_required');
  const badFormat = scene3d.validateSceneSpec(scene([box('a', { material: { baseColorTexture: { path: 'a.tiff', sourceSha256: 'a'.repeat(64) } } })]));
  assert.equal(badFormat.error, 'texture_format_unsupported');
});

test('BLOCK-322 P2-03 — 贴图预检与 mesh 共用同一内核但错误码分域', async () => {
  const root = tempWorkspace();
  try {
    writeAsset(root, 'model3d/textures/panel.png', PNG_1PX);
    const ok = await assetContract.inspectTextureAsset({ workspaceRoot: root, relativePath: 'model3d/textures/panel.png' });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.format, 'png');
    assert.equal(ok.bytes, PNG_1PX.length);
    assert.equal(ok.sourceSha256, crypto.createHash('sha256').update(PNG_1PX).digest('hex'));
    assert.equal(ok.maxBytes, 16 * 1024 * 1024, '贴图上限独立于 mesh 的 64MB');

    writeAsset(root, 'model3d/textures/logo.svg', '<svg/>');
    const unsupported = await assetContract.inspectTextureAsset({ workspaceRoot: root, relativePath: 'model3d/textures/logo.svg' });
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.error, 'texture_format_unsupported');

    const missing = await assetContract.inspectTextureAsset({ workspaceRoot: root, relativePath: 'model3d/textures/gone.png' });
    assert.equal(missing.error, 'texture_not_found', '不得回落到 mesh 的 mesh_not_found 语义');

    const escape = await assetContract.inspectTextureAsset({ workspaceRoot: root, relativePath: '../../outside.png' });
    assert.equal(escape.ok, false, '路径逃逸必须拒（红线 3）');

    const oversized = await assetContract.inspectTextureAsset({ workspaceRoot: root, relativePath: 'model3d/textures/panel.png', maxBytes: 4 });
    assert.equal(oversized.error, 'texture_too_large');

    // 同一内核：mesh 预检的错误码前缀不因重构而漂移
    const meshMiss = await assetContract.inspectMeshAsset({ workspaceRoot: root, relativePath: 'model3d/textures/nope.glb' });
    assert.equal(meshMiss.error, 'mesh_not_found');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-322 P2-03 — 贴图格式/上限跨 JS/TS/Python 逐值一致', () => {
  const backend = read('../core/petri-server/helpers/mesh-assets.js');
  const frontend = read('../frontend/src/lib/meshAssets.ts');
  const python = read('../resources/model3d/blender_scene.py');
  const grabArray = (source, name) => {
    const match = source.match(new RegExp(`${name}[^=\\n]*=\\s*Object\\.freeze\\(\\[([^\\]]*)\\]`));
    assert.ok(match, `未找到数组 ${name}`);
    return match[1].split(',').map((item) => item.trim().replace(/['"]/g, '')).filter(Boolean).sort();
  };
  const grabSet = (source, name) => {
    const match = source.match(new RegExp(`${name} = \\{([^}]*)\\}`));
    assert.ok(match, `未找到集合 ${name}`);
    return match[1].split(',').map((item) => item.trim().replace(/['"]/g, '').replace(/^\\./, '')).filter(Boolean).sort();
  };
  const formats = ['jpeg', 'jpg', 'png'];
  assert.deepEqual(grabArray(backend, 'TEXTURE_INPUT_FORMATS'), formats);
  assert.deepEqual(grabArray(frontend, 'TEXTURE_INPUT_FORMATS'), formats, '前端镜像必须与后端同集');
  assert.deepEqual(grabSet(python, 'TEXTURE_EXTENSIONS'), formats.map((format) => `.${format}`).sort());
  assert.equal(/MAX_TEXTURE_BYTES = (\d+) \* 1024 \* 1024/.exec(backend)[1], /MAX_TEXTURE_BYTES = (\d+) \* 1024 \* 1024/.exec(python)[1],
    '大小上限两侧同值（红线 3）');
  assert.match(frontend, /const MAX_MESH_BYTES = 64 \* 1024 \* 1024/);

  const materialFields = ['baseColorTexture', 'color', 'densityKgM3', 'emissive', 'metallic', 'roughness'];
  const backendScene = read('../core/petri-server/helpers/scene3d.js');
  const frontendScene = read('../frontend/src/lib/scene3d.ts');
  assert.deepEqual(
    /MATERIAL_FIELDS = \[([^\]]*)\]/.exec(backendScene)[1].split(',').map((item) => item.trim().replace(/['"]/g, '')).sort(),
    materialFields,
  );
  assert.deepEqual(
    /MATERIAL_FIELDS: readonly string\[\] = \[([^\]]*)\]/.exec(frontendScene)[1].split(',').map((item) => item.trim().replace(/['"]/g, '')).sort(),
    materialFields,
    '材质白名单两侧逐值相同',
  );
  assert.match(frontendScene, /function validateMaterialForView\(item: Record<string, unknown>, index: number, errors: string\[\]\)/);
  assert.match(frontendScene, /validateMaterialForView\(item, index, errors\);/);
  assert.match(backendScene, /validateMaterial\(node, where, errors\);/);
});

test('BLOCK-322 P2-03 — Blender 侧逐字节复验贴图且声明 PBR 材质时切 Cycles', () => {
  const python = read('../resources/model3d/blender_scene.py');
  assert.match(python, /def apply_base_color_texture\(mat, bsdf, texture, root\)/);
  assert.match(python, /raise ValueError\('texture_source_hash_mismatch'\)/, '盘上字节与声明 sha 不符必须显式失败');
  assert.match(python, /raise ValueError\('texture_not_found'\)/);
  assert.match(python, /raise ValueError\('texture_too_large'\)/);
  assert.match(python, /sha256_file\(full\) != expected/, '贴图复验与 mesh 用同一个 sha 实现，不另写一份');
  assert.match(python, /full = resolve_mesh_path\(root, relative_path\)/, '工作区逃逸检查复用同一实现');
  assert.match(python, /def material_for\(spec, root=''\)/);
  assert.match(python, /material_for\(node\.get\('material'\), root\)/, 'root 必须传到材质层，否则贴图无处可解析');
  assert.match(python, /bpy\.data\.images\.load\(full\)/);
  assert.doesNotMatch(python, /images\.load\([^)]*check_data/,
    'Blender 4.5 的 images.load 签名是 (filepath, check_existing)：传 check_data 会 TypeError 并把整个节点丢进 unsupported（P2-03 实机抓真）');
  assert.match(python, /def set_bsdf_input\(bsdf, names, value\)/, '按候选名探测输入：设错属性名在 Blender 里是静默无效');
  assert.match(python, /\('Emission Color', 'Emission'\)/, '发光输入名跨版本有漂移，须两候选都试');
  assert.match(python, /declared = bool\(environment\) or bool\(lights\) or declared_material/,
    '声明 PBR 材质也要切 Cycles：Workbench 的 MATERIAL 着色不认 metallic/发光/贴图');
  assert.match(python, /'declaredMaterial': declared_material/, '引擎选择理由要回显，能与像素对照');
  assert.match(python, /'materials': \{'declared': materials_report\(scene\)\}/);
});

test('BLOCK-322 P2-03 — 预检端点共用状态映射（不复制第二份 404/413/403 逻辑）', () => {
  const routes = read('../core/petri-server/routes/model3d.js');
  assert.match(routes, /app\.post\('\/api\/model3d\/texture\/inspect'/);
  assert.match(routes, /const assetErrorStatus = \(error, kind\)/);
  assert.equal((routes.match(/PATH_REJECT_ERRORS\.includes/g) || []).length, 1,
    '状态映射只留一处；复制两份就会有一类错误码在某端点被静默降成 400');
  assert.match(routes, /assetErrorStatus\(result\.error, 'mesh'\)/);
  assert.match(routes, /assetErrorStatus\(result\.error, 'texture'\)/);
});

test('BLOCK-322 P2-03 — 预览端消费贴图但不自解材质（无第二实现）', () => {
  const preview = read('../frontend/src/components/work-surface/Model3DScene.tsx');
  const surface = read('../frontend/src/components/work-surface/Model3DSurface.tsx');
  assert.match(preview, /metalness: node\.material\?\.metallic \?\? 0\.05/, '未声明时保持存量观感');
  assert.match(preview, /material\.emissive = new THREE\.Color/);
  assert.match(preview, /texture_reference_load_failed/, '贴图加载失败要按节点显式报，不静默留白');
  assert.match(preview, /texture_reference_unavailable/, '无项目工作区时如实说明取不到工作区文件');
  assert.match(surface, /const ASSET_NOTICE_PREFIXES = \['mesh_reference_', 'texture_reference_'\]/,
    '逐节点资产告警前缀集中一处，新增资产类别不再漏配（否则错误条互相覆盖=吞报）');
});
