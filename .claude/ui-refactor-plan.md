# BioF3 Desktop UI Current Plan

最后更新：2026-07-15

## 当前执行入口

本文件只作为 AI Agent 容易发现的 UI 入口，不再保存历史 Phase 1–14 清单。

当前必须按顺序读取：

1. [`../docs/v1-productization-roadmap.md`](../docs/v1-productization-roadmap.md) Stage 1
2. [`../docs/ui-productization-audit.md`](../docs/ui-productization-audit.md)
3. [`../docs/codex-style-workbench-direction.md`](../docs/codex-style-workbench-direction.md)
4. [`../docs/development-module-map.md`](../docs/development-module-map.md)

## 当前任务

只执行 `UI-1 实机审计与问题台账`：

- 正式 `rc.4` 与开发版逐屏截图。
- 按 W 模块、C 关注点和 P0/P1/P2 登记问题。
- 与用户确认第一批范围。
- 第一批实现从全局 token、桌面壳、顶栏、三栏容器和拖拽开始。

## 已建立结构

项目模型、三栏工作台、项目级会话、结果卡片、Artifact 查看器、参数确认、工作路径和 Agent workflow UI 已有实现。Stage 1 是产品化与一致性优化，不是重建这些系统。

## 禁止事项

- 不从旧 Phase 编号推断当前优先级；旧完整计划可通过 Git 历史查看。
- 不在 UI Stage 1 顺手实现新模型 Provider 或扩充 Harness 内容。
- 不创建第二套 job、artifact、conversation 或 layout 状态系统。
- 不用单纯编译通过代替视觉和打包态实机验证。
