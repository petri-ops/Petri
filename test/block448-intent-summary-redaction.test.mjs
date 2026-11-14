'use strict';

/**
 * BLOCK-448 — 公开投影脱敏门禁（P6 `publicProjectionClean` 断言的根修）。
 *
 * 现象（2026-11-14 实测）：P6 恢复腿 driver 的 `publicProjectionAudit.rawInternalId`
 * 恒为 true，`publicProjectionHits` 三次命中同一 `job_…`，所在元素是「Result Studio
 * 版本与变更」面板。追到源头：`ContinueAnalysisMenu` 生成的指令文本带 jobId（发给
 * Agent 是必需的），该文本作为 `intent.requestedOutcome` 落进 change set，再经
 * `result-changeset-service` 投影为 `validationSummary.intentSummary` 回显到面板。
 *
 * 修法：公开投影处脱敏（单源 `redactInternalIds`），不改 Agent 指令原文、不动存储。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { redactInternalIds, INTERNAL_ID_VALUE } = require(
  path.join(ROOT, 'core/shared-backend/redaction.js'),
);

test('redactInternalIds 覆盖 P6 验收同源的内部 ID 族', () => {
  const cases = [
    '请基于任务 job_6d1a0db688474fb9 的结果 volcano.png 运行「火山图」分析：',
    '项目 p_mwg2oghc_jl85 的版本 rev_a1b2c3d4e5 需要复核',
    'change set cs_9f8e7d6c5b / 会话 conv_1234567 / 选择 sel_abcdefgh',
  ];
  for (const source of cases) {
    const redacted = redactInternalIds(source);
    assert.ok(!redacted.includes(INTERNAL_ID_VALUE) || redacted !== source, '命中必须被替换');
    assert.doesNotMatch(redacted, /\b(?:job|rev|cs|conv|sel)_[A-Za-z0-9._-]{6,}\b/, `${source} 仍残留内部 ID`);
  }
});

test('redactInternalIds 不误伤普通文本与短缩写', () => {
  const keep = [
    '原始分析结果',
    '第 p 值 < 0.05（p_1 说明）',
    '表格 table_1 与 tk_label 保留',
  ];
  for (const source of keep) {
    assert.equal(redactInternalIds(source), source, `${source} 不应被改写`);
  }
});

test('redactInternalIds 幂等且保留可读性', () => {
  const once = redactInternalIds('任务 job_abcdef123456 的结果');
  const twice = redactInternalIds(once);
  assert.equal(twice, once, '重复脱敏必须稳定');
  assert.match(once, /^任务 \[内部标识\] 的结果$/, '替换文案可读、非空');
});

test('change set 投影必须走脱敏（源码契约，防回退）', () => {
  const source = fs.readFileSync(path.join(ROOT, 'core/shared-backend/result-changeset-service.js'), 'utf8');
  assert.match(
    source,
    /intentSummary:\s*redactInternalIds\(input\.intent\.requestedOutcome\)/,
    'intentSummary 投影必须经 redactInternalIds（禁止裸 slice 原文）',
  );
  assert.match(
    source,
    /require\('\.\/redaction'\)/,
    'changeset service 必须从单源 redaction 模块取脱敏器',
  );
});
