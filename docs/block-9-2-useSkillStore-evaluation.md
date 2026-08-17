# BLOCK-9.2 PHASE 5 — `useSkillStore.ts` 评估决议（不拆）

> **决策日期**：2026-08-18
> **决策者**：主 agent（基于 PHASE 0 调研 + Senior Engineer Review §2.4 + AGENTS.md G0 阶段纪律）
> **依据**：
> - `docs/block-9-2-mega-file-split-survey.md` §1.5.7「不建议拆分的原因」
> - `docs/senior-engineer-review-2026-08-16.md` §2.4 useSkillStore 部分
> - PHASE 4 第二轮 `useChatStream` hook 反向佐证（同为强耦合但能拆）

**关联**：UI-179 `not_applicable` ledger row · `docs/ui-productization-audit.md` §table

---

## 1. TL;DR

**`frontend/src/hooks/useSkillStore.ts` 743 行 → DECISION：保留不拆。**

PHASE 5 仅作为审计 + 决策登记阶段落地，**无任何代码变更**。本决议文件取代早期的 `docs/block-9-2-phase-5-useSkillStore-decision.md` 旧版（仅 commit `810390f` 落定的 PHASE 5 决议），补入 PHASE 4 第二轮 `useChatStream` 反向佐证 + UI-179 评估 entry。

---

## 2. 现状简述（2026-08-18 复测）

`wc -l frontend/src/hooks/useSkillStore.ts` → **743 行**

实际结构（顶层统计）：

| 类别 | 数量 | 行号参考 |
|------|-----:|----------|
| export type alias | 2 | L26 `ParameterType` / L36 `ParameterSchema` |
| export interface | 7 | L43 `OutputArtifact` / L54 `SkillSource` / L57 `Skill` |
| private interface | 2 | L120 `DiscoverResult` / L127 `ExecuteResult` |
| **module-level `const`** | 1 | L146 `CACHE_TTL_MS`（常量不算 singleton） |
| **module-level `let` state** | 2 | L148 `let _cache: SkillStoreSnapshot` / L154 `let _inflight: Promise<DiscoverResult> \| null` |
| **module-level `Set`** | 1 | L155 `const _subscribers = new Set<() => void>()` |
| **module-level `Map`** | 2 | L156 `let _pollIntervals: Map<string, ReturnType<typeof setInterval>>` / L283 `const _progressUnsubs: Map<string, () => void>` |
| 主 hook 内 useState / useEffect / useCallback | 多 | L421+ |

**总计 module-level 状态 = 5 singleton**（`_cache` + `_inflight` + `_subscribers` Set + `_pollIntervals` Map + `_progressUnsubs` Map），其中 1 个 Set + 2 个 Map 强耦合。

> 注：`docs/block-9-2-phase-5-useSkillStore-decision.md` 旧版（commit `810390f`）曾记为「5 singleton + 4 Map」，实际正确表述是「5 module-level state（含 1 Set + 2 Map）」 —— 本评估以 2026-08-18 复测为准。

---

## 3. 不拆的核心理由

### 3.1 Singleton store 反模式深度依赖 module-level 状态（关键风险）

`useSkillStore.ts` 是经典的 **「Zustand-without-zustand」** 模式 —— 主 hook 没有真正使用 Zustand，而是手写 module-level singleton + subscriber + poll 机制：

- **5 个 module-level 状态共享点**：`_cache` / `_inflight` / `_subscribers` Set / `_pollIntervals` Map / `_progressUnsubs` Map
- **3+ 组 module-level 状态修改者**：`_notify()` / `_isCacheStale()` / `_startPolling()` / `_stopAllPolling()` / `_subscribeProgressWakeup()` / `_unsubscribeProgressWakeup()`
- **8+ 个 module-level 状态读取者**：所有内部 helper + 主 hook 内所有 `useEffect` 回调

**拆分代价**：必须把这些 module-level state 提到 ESM export + barrel re-export，引入跨文件 import 链。**这与 singleton 语义等价**（同一进程同一 module 实例），但**增加耦合复杂度 + 包大小 + tree-shaking 失败**（所有 export 都被引用时无法摇树）。

### 3.2 阻塞型 polling + 事件订阅双向耦合

- `_subscribeProgressWakeup` 与 `_startPolling` 通过 `Map<executionId, ...>` 同步追踪同一组 executionId
- 终态清理逻辑在 polling 和 wakeup 两侧重复（BLOCK-4 G5 + A1 + A2 修过）
- 拆到不同文件后，必须用「模块间传 executionId 集合」参数传递，但 `Map.entries()` 的迭代时机难以保证跨文件 atomic
- 现有 14 个 vitest `useSkillStore.test.ts` 覆盖了所有 module-level 状态边界——重构会重新设置跨文件 mock

### 3.3 测试基础设施已稳定（vitest 14 测试）

- `__getProgressUnsubsSize` / `__resetSkillStoreCacheForTests` 已是 test-only export（BLOCK-4 PHASE 2 G5 添加）
- 14 个 vitest 测试覆盖了所有 module-level state 边界
- BLOCK-2/3/4/5 期间的 22 次 `_progressUnsubs`、`_pollIntervals`、`_lastCheckpointCount` 真值模拟全部通过

### 3.4 实际收益有限（量级判断）

- 743 行已是最小（与 SimpleChat 2277 / ResultView 1654 / plugin-manager 1457 / DesktopSettingsPanel 1515 比）
- 主要压力是「功能闭环」（discover/execute/progress/cancel 全链路）而非「文件过大」
- 「文件过大」的合理阈值在团队习惯中为 1500 行；本文件远低于阈值（**还差 757 行空间**）

### 3.5 G0 阶段纪律（不容外推）

按 `AGENTS.md` G0 长期开发期纪律：

> **不得**主动启动 G1+ 阶段事项，**不外推**功能改进型重构

- 当前阶段应聚焦交付（Skills 页面 P1/W-04 实装 + UI-157 verified 升级路径）
- `useSkillStore.ts` 的「重构为更现代 store」属于功能改进型（如果不是测试驱动、不是性能瓶颈、不阻塞 release）
- 启动拆 useSkillStore 工作包需要新立 BLOCK-9.5+ 单独评估 + 用户显式裁决

---

## 4. 反向佐证：PHASE 4 第二轮 `useChatStream` hook 成功抽出（同样强耦合但因是 hook 不是 store 所以能拆）

### 4.1 强耦合度对比

PHASE 4 第二轮 commit `1a58f2c` 抽出 5 个 stream-related callback 到 `frontend/src/components/copilot/SimpleChat/hooks/useChatStream.ts` 322 行。该 hook 也是强耦合：

| 维度 | `useSkillStore.ts` | `useChatStream.ts` |
|------|----|----|
| 内部状态点数 | 5 module-level（singleton） | 0 module-level（state 全部 `useState`） |
| Set 数 | 1 (`_subscribers`) | 0 |
| Map 数 | 2 (`_pollIntervals` / `_progressUnsubs`) | 1 (`sendRef` —— 仅为稳定回调句柄) |
| IPC 订阅数 | 通过 window.biof3Desktop.skills.*（全局） | `subscribeBioF3Event(biof3Events.copilotAsk)` 1 个 |
| Callback 数 | 多 useCallback | 5 useCallback |
| 单实例还是多实例 | **singleton**（全进程 1 个 module-level cache） | **多实例**（每次组件 useChatStream 调用 → 1 个 hook instance） |

### 4.2 为什么 useChatStream 能拆 / useSkillStore 不能拆？

1. **instance 语义**：useChatStream 是 React custom hook，每次调用产生 1 个 hook instance，state 都是 `useState` 局部 —— 可搬移到文件不破坏语义。useSkillStore.ts 的「useSkillStore 主 hook」虽然是 React hook（每次调用产生新 instance），**但 module-level 状态是跨 instance 共享的 singleton**，搬到不同文件后这些 state 仍然是 ESM module-level，但跨文件 import 会**破坏 ESM tree-shaking + 引入跨文件查找开销**。

2. **callback 与 module state 的解耦**：useChatStream 抽出的 5 个 callback（`send` / `stop` / `regenerate` / `queue` / `runInBackground`）**全部依赖 props + setState**，不依赖 module-level state。useSkillStore.ts 的 callback（`_notify` / `_isCacheStale` / `_startPolling` / `_stopAllPolling` / `_subscribeProgressWakeup`）**全部依赖 module-level state**，搬到文件后依然依赖 → 反而变成「跨文件调用 module state」的脆弱组合。

3. **测试 mock 的颗粒度**：useChatStream hook 测试可以 mock props + setState，跨文件调用无副作用。useSkillStore 必须 mock module-level state（`_cache` / `_inflight` / `_subscribers`），这些 mock 在 vitest 4 个 fixture 中通过 `vi.resetModules()` + `__resetSkillStoreCacheForTests` 完成 —— 跨文件后 mock 复杂度会指数级上升。

4. **React 行为契约**：useChatStream 是 React 内部的 hook，单次 render 调用 12 个固定顺序 hook 完全 ok（hooks-of-rules 满足）。useSkillStore 模块顶层副作用（如 `subscribeBioF3Event` 全局订阅）跨文件后**导入顺序敏感**，多 entrypoint 重复实例化会破坏预期。

### 4.3 结论

useChatStream 形似 useSkillStore（都是强耦合），神异在 **hook instance vs module-level singleton**。useChatStream 能拆 → 不能简单外推 useSkillStore 也能拆。

---

## 5. 决议对照（与 PHASE 0 调研一致）

PHASE 0 调研 §1.5.7 给出的关键判断：

> **结论**：PHASE 5 评估后建议**保留 useSkillStore.ts 不拆**，只在 `docs/ui-productization-audit.md` 登记一条「已调研不建议拆（singleton 状态 + 阻塞型 polling）」。如果未来真有 1000+ 行增长压力，再启动 BLOCK-9.6+ 单独工作包。

✅ 本决议**与 PHASE 0 一致**：不拆 + 登记 + 未来真增长再启新工作包。

---

## 6. 结论：UI-179 `not_applicable`

**`useSkillStore.ts` 743 行已是最小 + 5 module-level state（2 let + 1 Set + 2 Map）强耦合已构成"不拆"阈值 → UI-179 `not_applicable`。**

未来扩展路径：
- 如 `useSkillStore.ts` 真增长到 1300+ 行 → 再启动 BLOCK-9.5-MEGA-STORE-REFACTOR 单独工作包
- 按当前 G0 阶段纪律需用户显式裁决
- 不在当前 active 候选清单内

---

## 7. 不变量 + 后续

### 7.1 不变量守住（本评估不引入任何代码变更）

- `useSkillStore.ts` 743 行 100% 保持不变（**0 行 diff**）
- 14 个 vitest 测试 `useSkillStore.test.ts` 0 改动
- 6 个消费者（`pages/skills/{index,SkillCard,SkillDetail,SkillSearch}` + `useSkillStore.test.ts` + `skill.types.ts`）契约路径 0 改动
- `useSkillStore.test.ts` 仍是 `BLOCK-2-UI-157-REVIEW` + `BLOCK-3-IPC-BRIDGE-HARDENING` + `BLOCK-4-IPC-BRIDGE-POLISH` 累计 14 个测试 **1:1 不变**

### 7.2 不外推（Phase 5 边界严守 G0 阶段纪律）

- 不外推：**packaged / Provider / GA / P7 / notarization / dist staleness / E1-d/E1-e G1+**（AGENTS.md 红线）
- 不重新激活：**BLOCK-9 / 9.1 / 8 / 7 / 6 / 5 / 4 / 3 / 2**（已 closed 工作包均不重启）
- 不外推 UI-157/158/159 实机验证（按 audit 行 402 治理纪律仍缺实机证据）
- 不动：**agent-tools/*** + **agent-transcripts/***（治理边界外）
- 不变更 npm 依赖（0 新增 / 0 删除）

### 7.3 后续：PHASE 6 综合 closeout

启动 BLOCK-9.2 PHASE 6 audit + closeout：
- 4 canonical 文档同步（`docs/ui-productization-audit.md` / `docs/DOC-REGISTRY.json` / `docs/next-steps-roadmap.md` / `docs/project-workspace-handoff.md`）
- closeout 报告 `docs/block-9-2-mega-file-refactor-closeout.md` 11 节
- 4 治理门必须 GREEN（`docs:check` / `ui:audit:check` / `tsc --noEmit` / `docs:reconcile`）
- AUDIT-LOG 条目登记
- 严格维持 `qualificationEligible: false` G0 阶段纪律，不外推 packaged / Provider / GA / P7 / notarization / dist staleness G1+
