# BLOCK-29.4-COMMIT-FILE-FULLTEXT — 提交时点文件全文查看 Plan

- **Plan ID**: `BLOCK-29.4-COMMIT-FILE-FULLTEXT`（2026-08-30；用户提出「理论上只要想都应该能看到的」后 AskUserQuestion 未勾选，主 Agent 按推荐项取最小增量落地，其余只读候选项登记待裁决）
- **状态**: `active`（P0）
- **truthDomain**: `block-29-4-commit-file-fulltext`
- **阶段**: P0 治理登记（本 commit）→ P1 实现（UI-224）+ 实机证据 → P2 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 背景与范围

用户反馈：「能否看更多的内容呢 理论上只要想都应该能看到的」。盘点结论：`git:commit-file-content` IPC 已返回提交时点文件两版全文（original/modified），`CommitDiffFileView` 本地状态已持有（`revision.originalText/modifiedText`），但 UI 仅渲染 diff——「这个提交时点整个文件长什么样」看不到，而数据已在手。本包 = **纯前端**把已有数据多渲染一种视图，0 后端改动。

- `CommitDiffFileView` 增 `viewMode` 本地 state：`diff`（默认）/ 全文·改动后 / 全文·改动前（改动前在 `originalText` 为空即新增文件时禁用）；`hash`/`file.path` 变化重置回 `diff`。
- 全文渲染复用 `CodeMirrorEditor`（readonly 默认 true、lineNumbers 内建），`language` 按扩展名小映射（py→python / md→markdown / json→json / yaml|yml→yaml / js|mjs|jsx|ts|tsx→javascript，其余缺省纯文本）。
- 文件头加视图切换 segmented（diff / 改动后 / 改动前），字号只用 `--biof3-font-size-*` token。

**非范围（登记 roadmap 候选待用户裁决，不实施）**：全分支历史（只读 `log --all` + 分支选择器）/ blame 逐行归属 / 任意两提交对比 / stash-tag 查看 / 未跟踪文件内容预览。**维持排除**：分支切换 / 暂存区两栏 / push-pull（此前裁决）；0 新增 IPC / 0 新依赖 / AI 审阅 0 重新引入。

## 2. 门禁

tsc 0 / 定向 vitest（视图切换：改动后/改动前全文渲染、新增文件改动前禁用、切文件重置 diff）/ docs:check / ui:audit:check / docs:reconcile；**实机**：localhost:3000 项目页注入磁盘真实 git 桥桩，断言全文视图内容与三态切换，截图 `acceptance/ui-224/`。

G0 开发期常态 · 不外推 packaged/Provider/GA.
