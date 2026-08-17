# BLOCK-9.2 PHASE 5 — useSkillStore.ts 评估决议（不拆）

> **决策日期**：2026-08-17
> **决策者**：主 agent（基于 PHASE 0 调研 + Senior Engineer Review §2.4 + AGENTS.md G0 阶段纪律）
> **依据**：`docs/block-9-2-mega-file-split-survey.md` §1.5.7「不建议拆分的原因」+ `docs/senior-engineer-review-2026-08-16.md` §2.4 useSkillStore 部分

---

## TL;DR

**`frontend/src/hooks/useSkillStore.ts` 743 行 → DECISION：保留不拆。**

PHASE 5 仅作为审计 + 决策登记阶段落地，**无任何代码变更**。

---

## 1. 现状详情（2026-08-17 调研）

`wc -l frontend/src/hooks/useSkillStore.ts` → **743 行**

实际结构（顶层统计）：

| 类别 | 数量 | 行号参考 |
|------|-----:|----------|
| export type alias | 2 | L26 `ParameterType` / L108 `ExecutionStatus` |
| export interface | 7 | L29 `ParameterSchema` / L42 `OutputArtifact` / L54 `SkillSource` / L57 `Skill` / L111 `SkillExecution` / L136 `SkillStoreSnapshot` / L359 `UseSkillStoreResult` |
| private interface | 2 | L122 `DiscoverResult` / L129 `ExecuteResult` |
| type helper | 2 | L286 `SkillsBridge` / L287 `SkillsProgressPayload` |
| export const | 1 | L146 `CACHE_TTL_MS` |
| module-level `let` state | 4 | `_cache` / `_inflightDiscover` / `_subscribers` / `_lastCheckpointCount` |
| module-level `const` Map / Set | 3 | L155 `_subscribers` Set / L283 `_progressUnsubs` Map / `_pollingIntervals` Map (inside `_startPolling`) |
| export function | 3 | L405 `useSkillStore` 主 hook / L733 `__getProgressUnsubsSize` test helper / L737 `__resetSkillStoreCacheForTests` test helper |
| internal function (non-export) | 11 | `_notify` / `_isCacheStale` / `_startPolling` / `_stopAllPolling` / `_subscribeProgressWakeup` / `_executionsChanged` / `_unsubscribeProgressWakeup` / `_stopAllProgressWakeups` / `_discoverSkills` / `_executeSkill` / `_cancelExecution` |
| 主 hook 内 useState / useEffect / useCallback | 7 / 5 / 6 | L405-732 |

> 详见 survey §1.5 — 与 PHASE 0 调研时刻相比，BLOCK-2/3/4/5 期间 `useSkillStore.ts` 增大了 ~200 行（新增了 progress wakeup、cancel 路径、5 状态映射等），但结构（5 singleton + 4 Map）未变化。

---

## 2. 不拆的核心理由

### 2.1 Singleton store 反模式深度依赖 module-level 状态（关键风险）

`useSkillStore.ts` 是经典的 **「Zustand-without-zustand」** 模式：

- **5 个 module-level 状态共享点**：`_cache` / `_inflightDiscover` / `_subscribers` Set / `_pollingIntervals` Map / `_progressUnsubs` Map / `_lastCheckpointCount` Map
- **3 组 module-level 状态修改者**：`_notify()` / `_isCacheStale()` / `_startPolling()` / `_stopAllPolling()` / `_subscribeProgressWakeup()` / `_unsubscribeProgressWakeup()`
- **8 个 module-level 状态读取者**：所有内部 helper + 主 hook 内所有 `useEffect` 回调

**拆分代价**：必须把这些 module-level state 提到 ESM export + barrel re-export，引入跨文件 import 链。**这与 singleton 语义等价**（同一进程同一 module 实例），但**增加耦合复杂度 + 包大小 + tree-shaking 失败**（所有 export 都被引用时无法摇树）。

### 2.2 阻塞型 polling + 事件订阅双向耦合

- `_subscribeProgressWakeup` 与 `_startPolling` 通过 `Map<executionId, ...>` 同步追踪同一组 executionId
- 终态清理逻辑在 polling 和 wakeup 两侧重复（BLOCK-4 G5 + A1 + A2 修过）
- 拆到不同文件后，必须用「模块间传 executionId 集合」参数传递，但 `Map.entries()` 的迭代时机难以保证跨文件 atomic
- 现有 14 个 vitest `useSkillStore.test.ts` 覆盖了所有 module-level 状态边界——重构会重新设置跨文件 mock

### 2.3 测试基础设施已稳定（vitest 14 测试）

- `__getProgressUnsubsSize` / `__resetSkillStoreCacheForTests` 已是 test-only export（BLOCK-4 PHASE 2 G5 添加）
- 14 个 vitest 测试覆盖了所有 module-level state 边界
- BLOCK-2/3/4/5 期间的 22 次 `_progressUnsubs`、`_pollingIntervals`、`_lastCheckpointCount` 真值模拟全部通过

### 2.4 实际收益有限（量级判断）

- 743 行已是最小（与 SimpleChat 2153 / ResultView 1654 / plugin-manager 1457 / DesktopSettingsPanel 1515 比）
- 主要压力是「功能闭环」（discover/execute/progress/cancel 全链路）而非「文件过大」
- 「文件过大」的合理阈值在团队习惯中为 1500 行；本文件远低于阈值

### 2.5 G0 阶段纪律（不容外推）

按 `AGENTS.md` G0 长期开发期纪律：

> **不得**主动启动 G1+ 阶段事项，**不外推**功能改进型重构

- 当前阶段应聚焦交付（Skills 页面 P1/W-04 实装 + UI-157 verified 升级路径）
- `useSkillStore.ts` 的「重构为更现代 store」属于功能改进型（如果不是测试驱动、不是性能瓶颈、不阻塞 release）
- 启动拆 useSkillStore 工作包需要新立 BLOCK-9.5 / BLOCK-9.6+ 单独评估 + 用户显式裁决

---

## 3. 关键观察 / 后续建议

| 类别 | 观察 | 后续行为 |
|------|------|----------|
| 功能压力 | 模块级 cache + polling + wakeup 三件套本身设计**已在 BLOCK-2/3/4/5 期间加固**：sender 守门 / 9→4 状态映射 / 终态清理 / poller 停止 / wakeup 并行 polling | **不再动**这块的设计层面，专注交付 |
| 测试覆盖 | 14 个 vitest 测试已是最小足够集 | **新增测试需符合当前 743 行结构**（不预设拆分后结构） |
| 文件大小 | 743 行距团队「1500 行阈值」还差 757 行空间 | 未来如果真增长到 1300+ 行，再启动 BLOCK-9.5+ 单独工作包 |
| AGENTS.md 红线 | G0 阶段纪律禁止主动建议 G1+ 阶段事项 | 此决议作为 G0 边界内的**最终决策**，未来 BLOCK-9.5+ 启动需用户显式裁决 |

---

## 4. 决议对照（与 PHASE 0 调研一致）

PHASE 0 调研 §1.5.7 给出的关键判断：

> **结论**：PHASE 5 评估后建议**保留 useSkillStore.ts 不拆**，只在 `docs/ui-productization-audit.md` 登记一条 "已调研不建议拆（singleton 状态 + 阻塞型 polling）"。如果未来真有 1000+ 行增长压力，再启动 BLOCK-9.6+ 单独工作包。

✅ 本决议**与 PHASE 0 一致**：不拆 + 登记 + 未来真增长再启新工作包。

---

## 5. 不变量

- `useSkillStore.ts` 743 行 100% 保持不变（**0 行 diff**）
- 14 个 vitest 测试 `useSkillStore.test.ts` 0 改动
- 6 个消费者（`pages/skills/{index,SkillCard,SkillDetail,SkillSearch}` + `useSkillStore.test.ts` + `skill.types.ts`）契约路径 0 改动
- `useSkillStore.test.ts` 仍是 `BLOCK-2-UI-157-REVIEW` + `BLOCK-3-IPC-BRIDGE-HARDENING` + `BLOCK-4-IPC-BRIDGE-POLISH` 累计 14 个测试 **1:1 不变**

---

## 6. 与 BLOCK-9.2 整体的关系

PHASE 5 决策落地后，BLOCK-9.2 5 文件拆分状态：

| 文件 | 拆分结果 | 行数变化 | commit |
|------|---------|---------|--------|
| `src/plugin-manager.js` | ✅ PHASE 3 拆分 | 1457 → 586 (-871 / -59.7%) | `49652f3` (UI-172) |
| `frontend/src/components/desktop/DesktopSettingsPanel.tsx` | ✅ PHASE 1 拆分 | 1515 → 870 (-645 / -42.6%) | `d06b66e` (UI-170) |
| `frontend/src/components/workspace-panels/ResultView.tsx` | ✅ PHASE 2 拆分 | 1654 → 1553 (-101 / -6.1%) | `014ad0d` (UI-171) |
| `frontend/src/components/copilot/SimpleChat.tsx` | ✅ PHASE 4 拆分 | 2153 → 1975 (-178 / -8.3%) | `e599ee0` (UI-173) |
| `frontend/src/hooks/useSkillStore.ts` | ⏸ PHASE 5 **保留不拆** | 743 → 743 (0 diff) | **PHASE 5 决议文档** (UI-174) |

**整体 5 文件 -1795 行 / 16 个新模块 / 21 module.exports 100% / 7 个测试文件 0 改动**。

---

## 7. 下一步

**PHASE 6 — audit + closeout**：

1. 同步 4 canonical 文档（`docs/AUDIT-LOG.md` / `docs/README.md` / `docs/next-steps-roadmap.md` / `docs/project-workspace-handoff.md`）
2. 同步 `docs/DOC-REGISTRY.json` — `BLOCK-9.2-MEGA-FILE-REFACTOR` `active → completed` + 7 `linkedCommits` + 新增 `BLOCK-9.2-CLOSEOUT` reference entry
3. 写 closeout 报告 `docs/block-9-2-mega-file-refactor-closeout.md`
4. `npm run docs:check` + `npm run ui:audit:check` + `npm run tsc --noEmit` + `npm run docs:reconcile` 4 治理门全 GREEN
5. AUDIT-LOG.md 写入 PHASE 6 closeout 条目

严格维持 `qualificationEligible: false` G0 阶段纪律，不外推 packaged / Provider / GA / P7 / notarization / dist staleness G1+。
