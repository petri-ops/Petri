/**
 * BLOCK-337 第二批契约测试 — P2 调用侧接线 + P7③ 坡道观察接入账本 + P4 closeout 宿主原语
 * + P5 收口自动落账（P3 并行门的 registry 侧契约在 test/docs-governance.test.mjs）。
 *
 * 只钉机制不钉文案：
 *   - P2：workspacePath 唯一可信来源是 projects 表；客户端传值一律覆盖/剥除；
 *     派生失败=零治理上下文，绝不阻断对话。
 *   - P7③：观察行 → 账本 entries 的键规则（全限定喂包规则 / 裸 id 进 observed 命名空间）、
 *     复盘结论 misfire 迁移、渲染侧降级 observe 档；账本阈值单一实现。
 *   - P4：closeout 原语唯一执行路径 = deps.closeout；verdict 进 journal；不绿即 blocked；
 *     host 缺席诚实报 unavailable（不伪造）。
 *   - P5：三块草稿只填机械槽位，缺槽位=<待补：x> 占位（不编造事实）；草稿只在全绿时渲染。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 观察存储走真实 db 模块——本文件内先钉死隔离库路径（block323 同款隔离形态：
// 先用 src/migrations 预建表，再设 PETRI_DB_PATH；观察存储懒取该库）
const TEMP_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'block337-batch2-'));
{
  const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
  const boot = new Database(path.join(TEMP_DB_DIR, 'petri.db'));
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
}
process.env.PETRI_DB_PATH = path.join(TEMP_DB_DIR, 'petri.db');
process.on('exit', () => {
  try { fs.rmSync(TEMP_DB_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const { resolveSessionWorkspacePath, applySessionWorkspacePath } = require(
  path.join(ROOT, 'core', 'petri-server', 'helpers', 'session-workspace.js')
);
const { renderGovernanceRuntimeSection } = require(
  path.join(ROOT, 'core', 'shared-backend', 'governance', 'workspace-rules.js')
);
const { createRuleLedger, statusFromEntry } = require(
  path.join(ROOT, 'core', 'shared-backend', 'governance', 'rule-lifecycle.js')
);
const { ledgerEntriesFromRows } = require(
  path.join(ROOT, 'core', 'shared-backend', 'governance', 'observation-bridge.js')
);
const {
  renderNextStepBrief,
  renderAuditLogRow,
  renderHandoffResume,
  renderCloseoutLedgerDraft,
} = require(path.join(ROOT, 'core', 'shared-backend', 'governance', 'closeout-ledger.js'));
const { createCloseoutHost } = require(
  path.join(ROOT, 'core', 'petri-server', 'helpers', 'closeout-host.js')
);
const runnerMod = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'workflow-runner.js'));

function tempWorkspace(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block337-b2-ws-'));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

// ── P2 调用侧接线 ────────────────────────────────────────────

test('BLOCK-337 P2 workspacePath 从 projects 表派生并覆盖客户端传值', () => {
  const getProject = (id) => (id === 'p1' ? { id, workspace_path: '/tmp/proj-one' } : null);

  const derived = applySessionWorkspacePath({ page: 'desktop-project', projectId: 'p1' }, { getProject });
  assert.equal(derived.workspacePath, '/tmp/proj-one');

  // 客户端伪造路径一律以 db 为准覆盖
  const forged = applySessionWorkspacePath(
    { page: 'desktop-project', projectId: 'p1', workspacePath: '/etc/passwd' },
    { getProject }
  );
  assert.equal(forged.workspacePath, '/tmp/proj-one');
});

test('BLOCK-337 P2 无 projectId / ssh 项目 / 查询失败 → 剥除客户端传值（零治理注入）', () => {
  const getProject = () => ({ id: 'ssh-p', workspace_path: null });

  // 无 projectId：客户端传的路径不可信 → 剥
  const noProject = applySessionWorkspacePath({ page: 'desktop-project', workspacePath: '/etc' }, { getProject });
  assert.equal('workspacePath' in noProject, false);

  // ssh 项目 workspace_path=null（远程唯一真值）→ 剥
  const ssh = applySessionWorkspacePath({ projectId: 'ssh-p', workspacePath: '/etc' }, { getProject });
  assert.equal('workspacePath' in ssh, false);

  // 查询抛错 → 剥，且不抛（装载失败绝不阻断对话）
  const boom = applySessionWorkspacePath(
    { projectId: 'p1', workspacePath: '/etc' },
    { getProject: () => { throw new Error('db down'); } }
  );
  assert.equal('workspacePath' in boom, false);
  assert.equal(resolveSessionWorkspacePath({ projectId: 'p1' }, { getProject: () => { throw new Error('x'); } }), undefined);

  // 非对象 context 原样返回不抛
  assert.equal(applySessionWorkspacePath(null), null);
  assert.equal(applySessionWorkspacePath(undefined), undefined);
});

// ── P7③ 观察桥 ──────────────────────────────────────────────

test('BLOCK-337 P7③ 观察行→账本键：全限定喂包规则，裸 id/工具名进 observed 命名空间', () => {
  const entries = ledgerEntriesFromRows([
    { ruleId: 'software-governed::single-active-package', toolName: '', hits: 4, reviewDecision: null },
    { ruleId: 'r-candidate', toolName: 'workspace_exec', hits: 7, reviewDecision: null },
    { ruleId: '', toolName: 'workspace_write', hits: 2, reviewDecision: null },
    { ruleId: '', toolName: '', hits: 9, reviewDecision: null }, // 无身份 → 丢弃
    'not-an-object', // 非 object → 忽略
  ]);
  assert.deepEqual(entries['software-governed::single-active-package'], { hits: 4, misfires: 0 });
  assert.deepEqual(entries['observed::r-candidate'], { hits: 7, misfires: 0 });
  assert.deepEqual(entries['observed::workspace_write'], { hits: 2, misfires: 0 });
  assert.equal(Object.keys(entries).length, 3, `无身份行必须丢弃：${JSON.stringify(entries)}`);
});

test('BLOCK-337 P7③ 复盘结论：misfire 整行命中迁为误拦，confirmed 保持命中，同键合并', () => {
  const entries = ledgerEntriesFromRows([
    { ruleId: 'p::r1', hits: 5, reviewDecision: 'misfire' },
    { ruleId: 'p::r1', hits: 2, reviewDecision: 'misfire' },
    { ruleId: 'p::r2', hits: 3, reviewDecision: 'confirmed' },
    { ruleId: 'p::r3', hits: 6, reviewDecision: null }, // 未复盘=乐观计命中
  ]);
  assert.deepEqual(entries['p::r1'], { hits: 0, misfires: 7 });
  assert.deepEqual(entries['p::r2'], { hits: 3, misfires: 0 });
  assert.deepEqual(entries['p::r3'], { hits: 6, misfires: 0 });

  // 迁移结果直接驱动降级判定（与账本本体同一阈值实现）
  const ledger = createRuleLedger({ entries });
  assert.equal(ledger.status('p', 'r1').mode, 'observe', '7 连误拦必须降级 observe');
  assert.equal(ledger.status('p', 'r2').mode, 'enforce');
});

test('BLOCK-337 P7③ statusFromEntry 与账本本体共用单一阈值实现', () => {
  const ledger = createRuleLedger();
  ledger.recordOutcome({ packId: 'x', ruleId: 'a', outcome: 'hit' });
  for (let i = 0; i < 3; i += 1) ledger.recordOutcome({ packId: 'x', ruleId: 'a', outcome: 'misfire' });
  assert.deepEqual(statusFromEntry({ hits: 1, misfires: 3 }), ledger.status('x', 'a'));
  assert.equal(statusFromEntry(null).mode, 'enforce');
  assert.equal(statusFromEntry({ hits: 'bad', misfires: 2 }).total, 2, '非法计数按 0 计');
});

test('BLOCK-337 P7③ 渲染侧：降级规则按观察档标注，未装账本零行为变化', () => {
  const ws = tempWorkspace({
    'docs/DOC-REGISTRY.json': '{}',
    'AGENTS.md': '# agents\n',
  });

  const baseline = renderGovernanceRuntimeSection({ workspacePath: ws });
  assert.ok(baseline.includes('- [必须] '), '未装账本 → 全部 [必须]（零行为变化）');
  assert.ok(!baseline.includes('观察·待复盘'));

  // 把 single-active-package 降级 observe（3 连误拦率 1.0）
  const downgraded = renderGovernanceRuntimeSection({
    workspacePath: ws,
    ledgerEntries: { 'software-governed::single-active-package': { hits: 0, misfires: 3 } },
  });
  assert.ok(downgraded.includes('- [观察·待复盘] '), `降级规则应按观察档渲染：${downgraded.slice(0, 200)}`);
  assert.ok(downgraded.includes('- [必须] '), '未降级规则仍为 [必须]');
  assert.ok(downgraded.includes('- [判断] '), 'judgment 类不受账本影响');
});

test('BLOCK-337 P7③ 观察存储：复盘结论落列 + 全量规则观察清单（账本桥数据源）', async () => {
  const store = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'policy-observation-store.js'));
  const first = await store.recordObservation({
    kind: 'rule-observe', ruleId: 'software-governed::single-active-package', toolName: 'workspace_exec',
    fingerprint: 'fp-b2-1', guardKey: 'rule:x', samplePreview: '{}',
  });
  assert.equal(first.ok, true);
  await store.recordObservation({
    kind: 'rule-observe', ruleId: 'software-governed::single-active-package', toolName: 'workspace_exec',
    fingerprint: 'fp-b2-1', guardKey: 'rule:x', samplePreview: null,
  });

  // 复盘判 misfire → review_decision 落列
  const unreviewed = await store.listUnreviewed();
  assert.equal(unreviewed.length, 1);
  assert.equal(unreviewed[0].reviewDecision, null);
  const marked = await store.markReviewed({ ids: [unreviewed[0].id], decision: 'misfire' });
  assert.equal(marked.ok, true);

  // 全量清单（含已复盘）= 桥的输入；hits=2 整行迁为 misfires → 降级
  const allRows = await store.listRuleObservations();
  assert.equal(allRows.length, 1);
  assert.equal(allRows[0].hits, 2);
  assert.equal(allRows[0].reviewDecision, 'misfire');

  const entries = ledgerEntriesFromRows(allRows);
  assert.deepEqual(entries['software-governed::single-active-package'], { hits: 0, misfires: 2 });
  const ledger = createRuleLedger({ entries });
  assert.equal(ledger.status('software-governed', 'single-active-package').mode, 'enforce',
    '2 误拦未达下限 3 → 仍 enforce（阈值纪律不被桥穿透）');
});

// ── P5 落账渲染（纯函数） ────────────────────────────────────

test('BLOCK-337 P5 三块草稿：槽位齐全逐字渲染，缺槽位=<待补：x> 不编造', () => {
  const brief = renderNextStepBrief({
    suggestion: 'BLOCK-335（就绪，缺首批题）',
    waveOrder: '337 → 335',
    blueprint: {
      qMatrix: '✅74 / 🟡21 / 🔴0 / ⛔7 = 102',
      competitiveness: 'BLOCK-322 收口，余 RULING-02/04 待裁决',
      resultStudio: 'implemented_unverified / experimental（G0 常态）',
      uiLedger: '449 verified / 26 in_progress',
      activePackages: 'BLOCK-337（第二批）',
    },
  });
  assert.ok(brief.startsWith('Jev 单一建议：BLOCK-335'));
  assert.ok(brief.includes('母纲波次顺序：337 → 335'));
  assert.ok(brief.includes('- 母纲 Q-MATRIX：✅74'));
  assert.ok(brief.includes('- UI 台账：449 verified / 26 in_progress'));

  const sparse = renderNextStepBrief({});
  assert.ok(sparse.includes('<待补：suggestion>'));
  assert.ok(sparse.includes('<待补：blueprint.qMatrix>'), '缺槽位必须占位，不得编造');

  const row = renderAuditLogRow({ headline: '✅ BLOCK-337 batch2', date: '2026-11-03', detail: 'a|b\nc', domain: 'BLOCK-337 / P6' });
  assert.equal(row, '| ✅ BLOCK-337 batch2 | 2026-11-03 | a\\|b c | BLOCK-337 / P6 |', '表行管道符转义 + 换行拍平');
  assert.ok(renderAuditLogRow({}).includes('<待补：headline>'));

  const resume = renderHandoffResume({ packageId: 'BLOCK-337', phase: 'P6', entry: 'docs/block-337-governance-runtime-plan.md §3', evidence: 'acceptance/block-337/' });
  assert.ok(resume.includes('- 恢复入口：docs/block-337'));
  assert.ok(renderHandoffResume({}).includes('<待补：packageId>'));

  const draft = renderCloseoutLedgerDraft({ nextStepBrief: { suggestion: 's' }, auditLogRow: { headline: 'h' } });
  assert.equal(draft.nextStepBrief.split('\n').length, 8, '固定块 8 行形态');
  assert.equal(typeof draft.handoffResume, 'string');
});

// ── P4 closeout 宿主原语（runner 侧，deps 注入） ─────────────

const CLOSEOUT_SCRIPT = [
  "export const meta = { name: 'p4c', version: 1, budget: { maxAgents: 1 }, concurrency: 1 };",
  'export default async function run(args) {',
  '  return await closeout(args);',
  '}',
].join('\n');

function readJournal(root, runId) {
  const file = path.join(root, runId, 'journal.jsonl');
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

test('BLOCK-337 P4 closeout 原语：全绿→ready 入 journal；不绿→blocked；host 缺席→unavailable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'block337-b2-wf-'));

  // 全绿 + 台账草稿
  const green = runnerMod.startWorkflowRun({
    source: CLOSEOUT_SCRIPT,
    args: { forceFull: false, ledger: { nextStepBrief: { suggestion: 's1' } } },
    userId: 'u1',
    deps: { closeout: async (payload) => ({ ok: true, verdict: 'ready', exitCode: 0, durationMs: 3, gates: payload.gates || 'default-full-chain', ledgerDraft: { nextStepBrief: 'b', auditLogRow: 'r', handoffResume: 'h' } }) },
    root,
  });
  const greenResult = await green.promise;
  assert.equal(greenResult.status, 'completed');
  assert.equal(greenResult.returned.verdict, 'ready');
  const greenRows = readJournal(root, green.runId).filter((row) => row.kind === 'closeout');
  assert.equal(greenRows.length, 1);
  assert.equal(greenRows[0].status, 'ready');
  assert.equal(greenRows[0].hasLedgerDraft, true, 'ledger 草稿在场必须入 journal');

  // 不绿 → blocked（不可宣称 completed 的机械语义）
  const red = runnerMod.startWorkflowRun({
    source: CLOSEOUT_SCRIPT,
    args: {},
    userId: 'u1',
    deps: { closeout: async () => ({ ok: false, verdict: 'blocked', exitCode: 1, durationMs: 4, error: 'gate red' }) },
    root,
  });
  const redResult = await red.promise;
  assert.equal(redResult.returned.verdict, 'blocked');
  assert.equal(readJournal(root, red.runId).find((row) => row.kind === 'closeout').status, 'blocked');

  // host 缺席 → 诚实 unavailable，不伪造 ready
  const absent = runnerMod.startWorkflowRun({
    source: CLOSEOUT_SCRIPT, args: {}, userId: 'u1', deps: {}, root,
  });
  const absentResult = await absent.promise;
  assert.equal(absentResult.returned.verdict, 'unavailable');
  assert.equal(absentResult.returned.ok, false);

  // deps 抛错 → failed（不吞异常伪装绿）
  const throwing = runnerMod.startWorkflowRun({
    source: CLOSEOUT_SCRIPT,
    args: {},
    userId: 'u1',
    deps: { closeout: async () => { throw new Error('host exploded'); } },
    root,
  });
  const throwResult = await throwing.promise;
  assert.equal(throwResult.returned.verdict, 'failed');
  assert.match(String(throwResult.returned.error), /host exploded/);
});

// ── P4 closeout 生产 deps（closeout-host 子进程真跑） ────────

test('BLOCK-337 P4 closeout-host：子进程跑聚合器，退出码=verdict，参数透传，草稿只在全绿时渲染', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'block337-b2-host-'));
  const scriptDir = path.join(cwd, '.agents', 'skills', 'petri-dev-infra', 'scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptDir, 'closeout-gates.mjs'),
    [
      "import fs from 'node:fs';",
      "import path from 'node:path';",
      "fs.writeFileSync(path.join(process.cwd(), 'args.txt'), JSON.stringify(process.argv.slice(2)));",
      "console.log('fake-closeout', process.argv.slice(2).join(' '));",
      "process.exit(Number(process.env.FAKE_CLOSEOUT_EXIT ?? '0'));",
    ].join('\n'),
    'utf8'
  );

  const host = createCloseoutHost({ cwd });

  process.env.FAKE_CLOSEOUT_EXIT = '1';
  const blocked = await host({ gates: ['gate:code-size'], noTests: true });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.verdict, 'blocked');
  assert.equal(blocked.exitCode, 1);
  assert.ok(blocked.tail.includes('fake-closeout'), '失败必须带输出尾巴供归因');
  const blockedArgs = JSON.parse(fs.readFileSync(path.join(cwd, 'args.txt'), 'utf8'));
  assert.deepEqual(blockedArgs, ['--gate', 'gate:code-size', '--no_tests']);

  delete process.env.FAKE_CLOSEOUT_EXIT;
  const ready = await host({ gates: ['gate:code-size'], ledger: { nextStepBrief: { suggestion: 'next: 335' }, auditLogRow: { headline: 'h' }, handoffResume: { packageId: 'p' } } });
  assert.equal(ready.ok, true);
  assert.equal(ready.verdict, 'ready');
  assert.ok(ready.ledgerDraft.nextStepBrief.includes('next: 335'));
  assert.ok(ready.ledgerDraft.auditLogRow.includes('<待补：detail>'), '缺槽位占位诚实呈现');

  // signal 已中止 → 不起子进程直接 cancelled
  const controller = new AbortController();
  controller.abort();
  const cancelled = await host({ signal: controller.signal });
  assert.equal(cancelled.verdict, 'cancelled');
});
