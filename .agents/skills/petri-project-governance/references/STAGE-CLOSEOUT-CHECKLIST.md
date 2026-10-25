# 阶段 / Goal 收口检查单

> 按序执行；顺序本身就是纪律（先证据、后回写、再登记）。
> canonical 依据：`$petri-project-governance` SKILL.md §"Close a Goal or stage"。

## 1. 证据先行（回写之前）

- [ ] 包体量/耦合度值得评审时（跨模块契约、新增 IPC 面、安全面），收口前做一轮六维自查并处理 P1 级发现：①契约一致性（文档/台账 vs 源码）②单一真相 ③失败语义 fail-closed ④测试走真实链路 ⑤边界与安全 ⑥死代码残留；宿主存在 `$petri-code-review` skill 时按其报告模板产出
- [ ] plan 里声明的每一条验收门禁，用**当前**证据逐项对账（不追溯旧绿；复用 last-green 须 digest/环境/契约完全一致）
- [ ] `npm run closeout`（hygiene → docs:check → ui:audit:check → test:changed，fail-fast）+ `--gate` 挂本包专项门禁
- [ ] 红旗归属判定：并行包在制面/存量漂移导致的红，如实登记归属，**不表述为本包通过，也不算本包失败**
- [ ] 跳过的门禁标 SKIPPED 并给原因；未跑/失败/复用的门禁不得表述为 freshly passed

## 2. canonical 回写（五件套，按涉及面取舍）

- [ ] work package plan §状态头（active → completed / 阶段标记）
- [ ] canonical roadmap（active 清空或顺位更新）
- [ ] `docs/project-workspace-handoff.md`（可恢复状态）
- [ ] `docs/ui-productization-audit.md`（UI 增量：in_progress → verified 需实机证据）
- [ ] `docs/DOC-REGISTRY.json`：status 改 `completed` / `reference` / `superseded`（不从年龄或聊天推断）

## 3. 治理门禁

- [ ] `npm run docs:reconcile`：逐条审阅候选，不自动移动/删除
- [ ] **归档清债节奏**：本轮至少处理一条 docs:reconcile 归档/孤岛候选（核对入向引用后归档到 docs/archive/，登记 supersedes），或如实声明"本轮零候选/零处理"——不允许只见不清
- [ ] `npm run docs:check`：绿才能宣称收口

## 4. AUDIT-LOG 收口条目

- [ ] 按模板写收口行（见 `AUDIT-LOG-ENTRY-TEMPLATE.md`）：门禁总账数字 / 实机断言数 / 范围守住 / 遗留候选 / 红旗归属
- [ ] 笔录用语：「G0 开发期常态 · 不外推 packaged/Provider/GA」**一次**；不列举未做的 G1+ 项
- [ ] 头部"最后更新"行前插收口摘要
- [ ] 声明保留 WIP：列明刻意不触碰的他包在制面

## 5. 收口语义自检

- [ ] `completed` / `qualified` / `verified` 每一个字都有对应契约证据支撑
- [ ] "当前无 active 工作包"或下一顺位建议，与 DOC-REGISTRY 一致
- [ ] 已按 `references/NEXT-STEP-BRIEF.md` 输出下一步提示：单条 Jev 建议（含 confidence 与具体范围）+ 母纲波次顺序 + 蓝图/全局计划进展（母纲 Q-MATRIX / §6.5、竞争力纲/成熟度蓝图、Result Studio、UI 台账、active 包）
