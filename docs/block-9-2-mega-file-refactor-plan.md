# BLOCK-9.2-MEGA-FILE-REFACTOR 工作包计划

**启动时间**：2026-08-17（BLOCK-9.1 收口后用户裁决"可以开搞了"启动）
**计划版本**：v0.1（PHASE 0 调研驱动更新）
**关联评审**：[`docs/senior-engineer-review-2026-08-16.md`](./senior-engineer-review-2026-08-16.md) §3 — 5 个非文件级问题
**关联已收口**：
- [`docs/block-9-mega-file-refactor-closeout.md`](./block-9-mega-file-refactor-closeout.md) — 前端拆分范式
- [`docs/block-9-1-main-js-split-closeout.md`](./block-9-1-main-js-split-closeout.md) — 后端 main.js 拆分范式

---

## 1. 目标

拆 senior-engineer-review §3 中列出的 5 个非文件级"不合理"巨型文件：

| # | 文件路径 | 当前行数 | 拆分类别 |
|---|----------|----------|----------|
| 1 | `src/plugin-manager.js` | 1457 | 后端 Node.js（plugin 生命周期 + IPC） |
| 2 | `frontend/src/components/copilot/SimpleChat.tsx` | 2153 | 前端 React + UI |
| 3 | `frontend/src/components/workspace-panels/ResultView.tsx` | 1662 | 前端 React + UI |
| 4 | `frontend/src/components/desktop/DesktopSettingsPanel.tsx` | 1515 | 前端 React + UI |
| 5 | `frontend/src/hooks/useSkillStore.ts` | 743 | 前端 Zustand store |

**纯代码组织变更，0 业务逻辑差异**。

## 2. 原则（沿用 BLOCK-9 / BLOCK-9.1 治理纪律）

1. **不修改行为**：拆分前后外部可见行为完全一致
2. **不引入新依赖**
3. **保留向后兼容**：原 import 路径仍可工作（re-export 兼容层）
4. **不破坏既有测试**：vitest / chf0-critical / Node tests 0 失败
5. **不外推 G1+ 阶段事项**（按 G0 长期开发期阶段纪律）
6. **worker 委派**：拆分类工作量大、文件多、结构复杂可独立验证的，委派给 explore worker
7. **主 agent 直做**：低风险、范围狭窄、可直接验证的，主 agent 直做
8. **渐进拆分**：每个 PHASE 收口才开下一个 PHASE，不要一窝蜂

## 3. 拆分范式（统一）

### 3.1 后端 Node.js（如 `plugin-manager.js`）
- **生命周期分层**：load / register / execute / uninstall
- **IPC 部分抽到 `src/ipc/`**（纯 ipcMain.handle 包装，独立 module 自包含）
- **Schema / 校验抽到独立模块**：`plugin-schema.js` / `plugin-manifest-validator.js`
- **纯 utility 抽到 `src/lib/plugin-utils.js`**
- **保留 module-level 状态**：让 plugin registry / IPC handlers 能持续引用

### 3.2 前端 React + UI（SimpleChat / ResultView / DesktopSettingsPanel）
- **Types 优先**：`*.types.ts` 独立文件
- **纯 helpers 抽到 `lib/<domain>/helpers.ts`**（无 React / 无副作用）
- **自定义 hook 独立 `use<X>.ts`**（Zustand store dispatch / useEffect cleanup）
- **子组件按需抽**：`components/<X>/<SubComponent>.tsx`（**保守**：仅当 props/边界清晰）
- **保留状态**：store dispatch / useState / useReducer 在原文件或独立 hook 模块

### 3.3 前端 Zustand store（useSkillStore）
- **State / Action / Selector 分层**：`useSkillStore.state.ts` / `useSkillStore.actions.ts` / `useSkillStore.selectors.ts`
- **IPC 订阅独立**：`_subscribeProgressWakeup` 等 init-time effect 抽到 `useSkillStore.subscriptions.ts`
- **类型独立**：`useSkillStore.types.ts`

### 3.4 跨边界模式
- **跨前后端类型**（如 plugin manifest）放 `frontend/src/lib/plugin-types.ts` 后端 `src/plugin-schema.js` 各自独立
- **不创建互相 require 的 module 图**（避免循环依赖）

## 4. PHASE 划分（PHASE 0 调研驱动）

### PHASE 0（worker 委派，**当前进行中**）

worker 委派架构调研，输出报告 `docs/block-9-2-mega-file-split-survey.md`：
- 5 文件每个的顶层结构 + 拆分边界提议
- 优先级 + 风险评估矩阵
- PHASE 1-N 拆分计划建议
- 跨文件复用机会
- 拆分范式建议

### PHASE 1+（待 PHASE 0 报告后细化）

参考 BLOCK-9.1 经验，预计 PHASE 划分：
- **PHASE 1**：拆 plugin-manager.js（后端，最大）
- **PHASE 2**：拆 SimpleChat.tsx（前端最大）
- **PHASE 3**：拆 ResultView.tsx
- **PHASE 4**：拆 DesktopSettingsPanel.tsx + useSkillStore.ts
- **PHASE N+1**：audit + closeout

具体划分 + 边界由 PHASE 0 报告驱动。

## 5. 风险控制

### 5.1 高风险点
- `plugin-manager.js` IPC 桥接面（如 ipcMain.handle / webContents.send）跨多文件被引用，拆分时同步要严
- `SimpleChat.tsx` 含大量 React hook + useState + useEffect，拆分时 hook 顺序不能变
- `useSkillStore.ts` Zustand store 拆分需要保留 store instance 引用

### 5.2 低风险点
- 纯 types 文件（独立存在不会破坏）
- 纯 helpers（无副作用，重构后行为不变）

## 6. 验收标准

每个 PHASE 收口必跑：
- `cd frontend && npx tsc --noEmit` 0 错误
- `cd frontend && npx vitest run` 0 失败 / 0 改动
- `npm run docs:check` 注册文档数 PASS
- `npm run ui:audit:check` UI ID 数 PASS
- 后端 Node `node --check` 全部 OK
- chf0-critical 3 测试（33 项）PASS（plugin IPC contract）
- 不变量守住：`src/preload.js` / `frontend/src/lib/electron.d.ts` / `frontend/src/lib/desktopBridge.ts` 0 diff
- 后端 IPC handler channel 字面量 100% 一致
- 前端 React component 名 100% 一致

## 7. UI-169+ 审计 entry

每个 PHASE 收口时在 `docs/ui-productization-audit.md` 末尾追加对应 `UI-###` entry，标注：
- 拆分前后行数（精确）
- 拆出的新文件清单 + 行数
- 不外推的边界
- 验证证据

## 8. 4 canonical 文档同步

每 PHASE 同步：
- `docs/DOC-REGISTRY.json`（`BLOCK-9.2` active → completed + linkedCommits）
- `docs/next-steps-roadmap.md`（launch + closeout entry）
- `docs/project-workspace-handoff.md`（launch + closeout entry）
- `docs/AUDIT-LOG.md`（PHASE 收口 entry + closeout entry）

## 9. 不外推（G0 阶段纪律）

- 不修改业务行为
- 不引入新依赖
- 不动 preload.js / electron.d.ts / desktopBridge.ts
- 不外推 packaged / Provider / GA / P7 / notarization / dist staleness G1+ 工作
- 不外推 UI-157 / UI-158 / UI-159 既有 in_progress 实机复核
- 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1
- 不动 agent-tools/ / agent-transcripts/（历史抹底产物）
- 不修改 `docs/senior-engineer-review-2026-08-16.md` 评审报告内容

## 10. 与 BLOCK-9 / BLOCK-9.1 边界

| 维度 | BLOCK-9 | BLOCK-9.1 | BLOCK-9.2 |
|------|---------|-----------|-----------|
| 范围 | 前端 `_data.ts` / `project-workspace.tsx` + `buildPreviewTable` 提取 | 后端 `src/main.js` | 5 个非文件级巨型文件（后端 + 前端混） |
| 拆分类别 | 拆 _data.ts + 抽 buildPreviewTable + 拆 project-workspace | 拆 18 setup* + setupDesktopEnv | 拆 plugin-manager + 4 个前端巨型文件 |
| 行数降幅 | _data.ts 2157→5 文件 + project-workspace.tsx 3222→3114 + types/helper 提取 | main.js 2450→1066 = -56.5% | 待 PHASE 0 调研 |
| PHASE 数 | 4（0/1/2/3 拆 + 4 closeout） | 5（0/1/2/3/4 拆 + 5 closeout） | 待 PHASE 0 调研 |

## 11. 当前状态

- **PHASE 0 调研**：worker 后台运行（委派 ID: `d06a18b5-93fd-4d59-b326-60ec01d9e1e7`）
- **目标报告**：`docs/block-9-2-mega-file-split-survey.md`
- **等 worker 完成后**：读报告 → 调整本计划 v0.2（细化 PHASE 1-N）→ 主 agent 启动 PHASE 1

---

**不变量**：本计划文件为 BLOCK-9.2 工作包唯一 active canonical 计划，等 PHASE 0 报告收口后立即细化为 v0.2。
