---
capability: block477-filetree-repro-attribution
status: active
goal: C-47「文件树连翻页第二次点击惰性/回弹」的可复算复现与根因归因——沿 BLOCK-358 未竟路径，用纯函数状态机 + CDP 实机连续点击 + 2s 轮询收敛观测，把"观察未归因"推进到可判定的三态结论；归因成立才立修复票，不猜测性修复。
acceptance:
  - HK-01 红绿先行：状态机归因模块缺席时测试红，实现后契约绿（含负测/篡改锚定 fail-closed）。
  - 源码事实锚定：脚本从 RightFileTree.tsx 机械提取 loadMoreRoot 续拉 / refreshFiles offset=0 重置 / 本地 2s 轮询三处模式，逐项在场断言。
  - 状态机复算：给定 520 文件 + 已知点击/轮询时序，能确定性复现"加载后续页被轮询拉回第一页"的回弹与惰性机制。
  - CDP 实机腿：尽力在 9223 离屏实例重放连续点击 + 2s 轮询；可复现则落断言 JSON，环境不可得则 external-blocked 如实归因（合法终态）。
  - 三态结论落 acceptance：reproduced_and_attributed / observed_not_reproduced / environment_blocked，各带证据。
  - closeout 定向门禁绿；六件套回写；显式路径提交。
reopen: 修复实施（归因成立后的独立票，需用户发令）；G1+ 项；新依赖。
---

# BLOCK-477 — 文件树连翻页复现与归因（C-47）

> 状态：**active（2026-11-18 立项，用户发令「开始 C-47」）**

- 依据任务：`docs/pending-work-backlog.md` C-47 条目（「观察，未归因」，启动条件=人工复现归因后立票）
- 既有归因：`docs/block-358-filetree-pagination-plan.md` / `docs/block-358-report.md`（结论 `observed_but_not_reproduced`，票 kept-open）
- 阶段：**G0 开发期常态 · 不外推 packaged / Provider / GA**

## §1 立项依据

C-47 自 BLOCK-349 B3 观察（`200→200 / grew=false`）入池，BLOCK-358 用 headless 证据回放止于「未复现、未归因」，并明确**禁止猜测性修复**。本包补齐 358 缺失的两种手段：

1. **状态机确定性复算**：C-47 的可疑因果链是纯前端时序，可由源码语义确定性建模——`loadMoreRoot`（`RightFileTree.tsx:168-178`）从 `rootMore.done` 续拉并 `setTree(prev => [...prev, ...page.entries])`；本地项目 2s 轮询（`:268-270`）反复调用 `refreshFiles()`，后者以 `fetchDirPage('', 0)`（`:181`）**覆盖** `setTree(rootPage.entries)` 并把 `rootMore.done` 重置回第一页（`:183`）。加载第 2 页后 ≤2s 内树被拉回 200 → 与 B3「第二次点击惰性/回弹」一致。这是源码事实 + 状态机推演，非猜测。
2. **CDP 实机重放**：复用 `scripts/block349-bigdir-live.cjs` 模板，在 9223 离屏实例建 520 文件 fixture，连续点击「加载更多」并在 2s 轮询窗口前后采样行数/游标，拿实机断言；环境不可得按 §7 降级。

## §2 范围与阶段

- **P0 立项三件套**：plan + DOC-REGISTRY + AUDIT-LOG 启动行；HK-01 红测试先行。
- **P1 状态机归因模块**：`scripts/block477-filetree-repro.mjs` 纯函数（源码锚点提取 + 分页时序状态机 + 三态判定）+ `test/block477-filetree-repro.test.mjs` 契约测试（红→绿，含负测与篡改锚定）。
- **P2 CDP 实机腿**：`scripts/block477-filetree-live.cjs`，9223 离屏连续点击 + 轮询窗口采样；证据落 `acceptance/block477-filetree-attribution/`。
- **P3 结论与立项建议**：写 `docs/block477-filetree-attribution-report.md`，落三态结论；成立则登记修复票候选（C-47 标注「已归因，修复待发令」）并停下报用户。

## §3 非范围（红线）

- **不猜测性修复**：本包一行产品代码不改；`RightFileTree.tsx` / `files.js` 仅只读扫描，零写面。
- 不销 C-47 票、不改观感状态（pending_human_eye 零代签，本项属功能行为非观感）。
- 不新增产品依赖；不碰 untracked 用户资产（post-h9 / petri-logo / model3d / tmp-* 等）；不碰其他包在制 WIP。
- 不启动修复票实施（未获用户发令不进入后续阶段）；不做 G1+。

## §4 验收判据

- G1 契约测试红→绿 N/N（缺席红 + 实现绿 + 负测/篡改锚定判红）。
- G2 源码三处模式逐项在场（loadMoreRoot 续拉 / refreshFiles offset=0 覆盖 / 2s 轮询），任一缺失即 fail-closed 判红。
- G3 状态机给定 520 文件 + 点击/轮询时序，确定性产出回弹/惰性机制读数，可复算。
- G4 CDP 实机腿 allPass 或 external-blocked 明确归因（两者皆合法终态，不伪造）。
- G5 三态结论 + 报告落盘，`docs:check` / `ui:audit:check` / `closeout` 定向绿。

## §5 门禁

`node --test test/block477-filetree-repro.test.mjs`；`npm run test:changed`；`npm run docs:check`；`npm run ui:audit:check`；`npm run closeout`；新文件登记 `test/impact-map.json`（block477 规则）。

## §6 风险与降级

- CDP 实机需 dev 栈（:3000 + :3001）+ 9223 离屏实例；若起栈失败/窗口不可控 → 标 `environment_blocked` 归因，以状态机 + 源码锚定为证据，不伪造实机断言。
- 采样时机与 2s 轮询相位可能错过回弹窗 → 多次采样并记录相位，不因单次未命中改口径。
- 状态机是源码语义抽象，不冒充 GUI 真值；实机腿缺席时结论标注证据等级。

## §7 完成语义

`completed` = 三态结论落盘 + 证据 + 门禁绿 + 六件套回写 + 提交。**归因成立 ≠ 已修复**——成立时只立修复票并停下报用户；不成立时保持 C-47 kept-open。修复实施属独立票，需用户显式发令。
