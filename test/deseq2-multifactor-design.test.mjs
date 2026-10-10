// D3 多因子 design 契约测试（红绿先行 · 先红阶段）
//
// 契约锚（G0-BIO，docs/g0-bio-delivery-goal-plan.md）：
//   §2.0(:34)  design formula 被收窄为单列名（deseq2.R:168 拼 ~ <col>），
//              多因子设计 `~ batch + condition` 不支持
//   §2.5(:79)  收窄：多因子 design 不支持
//   BIO-D5(:122) 多因子 design 裁决点 = R 公式语法暴露程度与防呆深度
//
// 被测链（单列假设的精确位置）：
//   pack 侧  petri-pack-bio/plugins/deseq2/scripts/deseq2.R
//            :57-61 normalize_design_col 仅剥首个 `~`，:63 收窄为标量 design_col，
//            :108 Preflight 2 按单列名 `%in% colnames` 校验，:168 as.formula(paste0("~ ", design_col))
//   desktop  core/shared-backend/scientific-task-planner.js
//            :107-120 coldataBinding.designColumn = 关键词嗅探出的单列；
//            planner 完全不读 taskSpec.design（schema 既有 groups/covariates 词汇，
//            见 core/shared-backend/scientific-task-spec.js:171-182）
//
// 本文件结果（2026-10-07 BLOCK-145 D3 转绿）：
//   ① 多因子接受契约（designFormula/designTerms/因子项解析/e2e 全链）= 绿
//   ② 防呆 fail-closed 锚（缺 ~ / 未知列 / 数字列名 / 单因子与空回退保持）= 绿
// 先红阶段证据（2026-10-07 早前运行）：同套件 3 红 + 5 绿，红因=单列收窄/误拆。
//
// BLOCK-146 C#10（契约指纹锚）：R 依赖测试在 Rscript 缺位的机器上全部 skip 时，
// pack 仓内容漂移（单列收窄回潮）会被静默掩盖——新增不依赖 Rscript 的内容指纹锚
// （parse_design_terms 在场判据），符号缺失=红而非 skip；Rscript 检测同时与 app
// 运行时同源（RExecutor.binPath：rHome 内嵌优先 → PATH 兜底），不再裸探测 PATH。
//
// R 侧用 Rscript 直接执行 deseq2.R 的真实源码（提取 design 解析函数 / 端到端跑
// 脚本），非复制逻辑的影子实现；Rscript 或 pack 仓不在位时显式 skip，不伪装通过。

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { planScientificTask, STATUS } = require('../core/shared-backend/scientific-task-planner.js');
// C#10：Rscript 检测与 app 运行时同源——插件执行链（tools-executor.js:1473/1504、
// run-plugin-script.js:273/360）spawn 的就是 RExecutor.binPath（rHome 内嵌优先 →
// PATH 兜底），测试沿用同一解析而非裸 PATH 探测，避免「app 能找到、测试探不到」
// （或反之）的口径漂移。
const { RExecutor } = require('../core/shared-backend/executors/r-executor.js');

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(TEST_DIR, '..');
const DESEQ2_DIR = path.resolve(DESKTOP_ROOT, '..', 'petri-pack-bio', 'plugins', 'deseq2');
const DESEQ2_R = path.join(DESEQ2_DIR, 'scripts', 'deseq2.R');
const THEME_R = path.join(DESEQ2_DIR, 'scripts', '_petri-theme.R');

// ---------------------------------------------------------------------------
// 环境探测：R 依赖测试不在位时显式 skip（skip ≠ pass）
// ---------------------------------------------------------------------------

// app 同源 Rscript 解析（RExecutor.binPath）：返回可执行文件绝对路径或 null。
// 内嵌 R（PETRI_R_HOME / core/petri-server/R）优先，PATH（Rscript.exe/Rscript）兜底。
let rscriptBin;
function resolveRscriptBin() {
  if (rscriptBin === undefined) {
    rscriptBin = null;
    try {
      const bin = new RExecutor().binPath;
      if (typeof bin === 'string' && bin && fs.existsSync(bin)) rscriptBin = bin;
    } catch {
      rscriptBin = null;
    }
  }
  return rscriptBin;
}

let rscriptUsable;
function rscriptAvailable() {
  if (rscriptUsable === undefined) {
    const bin = resolveRscriptBin();
    rscriptUsable = Boolean(bin) && spawnSync(bin, ['--version'], { encoding: 'utf8' }).status === 0;
  }
  return rscriptUsable;
}

function requireREnvironment(t) {
  if (!fs.existsSync(DESEQ2_R)) {
    t.skip('petri-pack-bio/plugins/deseq2 不在位（兄弟仓未检出）');
    return false;
  }
  if (!rscriptAvailable()) {
    t.skip('Rscript 不可用（R 运行时未安装）');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// C#10 pack 内容指纹锚：多因子契约在场的机械判据（不依赖 Rscript，漂移红而非 skip）
// ---------------------------------------------------------------------------

test('C#10 pack 指纹锚：deseq2.R 必须定义 parse_design_terms(x)（多因子 design 契约在场判据，符号缺失=红）', (t) => {
  if (!fs.existsSync(DESEQ2_R)) {
    // 兄弟仓整体未检出属环境缺失（与既有 7 个 R 测试同口径 skip）；仓在位而符号
    // 缺失才是本锚要抓的漂移——那是红，不许 skip 掩盖。
    t.skip('petri-pack-bio/plugins/deseq2 不在位（兄弟仓未检出）');
    return;
  }
  const rSource = fs.readFileSync(DESEQ2_R, 'utf8');
  assert.match(
    rSource,
    /parse_design_terms\s*<-\s*function\s*\(\s*x\s*\)/,
    'deseq2.R 缺 parse_design_terms(x) 定义——多因子 design 契约（~ batch + condition）不在场，'
      + 'pack 仓漂移回单列收窄形态（对照 desktop 契约 core/shared-backend/scientific-task-planner.js '
      + 'designFormula/designTerms）；须在 pack 仓补齐后再收口，不得以 skip 掩盖',
  );
});

// ---------------------------------------------------------------------------
// R 侧纯函数级：从 deseq2.R 提取 design 解析函数，用 Rscript 执行真实源码
// ---------------------------------------------------------------------------

const DESIGN_FN_ALLOWLIST = /^(normalize_design_col|parse_design_(?:formula|terms)|design_(?:formula_)?terms)$/;

function extractDesignFunction(rSource) {
  const lines = rSource.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const matched = lines[i].match(/^(\w+)\s*<-\s*function\s*\(\s*x\s*\)/);
    if (!matched || !DESIGN_FN_ALLOWLIST.test(matched[1])) continue;
    const body = [lines[i]];
    for (let j = i + 1; j < lines.length; j += 1) {
      body.push(lines[j]);
      if (/^}\s*$/.test(lines[j])) break;
    }
    return { name: matched[1], source: body.join('\n') };
  }
  return null;
}

// 每个用例输出 `key \t 序号 \t 因子项` 行，`key \t #` 行收尾；JS 侧还原为项数组。
function runDesignFunctionCases(_t) {
  const rSource = fs.readFileSync(DESEQ2_R, 'utf8');
  const fn = extractDesignFunction(rSource);
  assert.ok(
    fn,
    'deseq2.R 必须提供 design 公式解析入口（normalize_design_col / parse_design_*），并把 R 公式解析为因子项向量',
  );
  const harness = [
    '`%||%` <- function(a, b) if (is.null(a) || (length(a) == 0 && !is.list(a))) b else a',
    fn.source,
    'run_case <- function(key, x) {',
    `  terms <- ${fn.name}(x)`,
    '  if (is.null(terms)) terms <- character(0)',
    '  for (i in seq_along(terms)) cat(key, "\\t", i, "\\t", terms[i], "\\n", sep = "")',
    '  cat(key, "\\t#\\n", sep = "")',
    '}',
    'run_case("multi", "~ batch + condition")',
    'run_case("single", "~ condition")',
    'run_case("empty", "")',
    'run_case("null", NULL)',
    '',
  ].join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deseq2-mf-parse-'));
  try {
    const harnessPath = path.join(dir, 'harness.R');
    fs.writeFileSync(harnessPath, harness);
    const run = spawnSync(resolveRscriptBin(), [harnessPath], { encoding: 'utf8', timeout: 60000 });
    assert.equal(run.status, 0, `R harness 执行失败: ${(run.stderr || run.stdout || '').slice(0, 2000)}`);
    const terms = {};
    for (const line of (run.stdout || '').split('\n')) {
      if (!line.trim()) continue;
      const [key, index, value] = line.split('\t');
      if (index === '#') continue;
      (terms[key] ||= [])[Number(index) - 1] = value;
    }
    return terms;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// R 侧端到端：最小 job 目录直接跑 deseq2.R（counts 40 基因 × 6 样本，preflight 可过）
// ---------------------------------------------------------------------------

// 40 基因 × 6 样本确定性矩阵（无随机数，公式生成：i%8==1 高离散、i%3 条件上调、
// i%5 下调、i%4 batch 效应、其余 ±18% 摆动）。离散度需覆盖 ≥2 个数量级，
// 否则 DESeq 参数化 dispersion 拟合对小矩阵报
// "all gene-wise dispersion estimates are within 2 orders of magnitude..."。
const COUNTS_CSV = [
  'gene,S1,S2,S3,S4,S5,S6',
  'G1,24,24,3,2,29,29',
  'G2,27,27,37,19,26,26',
  'G3,48,48,86,48,86,86',
  'G4,53,53,49,85,78,78',
  'G5,57,57,23,57,23,23',
  'G6,60,60,189,42,132,132',
  'G7,92,92,85,92,85,85',
  'G8,95,95,87,152,139,139',
  'G9,96,96,3,6,115,115',
  'G10,95,95,39,67,27,27',
  'G11,93,93,130,93,130,130',
  'G12,140,140,283,224,453,453',
  'G13,138,138,126,138,126,126',
  'G14,135,135,122,94,85,85',
  'G15,130,130,137,130,137,137',
  'G16,188,188,173,301,278,278',
  'G17,168,168,3,9,202,202',
  'G18,177,177,335,124,234,234',
  'G19,169,169,152,169,152,152',
  'G20,160,160,100,255,160,160',
  'G21,232,232,341,232,341,341',
  'G22,223,223,203,156,142,142',
  'G23,212,212,192,212,192,192',
  'G24,200,200,535,319,856,856',
  'G25,240,240,3,13,288,288',
  'G26,272,272,249,190,174,174',
  'G27,258,258,544,258,544,544',
  'G28,243,243,218,388,350,350',
  'G29,226,226,314,226,314,314',
  'G30,324,324,247,227,173,173',
  'G31,307,307,281,307,281,281',
  'G32,289,289,262,463,419,419',
  'G33,312,312,3,17,374,374',
  'G34,379,379,350,266,245,245',
  'G35,360,360,149,360,149,149',
  'G36,339,339,530,542,848,848',
  'G37,316,316,285,316,285,285',
  'G38,292,292,406,204,284,284',
  'G39,416,416,796,416,796,796',
  'G40,392,392,161,627,258,258',
  '',
].join('\n');

// batch 与 condition 双因子齐备、各 3 重复（多因子全链跑通的合法数据面）
const COLDATA_MULTI = [
  'sample,batch,condition',
  'S1,b1,Control',
  'S2,b1,Control',
  'S3,b1,Treatment',
  'S4,b2,Control',
  'S5,b2,Treatment',
  'S6,b2,Treatment',
  '',
].join('\n');

// coldata 含字面名为 "2024" 的列（数字列名：R 合法列名但非法公式符号）
const COLDATA_NUMERIC = [
  'sample,batch,condition,2024',
  'S1,b1,Control,a',
  'S2,b1,Control,a',
  'S3,b1,Treatment,a',
  'S4,b2,Control,b',
  'S5,b2,Treatment,b',
  'S6,b2,Treatment,b',
  '',
].join('\n');

function runDeseq2Fixture(t, { params, coldata }) {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deseq2-mf-e2e-'));
  try {
    fs.writeFileSync(path.join(jobDir, 'counts.csv'), COUNTS_CSV);
    fs.writeFileSync(path.join(jobDir, 'coldata.csv'), coldata);
    fs.writeFileSync(path.join(jobDir, 'params.json'), JSON.stringify(params));
    fs.copyFileSync(THEME_R, path.join(jobDir, '_petri-theme.R'));
    const run = spawnSync(resolveRscriptBin(), [DESEQ2_R, jobDir], {
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { status: run.status, stdout: run.stdout || '', stderr: run.stderr || '' };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// desktop 侧 mock 级：planScientificTask 校验链（fixture 与既有 planner 测试同型）
// ---------------------------------------------------------------------------

const PLUGINS = [
  { id: 'sample-metadata-validator', title: '样本元数据校验', category: 'bulk RNA-seq', version: '1.0.0', entryPoint: 'scripts/sample-metadata-validator.R', inputs: [{ id: 'counts' }, { id: 'metadata' }] },
  { id: 'deseq2', title: '差异表达分析', category: 'bulk RNA-seq', version: '1.0.0', entryPoint: 'scripts/deseq2.R', inputs: [{ id: 'counts' }, { id: 'metadata' }] },
];

const MULTI_FACTOR_EVIDENCE = [
  { relativePath: 'data/counts.csv', sha256: 'a'.repeat(64), kind: 'csv', headers: ['gene', 'S1', 'S2'], rows: 100, columns: 3 },
  { relativePath: 'data/metadata.csv', sha256: 'b'.repeat(64), kind: 'csv', headers: ['sample', 'batch', 'condition'], rows: 6, columns: 3 },
];

// design 契约位置 = scientific-task-spec.js 既有词汇：groups + covariates
function multiFactorSpec(overrides = {}) {
  return {
    taskId: 'task_d3_mf',
    projectId: 'project_d3',
    conversationId: 'conv_d3',
    originalRequest: '校正 batch 效应后比较处理组与对照组的差异表达。',
    question: { domain: 'bulk RNA-seq', analysisUnit: 'gene', questionType: 'differential_expression' },
    method: { category: 'bulk RNA-seq' },
    design: { groups: ['condition'], covariates: ['batch'], contrast: { ref: 'Control', treat: 'Treatment' } },
    inputs: [
      { role: 'counts', relativePath: 'data/counts.csv' },
      { role: 'metadata', relativePath: 'data/metadata.csv' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ① 多因子 design 接受契约（现状 = 红）
// ---------------------------------------------------------------------------

test('D3① desktop 校验链：taskSpec.design 声明 covariates+groups 时 coldataBinding 必须携带 designFormula/designTerms，不得静默收窄为单列', (_t) => {
  const result = planScientificTask({ taskSpec: multiFactorSpec(), evidence: MULTI_FACTOR_EVIDENCE, plugins: PLUGINS });
  // 现状注记：计划整体 READY，design 意图被静默丢弃、coldataBinding 只绑关键词单列——误收窄发生得无声
  assert.equal(result.status, STATUS.READY);
  assert.equal(result.coldataBinding.designFormula, '~ batch + condition');
  assert.deepEqual(result.coldataBinding.designTerms, ['batch', 'condition']);
});

test('D3① R choke point：design 公式 "~ batch + condition" 必须解析为因子项 ["batch","condition"]（单列收窄旧形态已废弃）', (t) => {
  if (!requireREnvironment(t)) return;
  const terms = runDesignFunctionCases(t);
  assert.deepEqual(terms.multi, ['batch', 'condition']);
});

test('D3① e2e：design "~ batch + condition"（batch/condition 列齐备）全链必须跑通（误拆单列拒绝旧形态已废弃）', (t) => {
  if (!requireREnvironment(t)) return;
  const run = runDeseq2Fixture(t, {
    params: { design: '~ batch + condition', contrast_ref: 'Control', contrast_treat: 'Treatment' },
    coldata: COLDATA_MULTI,
  });
  assert.equal(run.status, 0, `多因子 design 应全链跑通，实际 exit=${run.status}\nstderr: ${run.stderr.slice(0, 2000)}`);
  assert.match(run.stdout, /Preflight passed/);
  assert.doesNotMatch(run.stderr, /不存在于 coldata/);
});

// ---------------------------------------------------------------------------
// ② 防呆 fail-closed 锚（转绿后必须保持）
// ---------------------------------------------------------------------------

test('D3② R choke point 防呆锚：单因子 "~ condition" 保持解析为 ["condition"]', (t) => {
  if (!requireREnvironment(t)) return;
  const terms = runDesignFunctionCases(t);
  assert.deepEqual(terms.single, ['condition']);
});

test('D3② R choke point 防呆锚：design 空串/缺失回退 "condition"', (t) => {
  if (!requireREnvironment(t)) return;
  const terms = runDesignFunctionCases(t);
  assert.deepEqual(terms.empty, ['condition']);
  assert.deepEqual(terms.null, ['condition']);
});

test('D3② e2e 锚（缺 ~）："batch + condition" 必须 fail-closed（exit≠0，deseq2 主动拦截而非崩溃）', (t) => {
  if (!requireREnvironment(t)) return;
  const run = runDeseq2Fixture(t, {
    params: { design: 'batch + condition', contrast_ref: 'Control', contrast_treat: 'Treatment' },
    coldata: COLDATA_MULTI,
  });
  assert.notEqual(run.status, 0, '缺 ~ 的公式必须被拒绝，不得静默跑通');
  assert.match(run.stderr, /\[deseq2\]/, '必须是 deseq2 主动拦截（带 [deseq2] 前缀的可操作报错），不是未捕获崩溃');
});

test('D3② e2e 锚（未知列）："~ tumor_stage" 必须 fail-closed（exit≠0，报列不存在）', (t) => {
  if (!requireREnvironment(t)) return;
  const run = runDeseq2Fixture(t, {
    params: { design: '~ tumor_stage', contrast_ref: 'Control', contrast_treat: 'Treatment' },
    coldata: COLDATA_MULTI,
  });
  assert.notEqual(run.status, 0, '未知列必须被拒绝');
  assert.match(run.stderr, /不存在/, '必须报出列不存在（可操作提示）');
});

test('D3② e2e 锚（数字列名）："~ 2024"（coldata 含字面 "2024" 列）必须 fail-closed（exit≠0）', (t) => {
  if (!requireREnvironment(t)) return;
  const run = runDeseq2Fixture(t, {
    params: { design: '~ 2024', contrast_ref: 'a', contrast_treat: 'b' },
    coldata: COLDATA_NUMERIC,
  });
  assert.notEqual(run.status, 0, '数字列名是非法公式符号，必须 fail-closed，不得产出结果');
});
