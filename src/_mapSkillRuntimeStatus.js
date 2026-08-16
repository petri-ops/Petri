"use strict";
/**
 * SkillRuntime → 4-状态映射（独立模块便于单测）。
 *
 * SkillRuntime 内部是 9 状态枚举；前端 useSkillStore / electron.d.ts 通过
 * 4 状态 ("pending" | "running" | "completed" | "failed") 表达；本模块是
 * 单一真值源（single source of truth），main.js 与单测共享。
 *
 * 原始位置：`src/main.js` 顶层 `_mapSkillRuntimeStatus`（PHASE 1 落地）。
 * 提取原因：BLOCK-3 PHASE 2 G6 单测需要从 plain Node 加载，但 main.js 在
 * module-eval 阶段就读取 `app.isPackaged` 等 Electron-only 状态，无法被
 * `node --test` 干净地 require。
 *
 * 对应审计：BLOCK-3-IPC-BRIDGE-HARDENING 计划 §3 PHASE 2.9 / phase-6-code-audit G6。
 */

function _mapSkillRuntimeStatus(s) {
  // SkillRuntime 状态 → useSkillStore/electron.d.ts 声明的 4 态
  switch (s) {
    case "created":
    case "validating_params":
    case "checking_dependencies":
      return "pending";
    case "running":
    case "paused":
    case "recovering":
      return "running";
    case "complete":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "failed"; // 简化为 failed 终止态
    default:
      return "running";
  }
}

module.exports = { _mapSkillRuntimeStatus };
