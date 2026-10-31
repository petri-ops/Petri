import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// BLOCK-322 P1 — 外部 mesh 格式白名单与字节上限的跨语言对账门。
// 单一声明处 = core/petri-server/helpers/mesh-assets.js；本门逐值核对其余消费面，
// 任何一侧偷偷加/减格式或改上限即红（历史缺陷：12 份硬编码格式列表彼此漂移）。
const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

function pySet(source, name) {
  const match = source.match(new RegExp(`${name}\\s*=\\s*\\{([^}]*)\\}`));
  assert.ok(match, `未找到 Python 常量 ${name}`);
  return match[1]
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
    .sort();
}

function jsArray(source, name) {
  const match = source.match(new RegExp(`${name}\\s*=\\s*Object\\.freeze\\(\\[([^\\]]*)\\]`));
  assert.ok(match, `未找到 JS 常量 ${name}`);
  return match[1]
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
    .sort();
}

const backend = read('../core/petri-server/helpers/mesh-assets.js');
const cadBackend = read('../core/petri-server/helpers/cad-exchange.js');
const frontend = read('../frontend/src/lib/meshAssets.ts');
const blender = read('../resources/model3d/blender_scene.py');
const filesRoute = read('../core/petri-server/routes/files.js');
const registry = read('../frontend/src/components/result-studio/viewerRegistry.ts');
const scene = read('../frontend/src/components/work-surface/Model3DScene.tsx');
const surface = read('../frontend/src/components/work-surface/Model3DSurface.tsx');

const canonical = ['glb', 'gltf', 'obj', 'stl'];
const canonicalCad = ['iges', 'igs', 'step', 'stp'];

test('BLOCK-322 — mesh 格式白名单后端为唯一声明处', () => {
  assert.deepEqual(jsArray(backend, 'MESH_INPUT_FORMATS'), canonical);
});

test('BLOCK-322 — 前端镜像与后端逐值一致', () => {
  assert.deepEqual(jsArray(frontend, 'MESH_INPUT_FORMATS'), canonical);
});

test('BLOCK-322 — CAD 格式白名单后端单源、前端镜像逐值一致', () => {
  assert.deepEqual(jsArray(cadBackend, 'CAD_INPUT_FORMATS'), canonicalCad);
  assert.deepEqual(jsArray(frontend, 'CAD_INPUT_FORMATS'), canonicalCad);
  const limit = (source, name) => {
    const match = source.match(new RegExp(`${name}\\s*=\\s*([^\\n;]+)`));
    assert.ok(match, `未找到常量 ${name}`);
    return match[1].trim().replace(/\s+/g, ' ');
  };
  assert.equal(limit(cadBackend, 'MAX_CAD_BYTES'), '128 * 1024 * 1024');
  assert.equal(limit(frontend, 'MAX_CAD_BYTES'), '128 * 1024 * 1024');
  assert.match(frontend, /cadFormatForPath/, '前端必须复用 CAD 格式识别');
  assert.match(surface, /CAD_INPUT_ACCEPT_ATTR/, 'CAD 导入入口 accept 应来自单源');
});

test('BLOCK-322 — Blender 构建脚本白名单与契约层一致', () => {
  assert.deepEqual(
    pySet(blender, 'MESH_EXTENSIONS').map((item) => item.replace(/^\./, '')).sort(),
    canonical,
  );
});

test('BLOCK-322 — 字节上限只有一个数值', () => {
  const limit = (source, name) => {
    const match = source.match(new RegExp(`${name}\\s*=\\s*([^\\n;]+)`));
    assert.ok(match, `未找到常量 ${name}`);
    return match[1].trim().replace(/\s+/g, ' ');
  };
  assert.equal(limit(backend, 'MAX_MESH_BYTES'), '64 * 1024 * 1024');
  assert.equal(limit(frontend, 'MAX_MESH_BYTES'), '64 * 1024 * 1024');
  // Python 侧写的是同值不同形（1MB 粒度），换算后必须等于 64MB。
  const py = blender.match(/MAX_MESH_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
  assert.ok(py, `未识别的 Python 上限写法：${blender.match(/MAX_MESH_BYTES.*/)?.[0]}`);
  assert.equal(Number(py[1]) * 1024 * 1024, 64 * 1024 * 1024);
});

test('BLOCK-322 — 工作区文件路由为每个受支持格式声明 content type', () => {
  for (const format of canonical) {
    assert.match(filesRoute, new RegExp(`'\\.${format}':\\s*'model/`), `.${format} 缺 content type`);
  }
});

test('BLOCK-322 — 消费面不再各自复制格式清单', () => {
  assert.match(registry, /MESH_INPUT_FORMATS\.join\('\|'\)/, 'viewerRegistry 应从单源生成正则');
  assert.ok(!registry.includes('/.(glb|gltf|stl|obj)$/'), 'viewerRegistry 不得保留第二份硬编码格式正则');
  assert.match(surface, /MESH_INPUT_ACCEPT_ATTR/, '导入入口 accept 应来自单源');
  assert.ok(!surface.includes("['glb', 'gltf', 'stl', 'obj']"), 'Model3DSurface 不得保留第二份格式数组');
  assert.ok(!surface.includes('64 * 1024 * 1024'), 'Model3DSurface 不得自写字节上限');
});

test('BLOCK-322 P1b — 预览渲染 mesh-reference，不得再静默跳过', () => {
  assert.ok(
    !scene.includes("node.type === 'group' || node.type === 'mesh-reference') continue"),
    'mesh-reference 被静默 continue 是 P1b 修的缺陷本体，禁止回归',
  );
  assert.match(scene, /workspaceFileUrlFor\(projectId, sourcePath\)/, '外部 mesh 必须按工作区文件 URL 加载');
  assert.match(scene, /mesh_reference_load_failed/, '加载失败必须显式上报（红线4：不伪造预览）');
  assert.match(scene, /mesh_reference_unavailable/, '缺项目工作区时如实报不可用');
  assert.match(scene, /setResourcePath/, '多文件 .gltf 的同目录资源须经工作区路由解析');
});
