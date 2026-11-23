/**
 * P6 产品侧停用 bio pack table result surface（2026-11-23）— HK-01 契约。
 *
 * 裁决方向 B 落地：pack.json 的 resultSurfaces[0].artifactTypes 去掉 "table"，
 * 使 classified_table.csv（table 族）不再被 pack surface 接管 → resolveResultSurface
 * 返回 null → resultSurfaceHost 走 core-transitional 原生 viewer（10万行虚拟表格判据）。
 * 红线：只改 pack 声明；provides.artifactTypes 保留 table；产品 sandbox/CSP/handler 不动。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK_JSON = '/Users/zhangdiandian/Documents/1.WorkDir/petri-pack-bio/pack.json';

test('table 族不被任何 result surface 接管（table 族回退原生 viewer）', () => {
  const pack = JSON.parse(fs.readFileSync(PACK_JSON, 'utf8'));
  const surfaces = pack.provides.resultSurfaces || [];
  const claimingTable = surfaces.filter((item) => (item.artifactTypes || []).includes('table'));
  assert.equal(
    claimingTable.length, 0,
    '不得有 result surface 接管 table 族——否则 classified_table.csv 走 pack iframe 200 行预览，inspectTable 判据不成立',
  );
  // 2026-11-23 全链收口后 resultSurfaces 已整体停用（方向 B 完成）；本票当时的
  // 「plot/report 保留」是中间态，两种状态都合法，只断言 table 未被接管这一不变量。
});

test('provides.artifactTypes 保留 table（包能力声明不动）', () => {
  const pack = JSON.parse(fs.readFileSync(PACK_JSON, 'utf8'));
  assert.ok(
    pack.provides.artifactTypes.includes('table'),
    'provides.artifactTypes 是包能力声明（工具目录投影），不得随 result surface 一起删',
  );
});

test('回退链路在案：resolveResultSurface 未命中→core-transitional 原生 viewer', () => {
  const host = fs.readFileSync(
    path.join(ROOT, 'frontend', 'src', 'components', 'result-studio', 'resultSurfaceHost.ts'), 'utf8',
  );
  const registry = fs.readFileSync(
    path.join(ROOT, 'frontend', 'src', 'lib', 'workSurface', 'registry.ts'), 'utf8',
  );
  assert.match(registry, /artifactTypes/, 'registry 按 artifactTypes 匹配');
  assert.match(host, /core-transitional/, '未命中 pack 时须回退 core-transitional（原生 viewer）');
});

test('产品安全边界未动（红线：不改 sandbox/CSP/凭据/B1 token/handler）', () => {
  const packFrame = fs.readFileSync(
    path.join(ROOT, 'frontend', 'src', 'components', 'work-surface', 'PackSurfaceFrame.tsx'), 'utf8',
  );
  const scheme = fs.readFileSync(path.join(ROOT, 'src', 'main', 'pack-ui', 'scheme.js'), 'utf8');
  assert.match(packFrame, /allow-top-navigation-to-custom-protocols/, '产品 B1 token 仍在');
  assert.match(scheme, /protocol\.handle\(SCHEME/, '产品 handler 仍在');
  assert.match(scheme, /Content-Security-Policy/, '产品 CSP 仍在');
  assert.match(scheme, /supportFetchAPI:\s*true/, '产品 scheme privileges 仍在');
});
