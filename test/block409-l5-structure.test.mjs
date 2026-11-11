/**
 * BLOCK-409（第五轮 L5 结构与单源）契约测试。
 * 逐件随实现落测；蓝图 docs/post-k7-full-audit-and-blueprint-2026-11-10.md §4-L5。
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---- L5-3 / L-41：branch-db 注释时态更正（缺陷已闭合的如实表述） ----
test('L5-3 注释更正：branch-db 路径解析注释改为「曾两套入口/现已委托单源」时态（不再误导后续审计）', () => {
  const src = read('src/database/branch-db.js');
  assert.match(src, /【现已委托单源】/, '闭合时态注记在场');
  assert.doesNotMatch(src, /与 core\/shared-backend\/db-connection-policy\.js 的\s*\n\s*\/\/ resolveDbPath 形成两套入口（同一次运行里两个消费者可能指向不同文件）。\s*\n\s*\/\/ 现直接委托单源;/, '旧误导表述已退役');
  assert.match(src, /resolveCore\('shared-backend', 'db-connection-policy'\)/, '单源消费仍在（BLOCK-412 起 resolveCore 路由=与 L5-1 单源同族）');
});

// ---- L5-4 / L-49：warnings 棘轮销号确认（L0-6 已交付） ----
test('L5-4 销号：L-49「warn 计数入棘轮」= L0-6 quality:lint:ledger 交付（独立于 B-31 抑制域棘轮）', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'test', 'lint-warnings-baseline.json')), 'warnings 分域基线在册');
  assert.match(read('scripts/lint-ledger-verify.mjs'), /新增 warning 即红/, '原始 warnings 只减棘轮在场（L-49 口径）');
  // B-31（抑制台账分域）与 L0-6（原始 warnings 分域）是两机制、互不替代——注记双机制在档
  assert.match(read('scripts/post-s7-hygiene-gates.mjs'), /evaluateLintRatchet/);
});

// ---- L5-1 / L-38：resolveCore 单源静态门 ----
test('L5-1 负测：core-utils 之外不得定义 resolveCore/resolveCoreRoot（植入第五份 mirror 必红）', () => {
  const files = [
    'src/ipc/ai-settings.js',
    'src/ipc/harness-capabilities.js',
    'src/ipc/terminal.js',
    'src/main/backend-proc-manager.js',
  ];
  for (const rel of files) {
    const src = read(rel);
    assert.doesNotMatch(src, /function resolveCore(Root)?\(/, `${rel} 残留 mirror 定义`);
    assert.match(src, /core-utils/, `${rel} 须消费 core-utils 单源`);
  }
  // 单源在场且 dev 态可解析（主进程模块在 node 下可加载——electron 缺席走 fail-closed 兜底）
  const cuSrc = read('src/main/core-utils.js');
  assert.match(cuSrc, /function resolveCoreRoot\(\)/, '单源定义在 core-utils');
});

test('L5-1 附带修复：terminal snapshot command 不再丢子路径（mirror 丢参 bug）', () => {
  const src = read('src/ipc/terminal.js');
  assert.doesNotMatch(src, /resolveCore\(\.\.\._parts\)/, '丢参签名已退役');
  assert.match(src, /resolveCore\("petri-server", "server\.js"\)/, '调用点带子路径');
});


// ---- L5-2 / L-39：双表跨一致性锚（单一 schema 生成两视图=补腿；锚先落） ----
test('L5-2 跨表锚：CONTRACTS ⊆ TOOL_METADATA（源码键扫描——registry 有 DB 侧效应不可整模块导入）', async () => {
  const { TOOL_METADATA } = await import('../core/petri-server/agent-tools/tool-metadata.js');
  // 源码键扫描（registry.js 装载有 DB 侧效应，整模块导入在测试环境不可行——
  // 与 k4 源码扫描同族口径；CONTRACTS 键 = '"name": "xxx"' 形态）
  const registrySrc = read('core/petri-server/agent-tools/registry.js');
  // 注意 [a-z0-9_]+：model3d 系含数字——[a-z_]+ 会在 '3' 断开（历史提取口径 bug 实测锚定）
  const contractNames = [...registrySrc.matchAll(/^\s{2}([a-z0-9_]+): contract\(/gm)].map((m) => m[1]);
  const uniqueContracts = [...new Set(contractNames)];
  assert.ok(uniqueContracts.length >= 110, `CONTRACTS 规模 ${uniqueContracts.length}（[a-z_]+ 旧口径漏 12 个 model3d）`);
  // 跨表锚（登记制缺口）：12 个 model3d 契约缺 TOOL_METADATA = 真实债（L5-2 登记留痕，
  // 补元数据时从本清单移除=只减棘轮）；未登记的新缺口仍然必红。
  const KNOWN_METADATA_GAPS = ['model3d_inspect','model3d_validate','model3d_propose','model3d_apply','model3d_render','model3d_export','model3d_visual_qa','model3d_recipe','model3d_bom','model3d_asset','model3d_share','model3d_blend_ops'];
  // eslint-disable-next-line security/detect-object-injection -- 基线白名单键取值（n 来自在册 CONTRACTS 键集合，非外部输入）
  const missing = uniqueContracts.filter((n) => TOOL_METADATA[n] === undefined);
  const unknown = missing.filter((n) => !KNOWN_METADATA_GAPS.includes(n));
  assert.deepEqual(unknown, [], `契约无元数据且未登记（跨表漏登记即红）: ${unknown.join(', ')}`);
  // 孤儿登记：skill_execute 有元数据无契约=执行语义另裁（BLOCK-157，retain-with-reason）
  const metadataNames = Object.keys(TOOL_METADATA);
  const orphans = metadataNames.filter((n) => !uniqueContracts.includes(n));
  assert.deepEqual(orphans, ['skill_execute'], `元数据孤儿清单（超出登记清单即红）: ${orphans.join(', ')}`);
});

test('L5-2 文档定性统一：backlog 2c 行加第五轮复核注记（职责分离+跨表锚；四轮蓝图「合一」按 registry 现状为准）', () => {
  const backlog = read('docs/pending-work-backlog.md');
  assert.match(backlog, /L5-2（BLOCK-409）第五轮复核/, '第五轮复核注记在场');
});

// ---- L5-6 / L-78/L-85：engines 三树一致 + @docusaurus 退役 ----
test('L5-6 engines：三份 package.json node>=24 对齐（机械锚）', () => {
  const rootPkg = JSON.parse(read('package.json'));
  const fePkg = JSON.parse(read('frontend/package.json'));
  const corePkg = JSON.parse(read('core/petri-server/package.json'));
  for (const [name, pkg] of [['root', rootPkg], ['frontend', fePkg], ['core', corePkg]]) {
    assert.equal(pkg.engines?.node, '>=24', `${name} engines.node 缺失或不一致`);
  }
});

test('L5-6/L-85：@docusaurus/tsconfig 零声明零消费（退役核验）', () => {
  const fePkg = JSON.parse(read('frontend/package.json'));
  assert.equal(fePkg.devDependencies['@docusaurus/tsconfig'], undefined, 'devDependencies 已退役');
  const feLock = JSON.parse(read('frontend/package-lock.json'));
  assert.equal(Object.keys(feLock.packages || {}).filter((k) => k.includes('@docusaurus/tsconfig')).length, 0, 'lock 零残余');
  const feTs = read('frontend/tsconfig.json');
  assert.doesNotMatch(feTs, /extends/, 'tsconfig 无 extends（内联 compilerOptions 现状）');
});

// ---- L5-5 / L-46：W5b 例外下降行数登记（台账读数，不判红——拆分为独立切片纪律） ----
test('L5-5 例外台账：16 条例外的 grant→当前行数差值登记（下降=清偿进展；反涨=显式留因）', () => {
  const exceptions = JSON.parse(read('acceptance/block-92/size-exceptions.json'));
  const rows = (exceptions.exceptions || []).map((e) => {
    let current = null;
    try { current = read(e.path).split('\n').length; } catch { current = null; }
    return { path: e.path, linesAtGrant: e.linesAtGrant ?? null, current, delta: current != null && e.linesAtGrant != null ? current - e.linesAtGrant : null };
  });
  assert.ok(rows.length >= 16, `例外条目 ${rows.length}`);
  // 台账登记（读数落本测试输出；补腿=每一切片独立会话拆前拆后同套绿，见 plan §7）
  const grown = rows.filter((r) => r.delta != null && r.delta > 0);
  const shrunk = rows.filter((r) => r.delta != null && r.delta < 0);
  console.log(`[L5-5] 例外行数台账：下降 ${shrunk.length} 项 / 反涨 ${grown.length} 项 / 无 grant 读数 ${rows.filter((r) => r.delta === null).length} 项（拆分进度登记，见 BLOCK-409 plan §7）`);
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'code-size-ledger.mjs')), 'bytes/行数棘轮执行体在档');
});
