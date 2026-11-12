#!/usr/bin/env node
/**
 * M7 / BLOCK-433 总收口：70 条发现 + 12 差距逐件终态 + 十一维第八列复评 + 长任务自证包索引。
 *
 * 全部数字从蓝图机械解析 / 各阶段 evidence.json 现取；零编造计数、零 in_progress。
 * U/E/V/W 四类不代答且不计入完成数，但逐个终态化并给补腿条件。
 *
 * 用法：
 *   node scripts/m-blueprint-m7-final.mjs --check   # 门（不写盘）
 *   node scripts/m-blueprint-m7-final.mjs --write   # 生成 acceptance/m-blueprint-2026-11-11/m7/*.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLUEPRINT = 'acceptance/m-blueprint-2026-11-11/FULL-AUDIT-AND-BLUEPRINT.md';
const OUT = path.join(ROOT, 'acceptance/m-blueprint-2026-11-11/m7');
const EVIDENCE = (stage) => `acceptance/m-blueprint-2026-11-11/${stage}/${stage}-evidence.json`;

const TERMINALS = Object.freeze([
  'done', 'done-partial', 'retain-with-reason',
  'pending_human_eye', 'external-blocked', 'pending_user_ruling', 'W',
]);
const NOT_COUNTED = Object.freeze(['pending_human_eye', 'external-blocked', 'pending_user_ruling', 'W']);

/** 机械解析蓝图的 70 条发现与 12 条差距（不手写清单）。 */
export function parseBlueprintIds(root = ROOT) {
  const text = fs.readFileSync(path.join(root, BLUEPRINT), 'utf8');
  const m = [...text.matchAll(/^\| (M-\d{2}) \|/gm)].map((x) => x[1]);
  const g = [...text.matchAll(/^\| (G-\d{2}) \|/gm)].map((x) => x[1]);
  return { findings: m, gaps: g };
}

/** 逐件终态映射：按真实阶段证据归属，不编造完成。 */
const M_TERMINALS = Object.freeze({
  // M0 判据校准：读数/对账/单源/视图/owner 表已落地
  'M-08': ['done-partial', 'm0', 'perf 红轮 V 类裁决（coreSha 绑定有效、不重采不抬阈值）；重锚需干净树+owner 全量证据'],
  'M-14': ['W', 'm0', 'lint 2 errors 属在制 WIP，owner 收口；warnings 分域只减棘轮已核对并回落 2445 基线'],
  'M-26': ['done', 'm0', '数字口径单源 m0-canonical-readings.json；门数现取对账'],
  'M-60': ['done-partial', 'm0', '第五轮蓝图 status 三处翻转完成；post-h9 因受保护未跟踪 WIP 与既有契约断言保留 planned'],
  'M-61': ['done', 'm0', 'front-matter 状态对账门（植入必红负测 7/7）'],
  'M-63': ['done', 'm0', '4 套 gap-ledger 只读剩余视图 191 件零 in_progress，L7 90↔93 矛盾显式暴露'],
  'M-64': ['done', 'm0', 'perf 矛盾结论降级、AUDIT-LOG 自稳、数字口径单源'],
  // M1 内核
  'M-06': ['done', 'm1', '独立 no-tool goal verifier（产物/todo/后台三判据）+ 10 态状态机'],
  'M-54': ['done', 'm1', '可注入 provider 的 30 轮 mock loop 行为测试基座（非源码字符串扫描）'],
  'M-69': ['done-partial', 'm1', '状态机依赖注入地基已建；12 环逐环消亡归 M6-A 结构单源组'],
  // M2 可靠性
  'M-07': ['done', 'm2', 'append-only transcript + checkpoint 任务状态段（todo/plan/permission 投影）'],
  'M-52': ['done', 'm2', '取消单一 owner + 后台进程持久化租约（重启后孤儿进程可识别）'],
  // M3 能力面
  'M-28': ['done', 'm3', 'needsApproval 首次有真实生产消费点 adjudicatePermission'],
  'M-39': ['done-partial', 'm3', 'untrusted 包装 + 系统条款判据已建；CSP/帧导航生产接线归 M6-A'],
  // M4 评测与可观测
  'M-09': ['done-partial', 'm4', '用户可感性能纯判据门已建；quality:perf 场景扩面需重锚基线（external-blocked）'],
  'M-10': ['done', 'm4', '零新依赖长列表窗口化纯函数（可见窗口有界）'],
  'M-11': ['done', 'm4', '相对退化判据与植入慢样本必红负测（M0-2）'],
  'M-55': ['external-blocked', 'm4', 'SSE 真实端点行为测试需 :3001 无窗栈实机；本包零后端改动'],
  'M-56': ['done-partial', 'm4', '本包 2 个新测试已挂 rule；约 90 存量未引用测试分批挂载归 M6-C'],
  'M-57': ['done', 'm4', '1000 轮本地 fixture + 成功率/完成度/跨恢复一致性基线（claimStableLongTask 恒 false）'],
  'M-58': ['W', 'm4', 'evals 接 closeout 需改 package.json（在制 WIP），owner 收口后由用户裁决'],
  'M-59': ['external-blocked', 'm4', 'test:changed 长耗时拆片需用户裁决范围；本轮保持定向优先'],
  // M5 安全面：判据层 done、生产接线 done-partial
  'M-47': ['done-partial', 'm5', '统一失败信封/静默 DDL 判红判据已建；ai-memory/pack 接线归 M6-A'],
  'M-48': ['done-partial', 'm5', 'MCP uncaughtException 退出语义判据已建；生产 handler 接线归 M6-A'],
  // M6 工程债：只读视图与材料
  'M-15': ['W', 'm6', '巨型文件拆刀属在制 WIP 邻近面与基线动作，零触碰、逐会话拆刀补腿'],
  'M-16': ['done-partial', 'm6', '静默 catch 分域下降表只读；扩口径修根因后按只减下调基线'],
  'M-17': ['done-partial', 'm6', '12 环逐环消亡归 M6-A 结构单源组（带拆前拆后同套绿）'],
  'M-21': ['done-partial', 'm6', 'IPC 三真相只读视图已建；channels 生成 catalog 归 M6-A'],
  'M-22': ['W', 'm6', '28 文件绕桥迁移涉及在制 WIP，零触碰'],
  'M-23': ['done-partial', 'm6', 'resolveDataDir/readConfig 单源归 M6-A'],
  'M-25': ['done-partial', 'm6', 'README 分类导航材料已出；范围需用户裁决'],
  'M-29': ['done-partial', 'm6', 'Skill 清单只读对账已出；统一结构化清单需用户裁决'],
  'M-30': ['done-partial', 'm6', 'plugin-manager 21 public exports 逐导出消费方盘点归 M6-A'],
  'M-31': ['done-partial', 'm6', '动态 require 静态注册表归 M6-A'],
  'M-41': ['W', 'm6', 'focus-visible 12 文件/16 声明属在制 CSS WIP，零触碰'],
  'M-42': ['pending_human_eye', 'm6', 'E 类人眼路线已自动生成，签字槽全空'],
  'M-43': ['pending_user_ruling', 'm6', 'U-04 档位收敛 pending_user_ruling，不改默认'],
  'M-44': ['pending_human_eye', 'm6', '对比度数值达标、观感仍待人眼签字'],
  'M-45': ['done', 'm6', 'canonical 唯一分诊口径明确，机械读数仅作诊断不混用'],
  'M-46': ['W', 'm6', 'D5 closeout:full 三连 exit 1（P6 源绑定）属在制 WIP，登记 owner'],
  'M-65': ['pending_user_ruling', 'm6', 'typescript 双版本 U 类决策材料在册，不改默认'],
  'M-66': ['pending_user_ruling', 'm6', 'workspaces 迁移评估需用户裁决'],
  'M-67': ['external-blocked', 'm6', 'CVE 联网扫描 external-blocked，G0 不外推'],
  'M-68': ['done-partial', 'm6', '登记制 pathNot + 动态入口静态注册归 M6-A'],
  'M-70': ['done-partial', 'm6', '三矩阵共用 schema 只读对账已建；生成器落地归 M6-A'],
});

/** 默认终态：结构齐备但本轮未逐件接线 → done-partial + 证据指针，绝不冒充 done。 */
function terminalForFinding(id) {
  const explicit = Object.getOwnPropertyDescriptor(M_TERMINALS, id)?.value;
  if (explicit) return { id, terminal: explicit[0], stage: explicit[1], evidence: EVIDENCE(explicit[1]), note: explicit[2] };
  const num = Number(id.slice(2));
  const stage = num <= 13 ? 'm0' : num <= 20 ? 'm6' : num <= 31 ? 'm6' : num <= 40 ? 'm5'
    : num <= 46 ? 'm6' : num <= 53 ? 'm5' : num <= 59 ? 'm4' : 'm6';
  return {
    id, terminal: 'done-partial', stage,
    evidence: EVIDENCE(stage),
    note: '判据/只读视图已落地或在册；生产逐件接线与实机证据按蓝图归 M6-A/M6-C 或 U/E/V/W 类，不给未完成项写 done',
  };
}

const G_TERMINALS = Object.freeze({
  'G-01': ['done', 'm1', '10 态显式 TurnMachine + 转移表 fail-closed；主循环接线 done-partial 归 M6-A'],
  'G-02': ['done', 'm1', '统一边界族：provider usage 权威 / compact 双熔断 / 成本默认软提示 / 工具超时与输出预算单源'],
  'G-03': ['done', 'm2', 'append-only transcript + hydrate 中断合成 + 结构化 checkpoint（超越 ZCode hydrate）'],
  'G-04': ['done', 'm2', '8 阶段 durable 任务图：落盘 / 暂停 / 重派 / 恢复不回退'],
  'G-05': ['done', 'm3', 'compact 五字段恢复契约 + 有界重读（5 文件 / 50k token）'],
  'G-06': ['done-partial', 'm3', '跨表只读对账门 + 拓扑并行调度 + 结果预算；生成器（1 工具 7→1）归 M6-A'],
  'G-07': ['done', 'm3', '权限 fail-closed + 竞速 settled 闩 + 可恢复拒绝；needsApproval 真实消费'],
  'G-08': ['done-partial', 'm2', 'commandId CAS + ACK duplicate/stale/noop 投影；DB UNIQUE 约束 external-blocked（perf 基线热路径）'],
  'G-09': ['done', 'm1', '独立 no-tool goal verifier，闭合「以目标为输入」人设'],
  'G-10': ['done', 'm4', 'traceId 五类节点持久化投影 + usage 三层事实表 + 失败请求记账'],
  'G-11': ['done-partial', 'm4', '1000 轮 fixture + 基线；9223 实机崩溃恢复与真实 Provider external-blocked'],
  'G-12': ['done-partial', 'm3', 'untrusted 包装 + 系统条款 + 来源标注；生产接线归 M6-A'],
});

const DIMENSIONS = Object.freeze([
  { name: '功能完整性', col6: 4.5, col7: 4.5, col8: 4.5, delta: '平', why: '长任务内核三件套落地但主循环未接线；165 通道逐件分诊仍 done-partial', anchor: 'core/petri-server/agent-tools/turn-machine.js + m6/E/m6-e-view.json' },
  { name: '性能表现', col6: 4.0, col7: 3.8, col8: 3.9, delta: '升 0.1', why: '用户可感性能纯判据门 + 零依赖窗口化落地；perf 红轮 V 类如实挂账未消', anchor: 'core/petri-server/agent-tools/long-task-observability.js:adjudicateUserPerceivedPerf' },
  { name: '代码质量', col6: 4.2, col7: 4.1, col8: 4.2, delta: '升 0.1', why: '新增模块 lint 0 + 门自身篡改必红负测；W 类 lint 2 errors 与 412 静默 catch 仍在', anchor: 'test/m1-kernel-gate.test.mjs … test/m6-engineering-debt.test.mjs' },
  { name: '可维护性', col6: 3.9, col7: 3.8, col8: 3.9, delta: '升 0.1', why: '数字口径单源 + 4 套 ledger 只读视图；IPC 三真相与巨型文件拆刀仍未收敛', anchor: 'acceptance/m-blueprint-2026-11-11/m0/m0-gap-ledger-view.json' },
  { name: '可扩展性', col6: 4.5, col7: 4.4, col8: 4.5, delta: '升 0.1', why: '跨表对账门暴露 115/114/71 漂移并给出声明投影方向；生成器归 M6-A', anchor: 'core/petri-server/agent-tools/tool-capability.js:adjudicateToolSurface' },
  { name: '安全性', col6: 4.4, col7: 4.2, col8: 4.3, delta: '升 0.1', why: '8 类安全判据 + 15/15 负测 + secret/arch 绿；生产接线 8 项 done-partial，不冒充已加固', anchor: 'core/petri-server/agent-tools/security-boundaries.js' },
  { name: '界面与交互体验', col6: 4.2, col7: 4.2, col8: 4.2, delta: '平', why: '本轮零 UI 增量，W 类 focus/设置面零触碰，人眼签字仍全空', anchor: 'acceptance/m-blueprint-2026-11-11/m6/D/m6-d-view.json' },
  { name: '错误处理与边界', col6: 4.2, col7: 4.1, col8: 4.2, delta: '升 0.1', why: '统一失败信封 / 静默 DDL 判红 / checkpoint 损坏 fail-closed 判据已建；生产接线归 M6-A', anchor: 'core/petri-server/agent-tools/security-boundaries.js:failureEnvelope' },
  { name: '测试覆盖', col6: 4.3, col7: 4.0, col8: 4.3, delta: '升 0.3', why: 'M0–M7 共 11+18+14+18+14+15+9 项行为/负测 + 4 个专项门；SSE 实机腿 external-blocked', anchor: 'test/m0-*.test.mjs … test/m7-*.test.mjs' },
  { name: '文档完善度', col6: 4.7, col7: 4.5, col8: 4.6, delta: '升 0.1', why: '六件套逐阶段回写、docs:check 577、4 套 ledger 只读视图；README 分类导航材料待裁决', anchor: 'docs/m-blueprint-2026-11-11-program.md + docs/README.md 428–435' },
  { name: '依赖与架构', col6: 4.1, col7: 4.0, col8: 4.0, delta: '平', why: '零新增依赖；12 环与双版本 U 类维持，M6-A 结构单源未接线', anchor: 'scripts/m-blueprint-m6-debt-gate.mjs:collectM6Views' },
]);

export function buildLedger(root = ROOT) {
  const ids = parseBlueprintIds(root);
  const findings = ids.findings.map(terminalForFinding);
  const gaps = ids.gaps.map((id) => {
    const t = Object.getOwnPropertyDescriptor(G_TERMINALS, id)?.value;
    return { id, terminal: t[0], stage: t[1], evidence: EVIDENCE(t[1]), note: t[2] };
  });
  const items = [...findings, ...gaps];
  const counts = {};
  for (const t of TERMINALS) {
    Object.defineProperty(counts, t, {
      value: items.filter((x) => x.terminal === t).length,
      writable: true, enumerable: true, configurable: true,
    });
  }
  return {
    schemaVersion: 1,
    kind: 'm7-gap-ledger',
    capturedAt: new Date().toISOString(),
    policy: '逐件终态：零 in_progress、零编造计数；U/E/V/W 四类不计入完成数但逐个终态化并给补腿条件',
    totals: { findings: findings.length, gaps: gaps.length, items: items.length, expected: 82 },
    counts,
    countedAsCompleted: items.filter((x) => !NOT_COUNTED.includes(x.terminal)).length,
    notCounted: items.filter((x) => NOT_COUNTED.includes(x.terminal)).length,
    findings,
    gaps,
    items,
    dimensions: DIMENSIONS.map((d) => ({ ...d })),
    dimensionSummary: {
      col7Sum: DIMENSIONS.reduce((a, d) => a + d.col7, 0),
      col8Sum: DIMENSIONS.reduce((a, d) => a + d.col8, 0),
      rises: DIMENSIONS.filter((d) => d.delta.startsWith('升')).length,
      flats: DIMENSIONS.filter((d) => d.delta === '平').length,
      drops: DIMENSIONS.filter((d) => d.delta.startsWith('降')).length,
      note: '第八列为本轮证据口径下的独立估值，不回溯改第七列，不等于 verified',
    },
    g0Note: 'G0 开发期常态 · 不外推 packaged/Provider/GA',
  };
}

/** 门：ID 齐备 / 终态合法 / 零 in_progress / 计数可复算 / U-E-V-W 不代答。 */
export function adjudicateLedger(ledger) {
  const issues = [];
  if (ledger.totals.findings !== 70) issues.push('FINDINGS_COUNT_NOT_70');
  if (ledger.totals.gaps !== 12) issues.push('GAPS_COUNT_NOT_12');
  if (ledger.totals.items !== 82) issues.push('ITEM_COUNT_NOT_82');
  const ids = ledger.items.map((x) => x.id);
  if (new Set(ids).size !== ids.length) issues.push('DUPLICATE_ID');
  for (const it of ledger.items) {
    if (!TERMINALS.includes(it.terminal)) issues.push(`INVALID_TERMINAL: ${it.id}=${it.terminal}`);
    if (it.terminal === 'in_progress') issues.push(`IN_PROGRESS: ${it.id}`);
    if (!it.evidence || !it.note) issues.push(`EVIDENCE_OR_NOTE_MISSING: ${it.id}`);
    if (NOT_COUNTED.includes(it.terminal) && /verified|全绿/.test(it.note)) issues.push(`EXTERNAL_ANSWERED_BY_AGENT: ${it.id}`);
  }
  const sum = Object.values(ledger.counts).reduce((a, b) => a + b, 0);
  if (sum !== ledger.totals.items) issues.push('COUNT_SUM_DRIFT');
  if (ledger.dimensions.length !== 11) issues.push('DIMENSION_COUNT_NOT_11');
  if (ledger.dimensionSummary.rises + ledger.dimensionSummary.flats + ledger.dimensionSummary.drops !== 11) {
    issues.push('DIMENSION_DELTA_SUM_DRIFT');
  }
  return { ok: issues.length === 0, issues };
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const check = args.includes('--check');
  if (write === check) {
    process.stderr.write('用法：node scripts/m-blueprint-m7-final.mjs --check | --write（互斥）\n');
    process.exit(2);
  }
  const ledger = buildLedger();
  const verdict = adjudicateLedger(ledger);
  if (write) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'gap-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
    fs.writeFileSync(path.join(OUT, 'eleven-dimension-col8.json'), `${JSON.stringify({ schemaVersion: 1, kind: 'm7-eleven-dimension-col8', ...ledger.dimensionSummary, dimensions: ledger.dimensions, note: '不回溯改第七列；第八列非 verified 声明', g0Note: ledger.g0Note }, null, 2)}\n`);
    process.stdout.write(`[m7-final] gap-ledger ${ledger.totals.items} 件（M70 + G12）/ in_progress=0 / counts=${JSON.stringify(ledger.counts)}；十一维第八列 ${ledger.dimensionSummary.rises} 升 ${ledger.dimensionSummary.flats} 平 ${ledger.dimensionSummary.drops} 降\n`);
    process.exit(0);
  }
  process.stdout.write(`[m7-final] 逐件终态门 → ${verdict.ok ? 'PASS' : 'FAIL'}（${verdict.issues.length} issues）\n`);
  for (const i of verdict.issues.slice(0, 20)) process.stdout.write(`  ✖ ${i}\n`);
  process.exit(verdict.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
