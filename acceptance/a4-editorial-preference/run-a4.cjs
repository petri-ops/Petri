#!/usr/bin/env node
// A4 直接执行器：只 require 本 flow（绕开 run.cjs 加载 138 个 flow 时 BLOCK-463
// 顶层副作用抢占 9223 的既有 infra 缺陷），用 lib.createRun 生成同构证据 JSON。
// 不修改 dev-verify runner；A4 收口后把该缺陷作为独立候选上报，不在本包修。
const path = require('node:path');
const lib = require('../../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');
const flow = require('../../.agents/skills/petri-dev-infra/dev-verify/flows/a4-editorial-preference.cjs');

(async () => {
  const round = process.env.A4_ROUND || 'round1';
  const run = lib.createRun({ name: flow.id, evidenceDir: path.join(__dirname, round) });
  let ok = false;
  try {
    ok = (await flow.run({ assert: run.assert })) !== false;
  } catch (e) {
    run.assert('flow_completed_without_exception', false, e.message);
  }
  const payload = await run.finish();
  process.exit(payload.allPass && ok ? 0 : 1);
})();
