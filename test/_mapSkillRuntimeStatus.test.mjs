/**
 * BLOCK-3 PHASE 2 G6: main.js 9→4 状态映射单测
 *
 * 验证 `_mapSkillRuntimeStatus` 将 SkillRuntime 的 9 状态枚举 + 未知默认值
 * 正确映射到 useSkillStore / electron.d.ts 声明的 4 状态：
 *   pending (created / validating_params / checking_dependencies)
 *   running (running / paused / recovering)
 *   completed (complete)
 *   failed (failed / cancelled)
 *   running (default fallback)
 *
 * 加载源：src/_mapSkillRuntimeStatus.js（PHASE 2 G6 提取的独立模块，避免
 * 直接 require main.js 因为 main.js 在 module-eval 阶段读 app.isPackaged）。
 *
 * 运行：node --test test/_mapSkillRuntimeStatus.test.mjs
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { _mapSkillRuntimeStatus } = require("../src/_mapSkillRuntimeStatus.js");

// ── pending 状态族：created / validating_params / checking_dependencies ──

test("G6: 'created' maps to 'pending'", () => {
  assert.equal(_mapSkillRuntimeStatus("created"), "pending");
});

test("G6: 'validating_params' maps to 'pending'", () => {
  assert.equal(_mapSkillRuntimeStatus("validating_params"), "pending");
});

test("G6: 'checking_dependencies' maps to 'pending'", () => {
  assert.equal(_mapSkillRuntimeStatus("checking_dependencies"), "pending");
});

// ── running 状态族：running / paused / recovering ──

test("G6: 'running' maps to 'running'", () => {
  assert.equal(_mapSkillRuntimeStatus("running"), "running");
});

test("G6: 'paused' maps to 'running'", () => {
  assert.equal(_mapSkillRuntimeStatus("paused"), "running");
});

test("G6: 'recovering' maps to 'running'", () => {
  assert.equal(_mapSkillRuntimeStatus("recovering"), "running");
});

// ── completed 状态：complete ──

test("G6: 'complete' maps to 'completed'", () => {
  assert.equal(_mapSkillRuntimeStatus("complete"), "completed");
});

// ── failed 状态族：failed / cancelled（cancelled 简化为 failed 终止态） ──

test("G6: 'failed' maps to 'failed'", () => {
  assert.equal(_mapSkillRuntimeStatus("failed"), "failed");
});

test("G6: 'cancelled' maps to 'failed' (PHASE 1 简化规则)", () => {
  assert.equal(_mapSkillRuntimeStatus("cancelled"), "failed");
});

// ── default fallback：未知状态走 'failed'（BLOCK-4 B3 修复，更保守） ──

test("G6: unknown status falls back to 'failed' (BLOCK-4 B3)", () => {
  assert.equal(_mapSkillRuntimeStatus("some_future_state"), "failed");
});

test("G6: empty string falls back to 'failed' (BLOCK-4 B3)", () => {
  assert.equal(_mapSkillRuntimeStatus(""), "failed");
});

test("G6: null falls back to 'failed' (BLOCK-4 B3)", () => {
  assert.equal(_mapSkillRuntimeStatus(null), "failed");
});

test("G6: undefined falls back to 'failed' (BLOCK-4 B3)", () => {
  assert.equal(_mapSkillRuntimeStatus(undefined), "failed");
});

// ── 全 9 状态枚举覆盖 + 1 default（共 10 断言，PHASE 2 G6 验收要求） ──

test("G6: 9-state enumeration + default fallback produces expected 4 states (full sweep)", () => {
  const NINE_RUNTIME_STATES = [
    "created",
    "validating_params",
    "checking_dependencies",
    "running",
    "paused",
    "recovering",
    "complete",
    "failed",
    "cancelled",
  ];
  const expected = {
    pending: ["created", "validating_params", "checking_dependencies"],
    running: ["running", "paused", "recovering"],
    completed: ["complete"],
    failed: ["failed", "cancelled"],
  };
  for (const state of NINE_RUNTIME_STATES) {
    const mapped = _mapSkillRuntimeStatus(state);
    const owning = Object.entries(expected).find(([_, group]) => group.includes(state));
    assert.ok(owning, `state '${state}' should belong to one of the 4 buckets`);
    assert.equal(
      mapped,
      owning[0],
      `state '${state}' should map to '${owning[0]}' but got '${mapped}'`,
    );
  }
  // Total: 9 runtime states accounted for
  assert.equal(
    NINE_RUNTIME_STATES.length,
    9,
    "G6 enumeration must cover exactly 9 SkillRuntime states",
  );
});
