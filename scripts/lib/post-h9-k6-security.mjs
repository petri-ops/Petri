#!/usr/bin/env node
/**
 * K6 安全与边界事实采集/裁决（纯函数 + 只读，供篡改负测）。
 *
 * 三类：①BrowserWindow 创建点四项基线 + 名单覆盖；②ADMISSION/FK 现状（U 类，
 * 不改默认）；③IPC 豁免口、空 catch 扫描根、dev 双后端归属。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const REQUIRED_SAFE_CONFIG = Object.freeze([
  ['contextIsolation', 'true'], ['nodeIntegration', 'false'],
  ['sandbox', 'true'], ['webSecurity', 'true'],
]);
export const WINDOW_FILES = Object.freeze([
  'src/main/_window-create.js',
  'src/ipc/window-manager.js',
  'src/main/computer-use-pip.js',
]);

/** 从源码抓 new BrowserWindow({...}) 完整构造块（大括号配对）。 */
export function windowCreationBlocks(source) {
  const blocks = [];
  const re = /new BrowserWindow\(\{/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const open = source.indexOf('{', m.index);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) { blocks.push(source.slice(open, i + 1)); break; }
      }
    }
  }
  return blocks;
}

/** 纯函数：逐块校验四项；漏配即红（负测注入）。 */
export function adjudicateWindowSafety(files, read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')) {
  const issues = [];
  let total = 0;
  for (const rel of files) {
    const blocks = windowCreationBlocks(read(rel));
    if (blocks.length === 0) issues.push(`${rel}: 无 BrowserWindow 创建点`);
    for (const [idx, block] of blocks.entries()) {
      for (const [key, value] of REQUIRED_SAFE_CONFIG) {
        if (!new RegExp(`${key}:\\s*${value}\\b`).test(block)) issues.push(`${rel} 第 ${idx + 1} 个窗口缺 ${key}: ${value}`);
      }
      total += 1;
    }
  }
  if (total < 4) issues.push(`窗口创建点计数 ${total} < 4（名单可能漏登记）`);
  return { ok: issues.length === 0, issues, total, verdict: issues.length === 0 ? 'all-window-creations-safe' : 'unsafe-window-config' };
}

/** 名单覆盖：全仓 src/** 里出现 new BrowserWindow 的文件都必须在 WINDOW_FILES。 */
export function collectWindowFiles(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') && /new BrowserWindow\(/.test(fs.readFileSync(p, 'utf8'))) out.push(path.relative(root, p));
    }
  };
  walk(path.join(root, 'src'));
  return out.sort();
}

export function adjudicateWindowCoverage(actualFiles, listedFiles) {
  const missing = actualFiles.filter((f) => !listedFiles.includes(f));
  const stale = listedFiles.filter((f) => !actualFiles.includes(f));
  return {
    ok: missing.length === 0 && stale.length === 0,
    missing, stale,
    verdict: missing.length === 0 && stale.length === 0 ? 'window-list-complete' : 'window-list-drift',
  };
}

export function collectSecurityTruth(root = ROOT) {
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const json = (rel) => JSON.parse(read(rel));

  const assertionTest = read('test/electron-security-assertions.test.mjs');
  const listed = [...assertionTest.matchAll(/^\s*'((?:src|frontend)[^']+\.js)',/gm)].map((m) => m[1]);
  const actual = collectWindowFiles(root);
  const windows = {
    listedFiles: listed.filter((f) => WINDOW_FILES.includes(f)),
    actualFiles: actual,
    pipInList: listed.includes('src/main/computer-use-pip.js'),
    totalWindowsAssert: /totalWindows >= 4/.test(assertionTest),
    safety: adjudicateWindowSafety(WINDOW_FILES, read),
    coverage: adjudicateWindowCoverage(actual, listed),
    pipPreloadSelfContained: /require\('electron'\)/.test(read('src/main/computer-use-pip-preload.js')) &&
      !/require\(['"](?!electron)/.test(read('src/main/computer-use-pip-preload.js')),
  };

  const admission = {
    defaultObserve: /observe/.test(read('core/shared-backend/execution-admission.js')),
    backendForeignKeysOff: /foreign_keys\s*=?\s*OFF/i.test(read('core/petri-server/db/connection.js')),
    desktopForeignKeysOn: /foreign_keys\s*=?\s*ON/i.test(read('src/database/_db-singleton.js')),
    cascadeScanTracked: fs.existsSync(path.join(root, 'acceptance/post-s7-2026-11-10/h10/cascade-scan.json')),
    decisionMaterialExists: fs.existsSync(path.join(root, 'docs/post-s7-h1-admission-fk-decision-material.md')),
  };

  const ipc = {
    exemptEnvExists: /PETRI_IPC_FILE_SENDER_EXEMPT_IDS/.test(read('src/ipc/_ipc-trust.js')),
    exemptPinnedByContract: /PETRI_IPC_FILE_SENDER_EXEMPT_IDS/.test(read('test/nso-w2-ipc-trust.test.mjs')),
    silentCatchScanRoots: JSON.parse(read('test/silent-catch-baseline.json'))._about || null,
    // L3-4（L-18）：扫描根扩面与留因双读数——扩面必须伴随 _about 留因（负测在
    // test/block407-l3-error-semantics.test.mjs）。
    silentCatchRootsExtended: /frontend\/src/.test(read('scripts/silent-catch-ratchet.mjs')),
    silentCatchRootsDocumented: /L3-18|BLOCK-407/.test(String(JSON.parse(read('test/silent-catch-baseline.json'))._about || '')),
    silentCatchTotal: json('test/silent-catch-baseline.json').total,
    devDualBackendInAudit: /双后端|脑裂/.test(read('docs/AUDIT-LOG.md')),
  };

  return { windows, admission, ipc };
}

/** 总裁决：P0 已修 + U 类现状不得被冒充已裁决。 */
export function adjudicateSecurity(input) {
  const issues = [];
  const conclusions = {};
  const t = {
    windows: { safety: { ok: false }, coverage: { ok: false } },
    admission: {}, ipc: {},
    ...(input && typeof input === 'object' ? input : {}),
  };
  t.windows = t.windows || {};
  t.admission = t.admission || {};
  t.ipc = t.ipc || {};

  let n = issues.length;
  if (!(t.windows.safety?.ok && t.windows.coverage?.ok)) issues.push('K-27: 窗口四项基线或名单覆盖未达标');
  if (t.windows.pipInList !== true) issues.push('K-27: PiP 未纳入安全断言名单');
  if (t.windows.totalWindowsAssert !== true) issues.push('K-27: 创建点计数断言未收紧到 4');
  if (t.windows.pipPreloadSelfContained !== true) issues.push('K-27: PiP preload 与 sandbox 兼容性依据被改写');
  conclusions['K-27'] = issues.length === n ? 'pip-four-baselines-verified' : 'drift';

  n = issues.length;
  const a = t.admission;
  if (!(a.defaultObserve && a.backendForeignKeysOff && a.desktopForeignKeysOn)) issues.push('K-29: ADMISSION/FK 现状被改写（裁决前不得改默认语义）');
  if (!a.decisionMaterialExists) issues.push('K-29: U 类决策材料缺席');
  if (a.userRulingRecorded === true) issues.push('K-29: 出现用户裁决记录，需人工复核（Agent 不代答）');
  conclusions['K-29'] = issues.length === n ? 'pending_user_ruling' : 'drift';

  n = issues.length;
  const i = t.ipc;
  // L0-1（蓝图 L-54）：原「删除 IPC env 豁免口即判红」反向门禁已废——改为读数型记录。
  // 豁免口的存在/契约钉住状态只记录不裁决；其安全收敛（启动期登记/channel 白名单）
  // 属 L1 行为面，届时随行为变更同步修订 test/nso-w2-ipc-trust.test.mjs 契约。
  if (typeof i.exemptEnvExists !== 'boolean' || typeof i.exemptPinnedByContract !== 'boolean') {
    issues.push('K-28: IPC 豁免口读数缺席（fail-closed）');
  }
  // L3-4（L-18/BLOCK-407）：SCAN_ROOTS 纳入 frontend/src 后基线 395→412（11 个 frontend 文件/17 处入库，_about 带扩面留因）。
  // BLOCK-437：基线由 412 **收紧**到 406（ai-memory 迁移 DDL 接单源后该文件静默 catch 9→3）。
  // 判据改为「不超过历史冻结上限 412」——具体值由 test/silent-catch-baseline.json 复算，
  // 只减不增由 gate:silent-catch 棘轮负责；这里只防反弹与口径漂移。
  if (!(Number.isFinite(i.silentCatchTotal) && i.silentCatchTotal <= 412)) issues.push('K-28: 静默 catch 冻结基线被改写');
  // L3-4（L-18）：扩面本身是改进方向——只有「扩了但没留因」才判红（同 L0-1 读数型家族）。
  if (i.silentCatchRootsExtended === true && i.silentCatchRootsDocumented !== true) {
    issues.push('K-28: 扫描根扩展缺独立留因（_about 须记 L3-18/BLOCK-407 扩面依据）');
  }
  if (!i.devDualBackendInAudit) issues.push('K-28: dev 双后端归属登记被移除');
  conclusions['K-28'] = issues.length === n ? 'boundaries-recorded-schema-deferred' : 'drift';

  return {
    ok: issues.length === 0, issues, conclusions,
    verdict: issues.length === 0 ? 'security-depth-verified-u-boundaries-open' : 'security-drift',
  };
}

function main() {
  const truth = collectSecurityTruth();
  const verdict = adjudicateSecurity(truth);
  console.log(JSON.stringify({ verdict, windows: { ...truth.windows, safety: truth.windows.safety.verdict, coverage: truth.windows.coverage.verdict } }, null, 2));
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`[post-h9:k6] fail-closed: ${e.message}`); process.exitCode = 1; }
}
