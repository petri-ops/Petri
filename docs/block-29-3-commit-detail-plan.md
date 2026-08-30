# BLOCK-29.3-COMMIT-DETAIL — 提交详情增强（完整提交说明 + 汇总统计） Plan

- **Plan ID**: `BLOCK-29.3-COMMIT-DETAIL`（用户裁决，2026-08-30，选项「完整说明 + ±统计」）
- **状态**: `completed`（2026-08-30 收口：tsc 0 / 定向 vitest 23/23 / adapter 真实仓库快测 / CDP 实机断言详情头折叠展开 + 汇总统计 + 无 body 不渲染 details，证据 `acceptance/ui-223/`；UI-223 verified）
- **truthDomain**: `block-29-3-commit-detail`
- **阶段**: P0 治理登记（`9d62ac1`）→ P1 实现（UI-223，`38980b6`）+ 实机证据 → P2 收口（本 commit）
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 用户反馈（2026-08-30）

用户实测审阅「历史」分区后反馈：「这个历史记录没有详细的信息吗？我记得每次 commit 都应该有改变的信息在的」。现状：点提交行可见文件条 + 只读 diff（含每文件 ±统计，BLOCK-29 已交付），但 commit 的**完整提交说明（message body）**应用内不可见——git-adapter log 仅解析 subject 一行（`%s`），列表行与详情头均无正文，终端 `git show` 才能看到。用户裁决立项补齐：完整说明 + 汇总统计。

## 2. 方案（单 PHASE，UI-223）

- **adapter**（`core/shared-backend/git-adapter.js` log()）：pretty format 改为 `\x01` 记录分隔 + `%b` body 字段（`%x01%H%x00%h%x00%an%x00%aI%x00%s%x00%b`），解析按 `\x01` 分记录（body 可含换行，不能按行切），body 去尾部换行；字段数校验 5 → 6。
- **IPC 载荷 additive**：`git:commit-log` 返回 `commits[]` 增加 `message` 字段（0 新增通道，preload 直传不改）；`electron.d.ts` commitLog commits 类型 + `useWorkingTreeReview` `CommitInfo` 增加 `message`。
- **前端**（ReviewMode 提交详情视图）：新增 `.rvw-commit-info` 详情头——subject（粗体）+ author · 时间 + 汇总统计（`N 文件 +A −D`，由既有 commitDiff `summary`/`files.length` 聚合，0 新查询）；body 非空时以原生 `<details>` 折叠展示完整说明（展开/收起，零新增 state）；字号只用 `--biof3-font-size-*` token。
- **范围修正（诚实记录）**：文件条每文件 ±统计 BLOCK-29 已交付（`computeFileDiffStats`），本包不重做。

**非范围**：历史列表行内嵌 body（保持列表密度）/ 按 body 搜索 / commit amend / 暂存区·分支切换·push-pull（维持排除）/ 0 新增 IPC 通道 / 0 新依赖 / AI 审阅 0 重新引入。

## 3. 门禁

tsc 0 / 定向 vitest（ReviewMode：详情头完整说明折叠展开、汇总统计、body 为空不渲染 details）/ docs:check / ui:audit:check / docs:reconcile；**实机**：localhost:3000 项目页注入桥桩（磁盘真实 git 状态喂 commitLog/commitDiff），CDP 断言详情头 body 展示 + 汇总统计，截图 `acceptance/ui-223/`。

## 4. 增量记录

- **UI-230（2026-08-30，用户反馈「点开就应该向下展开详细内容」）**：详情头完整说明去掉 `<details>` 折叠，点开提交即直接渲染全文（上限 40vh 内部滚动）；提交见 ui-productization-audit.md UI-230 条。

G0 开发期常态 · 不外推 packaged/Provider/GA.
