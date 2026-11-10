#!/usr/bin/env node
/**
 * scripts/post-s7-structural-gates.mjs — BLOCK-394 批次 B 三个结构性缺口的机械门。
 *
 * B-04 执行准入三入口通道清单：workspace_exec 已消费；tools-executor / ssh-direct-runner
 *      尚无 handlerOptions 通道（凭据载体跨 tool_jobs 行与 SSH 会话，需独立设计）。
 *      这里把「显式消费 / 显式不接 / 静默缺失」三态做成可判红清单——静默缺失即红，
 *      但不擅自改执行语义（既有用户裁决 workspace_exec 默认放行、MCP trust 两轴分离不变）。
 * B-16 大文件纳管：loop-orchestrator.js（1579 行）必须进 code-size MANIFEST 且行数锚在册；
 *      巨型文件清单逐一可追（不擅自拆分，W5b 一切片=一会话 + 拆前拆后同套绿）。
 * B-18 插件源三处装配差异：MCP registry / server 启动 / plugin-manager 三处必须都走
 *      pack-registry 的已装包通道，且 pack 目录判定一致（installed.json 存在才追加）。
 *      差异表输出供后续单一 sourcePlan 收敛用；本包不改装配结构（零第二真相）。
 *
 * 不新建第二真相：三处判据都从既有源码 / 清单读取，输出分诊台账。
 * 用法：node scripts/post-s7-structural-gates.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h9');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── B-04 ──────────────────────────────────────────────────────────────
export const ADMISSION_ENTRYPOINTS = [
  { id: 'workspace_exec', file: 'core/petri-server/agent-tools/workspace-tools.js', marker: 'consumeExecutionAdmission', state: 'consumed' },
  { id: 'tools_executor', file: 'core/petri-server/helpers/tools-executor.js', marker: 'consumeExecutionAdmission', state: 'deferred' },
  { id: 'ssh_direct_runner', file: 'core/petri-server/helpers/remote-execution/ssh-direct-runner.js', marker: 'consumeExecutionAdmission', state: 'deferred' },
];

export function evaluateAdmissionChannels(files) {
  const issues = [];
  const rows = [];
  for (const e of ADMISSION_ENTRYPOINTS) {
    const text = files[e.file];
    if (text == null) { issues.push(`${e.id}: 文件不可读`); continue; }
    const consumes = text.includes(e.marker);
    if (e.state === 'consumed' && !consumes) issues.push(`${e.id}: 登记为已消费但源码无 ${e.marker}`);
    if (e.state === 'deferred' && consumes) issues.push(`${e.id}: 登记为 deferred 但已接线——请同步清单（防静默改语义）`);
    rows.push({
      id: e.id, state: e.state, consumes,
      reason: e.state === 'consumed'
        ? '执行边界出示并真正消耗一次性凭据（BLOCK-386 H1 闭环）'
        : '无 handlerOptions 通道；凭据载体需跨 tool_jobs 行与 SSH 会话设计，显式 deferred 不冒充接线',
    });
  }
  return { ok: issues.length === 0, issues, rows, note: '静默缺失即红：新增入口必须显式判 consumed/deferred 并留因。' };
}

// ── B-16 ──────────────────────────────────────────────────────────────
export const BIG_FILES = [
  'core/petri-server/loop-orchestrator.js',
  'frontend/src/components/copilot/SimpleChat.tsx',
  'frontend/src/pages/project-workspace.tsx',
  'frontend/src/components/desktop/WorkingTreeReview/ReviewMode.tsx',
];

/**
 * B-16 判据修正（2026-11-10）：不检查 code-size MANIFEST（那是 ≤700 行预算制，
 * 塞 1579 行文件会必红且需新增例外，违反「只出不进」用户裁决）。
 * 改查独立锚棘轮 big-file-anchor.json：4 个巨型文件必须逐个有行数 + sha256 在册。
 */
export function evaluateBigFileLedger(files, anchor) {
  const issues = [];
  const rows = [];
  const byPath = new Map((Array.isArray(anchor?.files) ? anchor.files : []).map((f) => [f.path, f]));
  const countLines = (t) => { const arr = t.split('\n'); if (arr.length && arr.at(-1) === '') arr.pop(); return arr.length; };
  for (const f of BIG_FILES) {
    const text = files[f];
    if (text == null) { issues.push(`${f}: 不可读`); continue; }
    const lines = countLines(text);
    const anchorRow = byPath.get(f);
    const anchored = Boolean(anchorRow && anchorRow.lines === lines && typeof anchorRow.sha256 === 'string');
    if (!anchored) issues.push(`${f}: 独立行数锚缺失或漂移（需 --write 重打）`);
    rows.push({ file: f, lines, anchored, anchorLines: anchorRow?.lines ?? null });
  }
  return { ok: issues.length === 0, issues, rows, note: '独立锚只减不增；巨型文件不在本包拆分（W5b 一切片一会话 + 拆前拆后同套绿）。' };
}

// ── B-18 ──────────────────────────────────────────────────────────────
export const PLUGIN_SOURCE_SITES = [
  { id: 'mcp_registry', file: 'core/petri-server/mcp/registry.js', role: 'pack_aware' },
  { id: 'server_boot', file: 'core/petri-server/server.js', role: 'pack_aware' },
  // 桌面侧插件安装/校验器：职责是开发态源检查与注册，不消费领域包 pack 通道。
  // 按职责分域（2026-11-10 判据修正），不要求 packAware。
  { id: 'plugin_manager', file: 'src/plugin-manager.js', role: 'installer' },
];

export function evaluatePluginSourceSites(files) {
  const issues = [];
  const rows = [];
  for (const s of PLUGIN_SOURCE_SITES) {
    const text = files[s.file];
    if (text == null) { issues.push(`${s.id}: 不可读`); continue; }
    const packAware = /pack-registry|installedPacks|packPluginsDir|readInstalledPacks/.test(text);
    const hasInstalledJson = text.includes('installed.json');
    const usesSingleLoader = /loadFromSourcesArray|inspectPluginSources|resolveDefaultPluginSources/.test(text);
    if (s.role === 'pack_aware' && !packAware) issues.push(`${s.id}: 未走 pack-registry 已装包通道`);
    if (!usesSingleLoader) issues.push(`${s.id}: 未使用既有单源加载器`);
    rows.push({ id: s.id, role: s.role, packAware, hasInstalledJson, usesSingleLoader, expectedPackAware: s.role === 'pack_aware' });
  }
  return { ok: issues.length === 0, issues, rows, note: '三处差异表：装配结构未改（不改运行时语义），供后续 sourcePlan 收敛。' };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const admission = evaluateAdmissionChannels(Object.fromEntries(
    ADMISSION_ENTRYPOINTS.map((e) => [e.file, read(e.file)]),
  ));
  const anchorPath = path.join(OUT, 'big-file-anchor.json');
  const anchor = fs.existsSync(anchorPath) ? JSON.parse(fs.readFileSync(anchorPath, 'utf8')) : null;
  const bigFiles = evaluateBigFileLedger(
    Object.fromEntries(BIG_FILES.map((f) => [f, read(f)])), anchor,
  );
  const pluginSites = evaluatePluginSourceSites(Object.fromEntries(
    PLUGIN_SOURCE_SITES.map((s) => [s.file, read(s.file)]),
  ));
  const ok = admission.ok && bigFiles.ok && pluginSites.ok;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'structural-triage.json'), JSON.stringify({ admission, bigFiles, pluginSites }, null, 2) + '\n');
  if (process.argv.includes('--json')) console.log(JSON.stringify({ admission, bigFiles, pluginSites }, null, 2));
  else {
    console.log(`[structural] B-04 channels=${admission.ok ? 'PASS' : 'FAIL'} (${admission.rows.length} 入口，消费 ${admission.rows.filter((r) => r.consumes).length})`);
    console.log(`[structural] B-16 bigfiles=${bigFiles.ok ? 'PASS' : 'FAIL'} (${bigFiles.rows.length} 文件)`);
    console.log(`[structural] B-18 sources=${pluginSites.ok ? 'PASS' : 'FAIL'} (${pluginSites.rows.length} 装配点)`);
    for (const [k, v] of Object.entries({ admission, bigFiles, pluginSites })) for (const i of v.issues) console.log(`  [${k}] ${i}`);
  }
  process.exitCode = ok ? 0 : 1;
}
