/**
 * P6 全链收口：bio-result result surface 完整停用（2026-11-23）— HK-01 契约。
 *
 * 方向 B（用户已裁决放行，上票停 table）完整落地：png(plot)/report(report) 仍走 pack
 * surface，与 driver 全部 core 判据（行数/导出锚点/工具文件 iframe/内嵌图片）冲突；
 * report 的 embeddedImageCount>=1 在 pack 文本渲染里无法满足，改 harness=放宽验收=假绿。
 * 根治=停用整个 bio-result result surface，所有产物回退 core 原生 viewer。
 * 红线：只改 pack 声明；pack 其他能力（plugins/scripts/artifactTypes/skills）保留；
 * 产品 sandbox/CSP/凭据/B1 token/handler 不动。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK_JSON = '/Users/zhangdiandian/Documents/1.WorkDir/petri-pack-bio/pack.json';
const load = () => JSON.parse(fs.readFileSync(PACK_JSON, 'utf8'));

test('bio resultSurfaces 已停用（无接管 result 的 surface）', () => {
  const pack = load();
  const surfaces = pack.provides.resultSurfaces || [];
  const claiming = surfaces.filter((item) => (item.artifactTypes || []).length > 0);
  assert.equal(
    claiming.length, 0,
    '不得有 result surface 接管任何 artifact 族——否则 png/report 走 pack，driver core 判据全挂',
  );
});

test('pack 其他能力保留（只停 result surface，不停包）', () => {
  const pack = load();
  assert.equal(pack.packId, 'petri-pack-bio');
  assert.ok(pack.provides.plugins, 'plugins 保留');
  assert.ok(pack.provides.scripts, 'scripts 保留');
  assert.ok(pack.provides.artifactTypes.includes('plot'), 'provides.artifactTypes 能力声明保留');
  assert.ok(pack.provides.artifactTypes.includes('report'), 'report 能力声明保留');
});

test('产品安全边界未动（红线）', () => {
  const packFrame = fs.readFileSync(
    path.join(ROOT, 'frontend', 'src', 'components', 'work-surface', 'PackSurfaceFrame.tsx'), 'utf8',
  );
  const scheme = fs.readFileSync(path.join(ROOT, 'src', 'main', 'pack-ui', 'scheme.js'), 'utf8');
  const shell = fs.readFileSync(
    path.join(ROOT, 'frontend', 'src', 'components', 'workspace-panels', 'ResultArtifactShell.tsx'), 'utf8',
  );
  assert.match(packFrame, /allow-top-navigation-to-custom-protocols/, 'B1 token 仍在');
  assert.match(scheme, /protocol\.handle\(SCHEME/, 'handler 仍在');
  assert.match(scheme, /Content-Security-Policy/, 'CSP 仍在');
  assert.match(shell, /data-debug-selected-name/, 'core 判据属性仍在（原生 viewer 路径可用）');
});
