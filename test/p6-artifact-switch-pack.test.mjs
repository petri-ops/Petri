/**
 * P6 PNG artifact 切换判据（2026-11-23）— HK-01 契约（纯源码，不跑 Electron）。
 *
 * 卡点：切到 volcano.png（plot 族，bio pack 仍提供 plot result surface）后，
 * packTakesOver → ResultArtifactShell（含 data-debug-selected-name）被卸载，
 * driver 全局查询拿不到 selectedName → measureArtifactSwitch 返回 changed:false
 * → png_artifact_switch_failed。切换实际成功（artifactNetwork completed/200）。
 *
 * 修复（仅 harness）：判据加 pack 分支 + 受控 select native setter + 清死参。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRIVER = path.join(ROOT, 'scripts', 'g0-rs-p6-electron-pressure-driver.cjs');
const src = () => fs.readFileSync(DRIVER, 'utf8');

test('measureArtifactSwitch 判据含 pack 分支（packTakesOver 后 debug 属性被卸载）', () => {
  const s = src();
  const def = s.search(/async function measureArtifactSwitch\s*\(/);
  assert.ok(def >= 0, '须存在 measureArtifactSwitch');
  const body = s.slice(def, def + 2600);
  // pack 接管标志（产品 ResultsSurface.tsx 的实际 DOM）
  assert.match(body, /data-result-surface-source/, '判据须含 data-result-surface-source="pack" 分支');
  assert.match(body, /pack-surface-frame|data-surface-state|iframe\[title\]/, '判据须含 pack surface ready/iframe 观测');
});

test('受控 select 用 native setter（与 measureFilterFeedback 同构）', () => {
  const s = src();
  const def = s.search(/async function measureArtifactSwitch\s*\(/);
  const body = s.slice(def, def + 2600);
  assert.match(body, /HTMLSelectElement\.prototype['"]?,\s*['"]value/, 'select 须用 native value setter');
  assert.doesNotMatch(body, /\bselect\.value\s*=\s*artifactName/, '不得直接赋值受控 select');
});

test('调用点无死参（函数签名与调用一致）', () => {
  const s = src();
  const call = s.search(/measureArtifactSwitch\(\s*window\.webContents/);
  assert.ok(call >= 0, '须有调用点');
  const around = s.slice(call, call + 250);
  assert.doesNotMatch(around, /useSection/, '调用点须清除不存在的 useSection 死参');
});

test('产品判据 DOM 未被本票改写（红线：不改产品 debug 属性/pack 声明/handler）', () => {
  const shell = fs.readFileSync(
    path.join(ROOT, 'frontend', 'src', 'components', 'workspace-panels', 'ResultArtifactShell.tsx'), 'utf8',
  );
  const resultsSurface = fs.readFileSync(
    path.join(ROOT, 'frontend', 'src', 'components', 'work-surface', 'ResultsSurface.tsx'), 'utf8',
  );
  const packJson = fs.readFileSync('/Users/zhangdiandian/Documents/1.WorkDir/petri-pack-bio/pack.json', 'utf8');
  assert.match(shell, /data-debug-selected-name/, '产品 debug 属性未改');
  assert.match(resultsSurface, /data-result-surface-source/, '产品 pack 接管标志未改');
  const pack = JSON.parse(packJson);
  assert.ok(pack.provides.resultSurfaces[0].artifactTypes.includes('plot'), 'pack plot surface 保留（不改 pack 声明）');
});
