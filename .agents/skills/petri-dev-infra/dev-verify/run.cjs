#!/usr/bin/env node
'use strict';

/**
 * .agents/skills/petri-dev-infra/dev-verify/run.cjs — `npm run verify -- <flowId>`：实机校验 flow 注册表（BLOCK-71）
 *
 * canonical 家在 petri-dev-infra skill 内。flow = 本目录 flows/*.cjs，
 * 导出 { id, description, evidenceDir, run(ctx) }。
 * ctx = { assert(name, pass, detail), timeoutMs }；flow 返回后 runner 调 finish()
 * 落盘证据 JSON（acceptance/<flow.evidenceDir 或 flow 声明的绝对目录>/<id>-live.json）
 * 并按 allPass 决定退出码（0/1）。
 *
 * 用法：
 *   npm run verify -- --list        列出已注册 flow
 *   npm run verify -- app-health    运行指定 flow
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('./lib.cjs');

const ROOT = lib.findRepoRoot(__dirname) || process.cwd();
const FLOWS_DIR = path.join(__dirname, 'flows');

function loadFlows() {
  if (!fs.existsSync(FLOWS_DIR)) return [];
  return fs.readdirSync(FLOWS_DIR)
    .filter((f) => f.endsWith('.cjs') && f !== '_template.cjs')
    .map((f) => {
      const mod = require(path.join(FLOWS_DIR, f));
      return { file: f, ...mod };
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

async function main(argv) {
  argv = argv || process.argv.slice(2);
  const flows = loadFlows();

  if (!argv.length || argv.includes('--list') || argv.includes('-l')) {
    console.log('已注册 dev-verify flows:');
    for (const f of flows) console.log(`  ${f.id.padEnd(20)} ${f.description || ''}`);
    if (!flows.length) console.log('  （空）');
    console.log('\n用法: npm run verify -- <flowId>');
    process.exit(0);
  }

  const flowId = argv[0];
  const flow = flows.find((f) => f.id === flowId);
  if (!flow) {
    console.error(`未注册的 flow: ${flowId}（npm run verify -- --list 查看清单）`);
    process.exit(2);
  }

  const evidenceDir = flow.evidenceDir || path.join(ROOT, 'acceptance', 'dev-verify');
  const run = lib.createRun({ name: flow.id, evidenceDir });
  let ok = false;
  try {
    ok = (await flow.run({ assert: run.assert, timeoutMs: Number(process.env.DEV_VERIFY_TIMEOUT_MS) || undefined })) !== false;
  } catch (e) {
    run.assert('flow_completed_without_exception', false, e.message);
  }
  const payload = await run.finish();
  if (!ok && payload.allPass) {
    // flow 显式返回 false（如「无可测目标」）时不允许被记成全绿
    console.error('[dev-verify] flow 返回 false 但断言全过——按失败处理（诚实优先）');
    process.exit(1);
  }
  process.exit(payload.allPass ? 0 : 1);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[dev-verify] fatal: ${e.message}`);
    process.exit(2);
  });
}

module.exports = { loadFlows };
