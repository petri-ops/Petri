---
capability: block502-c47-filetree-poll-fix
status: completed
phase: CLOSED
goal: C-47 文件树翻页/回弹修复票·方向 A（用户 2026-11-19 裁决「方向 A（推荐）」）——轮询路径只做活动文件签名对账（不重建树、不重置 rootMore 续拉游标），整树重拉限定在结构变更事件（初始加载/换项目/agent 写档广播/手动刷新）；消除「本地 2s 轮询以 offset=0 覆盖续拉页」缺陷（BLOCK-477 三重证据复现归因：reproduced_and_attributed）。
acceptance:
  - HK-01：红=本地项目 2s tick 根拉取数增长（症状复现）→ 实现方向 A → 绿=两 tick 零根拉取+签名对账仍在跑+结构事件保留全量重建语义（既有 UI-399 测试零回归）
  - 读数核：readActiveSignature/reconcileActiveFile 拆分；refreshFiles 语义不变（根拉取+签名+forcePreview 全量 bump）
  - tsc 零红 + 前端 vitest 2/2 + closeout 定向 + 六件套 + commit/push
  - 零新依赖 / 观感零代签 / 不碰 G1+（SSH 项目本就不轮询，行为不变）
reopen: 轮询语义再回退（如有人把 reconcile 改回 refreshFiles）由该测试抓红；翻回方向 B 需用户裁决
supersedes: 无（处置 BLOCK-477 C-47 open 票，方向 A=报告内标注「最小、推荐」项）
---

# BLOCK-502 · C-47 修复票（方向 A：轮询只对账不重建）

日期：2026-11-19 · 关联：[BLOCK-477 复现归因报告](./block477-filetree-attribution-report.md) §方向 A · 用户裁决「方向 A（推荐）」（2026-11-19 AskUserQuestion）

## 0. 一句话

把 2s 轮询从「refreshFiles 全量重建」收窄为「reconcileActiveFile 签名对账」：根拉取/树重建/续拉游标重置只发生在结构变更事件；用户已续拉的页不再被轮询静默收回。

## 1. 实现面

- `frontend/src/pages/project-workspace/RightFileTree.tsx`：新增 readActiveSignature（签名读取核，返回「是否变化」）+ reconcileActiveFile（签名对账+活动 tab bump）；refreshFiles 保留全量语义（根拉取+readActiveSignature+forcePreview 全量 bump），轮询 interval 改调 reconcileActiveFile；结构事件路径（初始加载/激活/广播/手动按钮）全部不动。
- `frontend/src/pages/project-workspace/RightFileTree.refresh.test.tsx`：新增 C-47 方向 A 回归测（fake timers 驱动 2 tick：根拉取数不增长+签名对账 ≥2 次+广播事件仍全量重建）。

## 2. 非范围

- 方向 B（轮询前按 rootMore.done 恢复页数）不实施（用户选 A）；UI 分页交互面不动；SSH 项目本不轮询（行为不变）；观感归人零代签；不碰 G1+。

## 3. 验收判据

- HK-01 红（hk01-red.txt：两 tick 根拉取增长）→ 绿（hk01-green.txt：2/2，根拉取零增长+事件重建保留）；
- tsc 零红；closeout 定向绿；证据=acceptance/block502-c47-fix/；
- G0 开发期常态 · 不外推 packaged/Provider/GA。

---

## 收口笔录（2026-11-19 · 一次会话完成）

- HK-01：红（hk01-red.txt：本地项目两 tick 根拉取增长=C-47 症状复现）→ 方向 A 实现 → 绿 2/2（hk01-green.txt：零根拉取+签名对账 ≥2+广播事件重建保留）。
- 执行修正（如实登记）：①vitest toBe 消息参数移 expect 首参（tsc 2554）；②根拉取过滤词勘误（所有 /tree 调用均带 prefix=，根=空值 /prefix=(&|$)/）；③impact-map rule tests 引用勘误（真实文件名 workspace-file-ops.test.mjs，规则引用缺席测试=exit 2）；④RightFileTree 尺寸指纹重打（1061→1079 拆分净增留因）。
- 提交：f8f41fe7（主批）+ bf5b0828（勘误）+ 8be587a8（指纹）+ 本批（翻面批）。
- C-47 open 票就此关闭；方向 B 不实施（用户选 A）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
