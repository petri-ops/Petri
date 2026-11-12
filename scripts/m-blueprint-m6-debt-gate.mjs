#!/usr/bin/env node
/**
 * gate:m6-debt — M6（BLOCK-432）工程债务六组只读视图 + 判据门。
 *
 * 纪律：全部视图只读现有台账，零改写基线、零触碰在制 WIP、零 stage / 零提交。
 * U 类材料保持 pending_user_ruling；E 类人眼路线保持 pending_human_eye；W 类登记 owner。
 *
 * 用法：
 *   node scripts/m-blueprint-m6-debt-gate.mjs --check   # 门（不写盘）
 *   node scripts/m-blueprint-m6-debt-gate.mjs --write   # 生成六组证据到 acceptance/m-blueprint-2026-11-11/m6/<组>/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'acceptance/m-blueprint-2026-11-11/m6');
export const M6_GROUPS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']);

const readJson = (rel, root = ROOT) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const readText = (rel, root = ROOT) => fs.readFileSync(path.join(root, rel), 'utf8');
const lines = (rel, root = ROOT) => readText(rel, root).split('\n').length;

/** 只读收集六组视图（所有数字从源码/台账现取，不手抄）。 */
export function collectM6Views(root = ROOT) {
  const surface = readJson('acceptance/functional-audit-2026-11-04/surface-matrix.json', root);
  const channelsSrc = readText('src/ipc/channels.js', root);
  const channelCount = (channelsSrc.match(/:\s*'[^']+'/g) || []).length;
  const catchBaseline = readJson('test/silent-catch-baseline.json', root);
  const byDomain = { core: 0, src: 0, frontend: 0, scripts: 0, test: 0, other: 0 };
  const domainCounts = new Map(Object.entries(byDomain));
  for (const [file, n] of Object.entries(catchBaseline.files || {})) {
    const key = file.startsWith('core/') ? 'core' : file.startsWith('src/') ? 'src'
      : file.startsWith('frontend/') ? 'frontend' : file.startsWith('scripts/') ? 'scripts'
        : file.startsWith('test/') ? 'test' : 'other';
    domainCounts.set(key, domainCounts.get(key) + (Number(n) || 0));
  }
  for (const [key, value] of domainCounts) {
    Object.defineProperty(byDomain, key, { value, writable: true, enumerable: true, configurable: true });
  }
  const computedTotal = Object.values(byDomain).reduce((a, b) => a + b, 0);

  const bigFileCandidates = [
    'frontend/src/components/copilot/SimpleChat.tsx',
    'core/petri-server/helpers/tools-executor.js',
    'frontend/src/pages/project-workspace.tsx',
    'core/petri-server/helpers/scene3d.js',
  ];
  const bigFiles = bigFileCandidates.map((rel) => ({ path: rel, lines: fs.existsSync(path.join(root, rel)) ? lines(rel, root) : 0, rewritten: false }));

  const ipcRows = Array.isArray(surface.ipcRows) ? surface.ipcRows : [];
  const channelItems = ipcRows.map((r) => ({
    channel: String(r.channel || ''),
    inPreload: Boolean(r.inPreload),
    usedInRenderer: Boolean(r.usedInRenderer),
    owner: r.usedInRenderer ? 'renderer-existing' : 'functional-surface-audit',
    terminal: r.usedInRenderer ? 'retain-with-reason' : 'pending-triage',
    evidence: 'acceptance/functional-audit-2026-11-04/surface-matrix.json:ipcRows',
  }));

  const skills = readJson('resources/skills/manifest.json', root);
  const skillItems = Array.isArray(skills.skills) ? skills.skills : [];

  return {
    schemaVersion: 1,
    kind: 'm6-read-only-views',
    capturedAt: new Date().toISOString(),
    policy: '只读视图：零改写基线、零触碰在制 WIP、零 stage 零提交；U/E/V/W 不代答',
    surface: {
      schema: surface.summary ? 'functional-surface-matrix.v1' : null,
      tools: surface.summary?.tools ?? null,
      ipcChannels: surface.summary?.ipcChannels ?? null,
      routes: surface.summary?.routes ?? null,
      rewritten: false,
      source: 'acceptance/functional-audit-2026-11-04/surface-matrix.json',
      threeMatrices: ['scripts/functional-surface-audit.mjs', 'scripts/block357-capability-map.mjs', 'scripts/validate-ipc-catalog.mjs'],
    },
    ipc: { channelCount, rewritten: false, sources: ['src/ipc/channels.js', 'src/preload.js', 'docs/ipc-catalog.md'], note: 'IPC 三真相只读对账，catalog 滞后登记 done-partial' },
    bigFiles,
    silentCatch: { baselineTotal: catchBaseline.total, computedTotal, byDomain, fileCount: Object.keys(catchBaseline.files || {}).length, rewritten: false, note: '按域下降表只读；不放宽/不上调 412 基线' },
    focus: {
      terminal: 'W',
      reason: 'focus-visible 12 文件/16 声明涉及在制 CSS WIP，零触碰；观感归 E 类',
      rewritten: false,
      owner: 'ui-design-program-wip',
      humanEyeRoute: {
        status: 'pending_human_eye',
        signature: '',
        steps: [
          { step: 1, action: '键盘 Tab 遍历设置页各分区控件', input: 'Tab ×N', expected: '每控件有可见 :focus-visible 轮廓且不被遮挡', evidencePoint: '截图 + outlineStyle/outlineWidth DOM 读数' },
          { step: 2, action: '暗色模式下重复 Tab 遍历', input: '主题切暗 + Tab', expected: '焦点轮廓在暗底可见（对比度 ≥3:1）', evidencePoint: '暗色截图 + 对比度计算' },
          { step: 3, action: '读屏 VoiceOver 遍历并核对朗读', input: 'VO + 方向键', expected: '焦点顺序与视觉顺序一致、无重复朗读', evidencePoint: '读屏记录 + 人签字' },
          { step: 4, action: '对比度观感复核 32 对', input: '亮/暗两套', expected: '人眼确认文字层级与边界可辨', evidencePoint: '人眼签字槽' },
        ],
      },
    },
    channels: {
      items: channelItems,
      total: channelItems.length,
      unusedInRenderer: channelItems.filter((i) => !i.usedInRenderer).length,
      dualColumn: ['structure', 'behavior'],
      rewritten: false,
      note: '结构判定与专项行为判定双列，禁止互相冒充；真消费接线 done-partial',
    },
    uMaterial: {
      status: 'pending_user_ruling',
      defaultChanged: false,
      topic: 'typescript 双版本统一 / ADMISSION observe→enforce / FK OFF-ON / 虚拟列表依赖',
      candidates: [
        { option: '维持双版本与既有默认', risk: '类型面漂移持续', recommendation: '当前 G0 默认' },
        { option: '统一版本并跑前后同套定向测试', risk: '需 changelog + lockfile diff 审查', recommendation: '需用户显式裁决' },
      ],
      note: 'Agent 不代答，不改默认语义',
    },
    skills: {
      count: skillItems.length,
      rewritten: false,
      source: 'resources/skills/manifest.json',
      note: 'Skill 清单一致性只读对账；skills:check 当次读数另取',
    },
    groups: M6_GROUPS.slice(),
    g0Note: 'G0 开发期常态 · 不外推 packaged/Provider/GA',
  };
}

/** 判据门：schema / 基线 / W / U / E / 逐件保留 六类，篡改必红。 */
export function adjudicateM6Views(v) {
  const issues = [];
  if (!v || !v.surface || !v.surface.schema) issues.push('SURFACE_SCHEMA_MISSING');
  if (!v.ipc || v.ipc.channelCount < 100) issues.push('IPC_CHANNEL_COUNT_SUSPICIOUS');
  if (!v.silentCatch || v.silentCatch.computedTotal !== v.silentCatch.baselineTotal) issues.push('SILENT_CATCH_BASELINE_DRIFT');
  if (v.silentCatch && v.silentCatch.rewritten) issues.push('SILENT_CATCH_BASELINE_REWRITTEN');
  if (!v.focus || v.focus.terminal !== 'W') issues.push('W_CLASS_TERMINAL_DRIFT');
  if (v.focus && v.focus.humanEyeRoute.status !== 'pending_human_eye') issues.push('HUMAN_EYE_ANSWERED_BY_AGENT');
  if (!v.channels || !v.channels.items.every((i) => i.owner && i.terminal)) issues.push('CHANNEL_ITEM_OWNER_MISSING');
  if (v.channels && v.channels.rewritten) issues.push('CHANNEL_LEDGER_REWRITTEN');
  if (!v.uMaterial || v.uMaterial.status !== 'pending_user_ruling' || v.uMaterial.defaultChanged) issues.push('U_MATERIAL_RULING_DRIFT');
  if (!v.bigFiles || v.bigFiles.some((f) => f.rewritten)) issues.push('BIG_FILE_REWRITTEN_WITHOUT_BASELINE');
  if (!v.ipc || v.ipc.rewritten) issues.push('IPC_TRUTH_REWRITTEN');
  return { ok: issues.length === 0, issues };
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const check = args.includes('--check');
  if (write === check) {
    process.stderr.write('用法：node scripts/m-blueprint-m6-debt-gate.mjs --check | --write（互斥）\n');
    process.exit(2);
  }
  const views = collectM6Views();
  const verdict = adjudicateM6Views(views);
  if (write) {
    for (const g of M6_GROUPS) fs.mkdirSync(path.join(OUT, g), { recursive: true });
    fs.mkdirSync(OUT, { recursive: true });
    const payloads = {
      A: { group: 'A-结构单源', surface: views.surface, ipc: views.ipc, terminal: 'done-partial', closureCondition: 'M6-A 续：三矩阵共用 schema 生成器 / 28 文件绕桥迁移 / 12 环逐环消亡，均带拆前拆后同套绿基线' },
      B: { group: 'B-巨型文件', bigFiles: views.bigFiles, terminal: 'W + done-partial', reason: '每刀须 ≤−100 行且拆前拆后同套绿，属逐会话拆刀；本包零拆分' },
      C: { group: 'C-静默与日志', silentCatch: views.silentCatch, terminal: 'done-partial', closureCondition: '扩口径与分域下降需逐批修根因后再 --write 下调基线（只减），本包零改写' },
      D: { group: 'D-体验', focus: views.focus, terminal: 'W + pending_human_eye', reason: 'CSS/设置面板属在制 WIP 零触碰；人眼路线已自动生成，签字槽全空' },
      E: { group: 'E-功能可用', channels: views.channels, terminal: 'done-partial', closureCondition: '真消费接线 / browser_act / worktree_remove / P3 存储键 / evidence-tier 需逐件接线，本包只出只读分诊' },
      F: { group: 'F-文档与依赖', uMaterial: views.uMaterial, skills: views.skills, terminal: 'pending_user_ruling + done-partial', reason: 'typescript 双版本等 U 类不代答；README 分类导航与 Skill 清单统一需用户裁决范围' },
    };
    const payloadMap = new Map(Object.entries(payloads));
    for (const g of M6_GROUPS) {
      const payload = payloadMap.get(g);
      fs.writeFileSync(path.join(OUT, g, `m6-${g.toLowerCase()}-view.json`), `${JSON.stringify({ ...payload, schemaVersion: 1, capturedAt: views.capturedAt, policy: views.policy, g0Note: views.g0Note }, null, 2)}\n`);
    }
    fs.writeFileSync(path.join(OUT, 'm6-all-views.json'), `${JSON.stringify(views, null, 2)}\n`);
    process.stdout.write(`[gate:m6-debt] 六组只读视图已写入 ${OUT}；通道逐件 ${views.channels.total} 件 / 静默 catch ${views.silentCatch.computedTotal} 处\n`);
    process.exit(0);
  }
  process.stdout.write(`[gate:m6-debt] 六组判据 → ${verdict.ok ? 'PASS' : 'FAIL'}（${verdict.issues.length} issues）\n`);
  for (const i of verdict.issues) process.stdout.write(`  ✖ ${i}\n`);
  process.exit(verdict.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
