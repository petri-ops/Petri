/**
 * K6 安全纵深契约（P0 红绿先行的负测 + U 类边界不代答）。
 *
 * 红绿证据：test/electron-security-assertions.test.mjs 先加 PiP 名单 → 红
 * （缺 sandbox: true），补配置 → 3/3 绿；日志留存 k6-red-green.json。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  collectSecurityTruth, adjudicateSecurity, adjudicateWindowSafety,
  adjudicateWindowCoverage, windowCreationBlocks, WINDOW_FILES,
} from '../scripts/lib/post-h9-k6-security.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const truth = collectSecurityTruth(ROOT);
const tamper = (patch) => adjudicateSecurity({ ...truth, ...patch });
const mustRed = (v, prefix) => {
  assert.equal(v.ok, false, `${prefix} 篡改后必须判红`);
  assert.ok(v.issues.some((i) => i.startsWith(prefix)), `应产生 ${prefix} 归因: ${v.issues.join(' / ')}`);
};

test('K6 三类结论在真实源码下成立，U 类边界保持未裁决', () => {
  const v = adjudicateSecurity(truth);
  assert.equal(v.ok, true, v.issues.join(' / '));
  assert.deepEqual(v.conclusions, {
    'K-27': 'pip-four-baselines-verified',
    'K-29': 'pending_user_ruling',
    'K-28': 'boundaries-recorded-schema-deferred',
  });
});

// ---- K-27 P0：四项基线与名单覆盖 ----
test('K-27：4 个 BrowserWindow 创建点四项配置全部显式达标', () => {
  assert.equal(truth.windows.safety.ok, true, truth.windows.safety.issues.join(' / '));
  assert.equal(truth.windows.safety.total >= 4, true);
  assert.equal(truth.windows.safety.verdict, 'all-window-creations-safe');
  assert.equal(truth.windows.pipInList, true);
  assert.equal(truth.windows.totalWindowsAssert, true);
  assert.equal(truth.windows.pipPreloadSelfContained, true);
});

test('K-27：名单与实际创建点集合相等（无漏登记/无陈旧项）', () => {
  assert.equal(truth.windows.coverage.ok, true, JSON.stringify(truth.windows.coverage));
  assert.deepEqual(truth.windows.coverage.missing, []);
  assert.deepEqual(truth.windows.coverage.stale, []);
  assert.deepEqual([...truth.windows.actualFiles].sort(), [...WINDOW_FILES].sort());
});

test('负测：删掉 PiP 的 sandbox 或 webSecurity → 安全断言必红', () => {
  const read = (rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (rel === 'src/main/computer-use-pip.js') return src.replace(/\s*sandbox: true,/, '');
    return src;
  };
  const a = adjudicateWindowSafety(WINDOW_FILES, read);
  assert.equal(a.ok, false);
  assert.ok(a.issues.some((i) => i.includes('sandbox')));
  const read2 = (rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (rel === 'src/main/computer-use-pip.js') return src.replace(/\s*webSecurity: true,/, '');
    return src;
  };
  const b = adjudicateWindowSafety(WINDOW_FILES, read2);
  assert.equal(b.ok, false);
  assert.ok(b.issues.some((i) => i.includes('webSecurity')));
});

test('负测：名单漏登记新增 BrowserWindow 创建点 → 判红', () => {
  const v = adjudicateWindowCoverage([...truth.windows.actualFiles, 'src/main/new-window.js'], truth.windows.listedFiles);
  assert.equal(v.ok, false);
  assert.ok(v.missing.includes('src/main/new-window.js'));
});

test('负测：名单含陈旧路径 / 创建点少于 4 → 判红', () => {
  assert.equal(adjudicateWindowCoverage(truth.windows.actualFiles, [...WINDOW_FILES, 'src/main/gone.js']).ok, false);
  const one = 'new BrowserWindow({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true })';
  assert.equal(adjudicateWindowSafety(['src/main/_window-create.js'], () => one).ok, false);
});

test('windowCreationBlocks 行为：大括号配对正确抓取完整构造块', () => {
  const src = 'const a = new BrowserWindow({ width: 1, webPreferences: { sandbox: true } });';
  const blocks = windowCreationBlocks(src);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /webPreferences/);
});

test('负测 K-27：PiP 从名单移除或计数断言退回 3 → 判红', () => {
  mustRed(tamper({ windows: { ...truth.windows, pipInList: false } }), 'K-27');
  mustRed(tamper({ windows: { ...truth.windows, totalWindowsAssert: false } }), 'K-27');
  mustRed(tamper({ windows: { ...truth.windows, pipPreloadSelfContained: false } }), 'K-27');
});

// ---- K-29 U 类：ADMISSION / FK ----
test('K-29：ADMISSION 默认 observe、FK 后端 OFF / 桌面 ON，决策材料在册', () => {
  assert.equal(truth.admission.defaultObserve, true);
  assert.equal(truth.admission.backendForeignKeysOff, true);
  assert.equal(truth.admission.desktopForeignKeysOn, true);
  assert.equal(truth.admission.decisionMaterialExists, true);
  assert.equal(truth.admission.cascadeScanTracked, true);
});

test('负测 K-29：擅自把 ADMISSION 拨硬或 FK 全量切换 → 判红', () => {
  mustRed(tamper({ admission: { ...truth.admission, defaultObserve: false } }), 'K-29');
  mustRed(tamper({ admission: { ...truth.admission, backendForeignKeysOff: false } }), 'K-29');
});

test('负测 K-29：伪造用户裁决记录 → 判红（Agent 不代答）', () => {
  mustRed(tamper({ admission: { ...truth.admission, userRulingRecorded: true } }), 'K-29');
});

// ---- K-28 IPC 边界（L0-1：豁免口改读数型记录，删除不再判红） ----
test('K-28：豁免口读数在场（布尔读数不裁决）、静默 catch 395 冻结、dev 双后端归属在册', () => {
  assert.equal(typeof truth.ipc.exemptEnvExists, 'boolean');
  assert.equal(typeof truth.ipc.exemptPinnedByContract, 'boolean');
  assert.equal(truth.ipc.silentCatchTotal, 395);
  assert.equal(truth.ipc.devDualBackendInAudit, true);
});

test('L0-1 解除负测：从契约测试移除豁免口字样（L1 行为收敛前置）不再判红', () => {
  const v = adjudicateSecurity({ ...truth, ipc: { ...truth.ipc, exemptEnvExists: false, exemptPinnedByContract: false } });
  assert.equal(v.ok, true, v.issues.join(' / '));
  assert.equal(v.conclusions['K-28'], 'boundaries-recorded-schema-deferred');
});

test('负测 K-28：豁免口读数缺席（非布尔）/ 重打静默 catch 基线 / 冒充扫描根已扩 → 判红', () => {
  mustRed(tamper({ ipc: { ...truth.ipc, exemptEnvExists: undefined } }), 'K-28');
  mustRed(tamper({ ipc: { ...truth.ipc, silentCatchTotal: 0 } }), 'K-28');
  mustRed(tamper({ ipc: { ...truth.ipc, silentCatchRootsExtended: true } }), 'K-28');
});

test('负测：事实整体缺席 → fail-closed 判红', () => {
  assert.equal(adjudicateSecurity({}).ok, false);
});
