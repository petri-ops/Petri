# BLOCK-9.2-MEGA-FILE-REFACTOR 工作包计划

**版本**：v0.2（PHASE 0 调研收口后，主 agent 修订）
**启动时间**：2026-08-17 07:46
**PHASE 0 调研**：[`docs/block-9-2-mega-file-split-survey.md`](./block-9-2-mega-file-split-survey.md)（1134 行 / 74 KB / 0 行代码改动）
**关联评审**：[`docs/senior-engineer-review-2026-08-16.md`](./senior-engineer-review-2026-08-16.md) §3
**关联已收口**：
- [`docs/block-9-mega-file-refactor-closeout.md`](./block-9-mega-file-refactor-closeout.md) — 前端拆分范式
- [`docs/block-9-1-main-js-split-closeout.md`](./block-9-1-main-js-split-closeout.md) — 后端 main.js 拆分范式

---

## 1. 目标

拆 senior-engineer-review §3 中列出的 5 个非文件级"不合理"巨型文件，工作量 3.5-4 天。

| # | 文件 | 当前行数 | 优先级 | 拆分类别 |
|---|------|----------|--------|----------|
| 1 | `frontend/src/components/desktop/DesktopSettingsPanel.tsx` | 1515 | **P0** | 前端 React + 6 section 子组件 |
| 2 | `frontend/src/components/workspace-panels/ResultView.tsx` | 1662 | **P0** | 前端 React + 单组件 + ResultArtifactShell |
| 3 | `src/plugin-manager.js` | 1457 | **P1** | 后端 Node.js + 5 lib/ + IPC 修复 |
| 4 | `frontend/src/components/copilot/SimpleChat.tsx` | 2153 | **P2** | 前端 React + 4 子组件 |
| 5 | `frontend/src/hooks/useSkillStore.ts` | 743 | **P3**（不拆 / 降级） | Zustand store 强耦合 singleton |

**纯代码组织变更，0 业务逻辑差异**。

## 2. 关键发现（PHASE 0 调研）

### 2.1 PHASE 0.5 已修复 BLOCK-9.1 PHASE 2 dangling IPC contract bug

- `src/ipc/plugin.js` 第 18/28/38 行引用 `listInstalledPlugins` / `listRemotePlugins` / `checkPluginUpdates`
- `src/plugin-manager.js` 实际导出 `getInstalledPlugins` / `getRemoteManifest` / `checkUpdates`
- **3 个 IPC handler 静默失败**（try/catch 吞 `require` 返回 undefined 后的调用错）
- 修复方式：改 `src/ipc/plugin.js` 引用的导出名（**不改 plugin-manager.js** — plugin-manager 是稳定导出边界）
- 验证：chf0-critical 33 / vitest 75 文件 630 tests / window-controls 6/6 全 PASS

### 2.2 useSkillStore.ts 不建议拆分

- module-level 5 个 singleton（`_subscriptions`、`_listeners`、`_progressCache` 等）+ 4 个 Map
- 拆了会破坏 singleton 语义
- PHASE 5 仅在 `docs/ui-productization-audit.md` 登记"已评估 + 不建议拆"

### 2.3 5 文件间实际共享代码极少

- **不创建 `lib/shared/`**
- 各自独立拆各自组件

### 2.4 21 个 module.exports 必须 100% 保留

- plugin-manager.js 1457 行的所有导出（含 Week 2 schema re-export）
- 8 个测试文件 0 改动（消费者全部从原 import 路径继续消费）

## 3. 原则（沿用 BLOCK-9 / BLOCK-9.1 治理纪律）

1. **不修改行为**：拆分前后外部可见行为完全一致
2. **不引入新依赖**
3. **保留向后兼容**：原 import 路径仍可工作（re-export 兼容层）
4. **不破坏既有测试**：vitest / chf0-critical / Node tests 0 失败
5. **不外推 G1+ 阶段事项**（按 G0 长期开发期阶段纪律）
6. **worker 委派**：拆分类工作量大、文件多、结构复杂可独立验证的，委派给 explore worker
7. **主 agent 直做**：低风险、范围狭窄、可直接验证的，主 agent 直做
8. **渐进拆分**：每个 PHASE 收口才开下一个 PHASE，不要一窝蜂

## 4. 拆分范式（统一）

### 4.1 后端 Node.js（`plugin-manager.js`）
- **生命周期分层**：load / register / execute / uninstall
- **5 个 lib/ 自包含**：`plugin-utils.js` / `plugin-schema.js` / `plugin-manifest-validator.js` / `plugin-marketplace.js` / `plugin-runtime.js`
- **主文件反向 require 共享 helper**（参考 BLOCK-9.1 §4.1）
- **保留 module-level 状态**：让 plugin registry / IPC handlers 能持续引用

### 4.2 前端 React + UI（SimpleChat / ResultView / DesktopSettingsPanel）
- **Types 优先**：`*.types.ts` 独立文件
- **纯 helpers 抽到 `lib/<domain>/helpers.ts`**（无 React / 无副作用）
- **自定义 hook 独立 `use<X>.ts`**
- **子组件按需抽**：`components/<X>/<SubComponent>.tsx`（**保守**：仅当 props/边界清晰）
- **保留状态**：store dispatch / useState / useReducer 在原文件或独立 hook 模块

### 4.3 前端 Zustand store（useSkillStore）—— **不拆**
- 不创建 singleton 子模块
- 保留 5 个 module-level 状态 + 4 个 Map
- PHASE 5 仅在 audit 登记"已评估 + 不建议拆"

### 4.4 跨边界模式
- **跨前后端类型**（如 plugin manifest）放 `frontend/src/lib/plugin-types.ts` 后端 `src/plugin-schema.js` 各自独立
- **不创建互相 require 的 module 图**（避免循环依赖）

## 5. PHASE 划分（基于 PHASE 0 调研）

### PHASE 0: 已收口
架构调研 worker 委派 ID `d06a18b5-93fd-4d59-b326-60ec01d9e1e7` → 输出 `docs/block-9-2-mega-file-split-survey.md`（1134 行 / 74 KB / 0 改动 / 2026-08-17 07:54 完成）。

### PHASE 0.5: 已收口 关键 bug 修复
**修复 BLOCK-9.1 PHASE 2 dangling IPC contract bug**：
- `src/ipc/plugin.js` 3 个 handler 引用 `listInstalledPlugins` / `listRemotePlugins` / `checkPluginUpdates`（不存在）
- 改为 `getInstalledPlugins` / `getRemoteManifest` / `checkUpdates`（实际导出）
- 验证：chf0-critical 33 / vitest 630 / window-controls 6/6 全 PASS
- 这是 BLOCK-9.1 PHASE 2 收口漏掉的 bug，**PHASE 0.5 立即修复避免后续拆分永久化**

### PHASE 1: DesktopSettingsPanel.tsx 拆 (P0 低风险)
**目标**：1515 → ~600 + 9 文件（types + 6 section 子组件 + 1 helpers + shared 类型）

**拆法**：
- `desktop-settings-panel.types.ts` — 7 section 配置 + Props 类型
- `desktop-settings-panel.helpers.ts` — 1 shared helper（formatDate / validateInput 等）
- `components/desktop/DesktopSettingsPanel/sections/{Privacy,Telemetry,UI,Data,Plugins,Advanced,About}.tsx` — 6 section 子组件
- `components/desktop/DesktopSettingsPanel/index.tsx` — 路由 + 布局
- `components/desktop/DesktopSettingsPanel.tsx` — re-export 兼容

**边界**：不动样式 / 不动 ipc 桥 / 不动状态 / 不动 hooks

**验收**：tsc 0 / vitest 75/630 0 失败 / 4 治理门 GREEN / 6 import 客户 0 改动

### PHASE 2: ResultView.tsx 拆 (P0 中风险)
**目标**：1662 → ~1100 + 4 文件（types + 2 helpers + ResultArtifactShell 提 lib/）

**拆法**：
- `workspace-panels/ResultView/types.ts` — Props / State / WorkbenchResult 类型
- `workspace-panels/ResultView/resultArtifactHelpers.ts` — 2 helpers（formatSize / buildColumns）
- `lib/result-artifact/ResultArtifactShell.tsx` — 1313 行单组件（已存在但单文件过长）
- `buildPreviewTable` 已在 BLOCK-9 PHASE 2 抽到 `lib/file-preview/`，**不重复**

**边界**：不动 ActiveArtifact / JobStats 兼容性 / 不动 buildPreviewTable 调用

**验收**：tsc 0 / vitest 75/630 0 失败 / 4 治理门 GREEN / 4 个 re-export 客户 0 改动

### PHASE 3: plugin-manager.js 拆 (P1 中风险)
**目标**：1457 → ~600 + 5 lib/（plugin-utils / plugin-schema / plugin-manifest-validator / plugin-marketplace / plugin-runtime）

**拆法**：
- `src/plugin-utils.js` — fileHash / version compare / parseVersion / compareVersions
- `src/plugin-schema.js` — PLATFORM_IDS / ALLOWED_RUNTIME_HOSTS / normalizeRemotePluginEntry / schema types
- `src/plugin-manifest-validator.js` — validateManifest / assertAllowedUrl / assertArtifactChecksumDeclared
- `src/plugin-marketplace.js` — getRemoteManifest / streamingSha256 / dirSize
- `src/plugin-runtime.js` — getInstalledPlugins / installPlugin / uninstallPlugin / checkUpdates / loadAllPlugins / detectPlatform / getRuntimeStatus
- `src/plugin-manager.js` — 主文件 thin facade，反向 require 5 lib/，保留 21 个 module.exports 100% 一致

**边界**：21 个 module.exports 必须 100% 保留 / 不改 plguin-manager.js 公共接口 / 8 个测试 0 改动 / 3 个 src/ipc/plugin.js handler 0 改动（PHASE 0.5 已修）

**验收**：tsc 0 / vitest 75/630 0 失败 / chf0-critical 33 PASS / 4 治理门 GREEN / 8 个测试 0 改动 / 21 个 module.exports 100% 保留

### PHASE 4: SimpleChat.tsx 拆 (P2 中风险)
**目标**：2153 → ~1200 + 12 文件（types + 4 helpers + 4 子组件 + 1 hook）

**拆法**：
- `copilot/SimpleChat/types.ts` — Props / State / Message 类型
- `copilot/SimpleChat/helpers/` — 4 helpers（sanitize / format / token-count / markdown）
- `copilot/SimpleChat/hooks/` — 1 hook（useChatStream）
- `copilot/SimpleChat/components/` — 4 子组件（MessageList / InputBox / Toolbar / StatusBar）
- `copilot/SimpleChat.tsx` — 路由 + 协调 + re-export 兼容

**边界**：86 hooks 顺序不能变 / 不动 IPC 订阅 / 不动 Context Provider

**验收**：tsc 0 / vitest 75/630 0 失败 / 4 治理门 GREEN / 4 个 import 客户 0 改动

### PHASE 5: useSkillStore.ts 评估 (不拆)
**目标**：仅在 `docs/ui-productization-audit.md` 登记"已评估 + 不建议拆"

**理由**：
- module-level 5 个 singleton（`_subscriptions` / `_listeners` / `_progressCache` / `_backgroundPollers` / `_cachedRemoteSkills`）
- 4 个 Map 强耦合
- 拆了会破坏 singleton 语义
- 743 行合理（远小于 1500+ 阈值）

**审计 entry 格式**：
```
| UI-173 | not_applicable | P3 | W-01 | C-05 | Zustand store 评估决议 | useSkillStore.ts 743 行 — 调研 DECISION: 不拆 | 5 singleton + 4 Map 强耦合 |
```

### PHASE 6: audit + closeout
- 4 canonical 文档同步
- DOC-REGISTRY `BLOCK-9.2-MEGA-FILE-REFACTOR` active → completed + linkedCommits
- 新增 `BLOCK-9.2-MEGA-FILE-REFACTOR-CLOSEOUT` reference entry
- closeout 报告 `docs/block-9-2-mega-file-refactor-closeout.md` 11 节

## 6. 风险控制

### 6.1 高风险点
- `plugin-manager.js` IPC 桥接面（PHASE 0.5 已修 dangling，但 21 个 module.exports 仍 100% 保留）
- `SimpleChat.tsx` 86 个 hooks 顺序不能变
- `ResultView.tsx` ResultArtifactShell 1313 行单组件本身已是 SWE 风险

### 6.2 低风险点
- `DesktopSettingsPanel.tsx` 6 section 边界清晰
- `useSkillStore.ts` 不拆（已决议降级）

## 7. 验收标准

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
- 21 个 plugin-manager.js module.exports 100% 一致
- 8 个测试 0 改动

## 8. UI-169+ 审计 entry

每个 PHASE 收口时在 `docs/ui-productization-audit.md` 末尾追加对应 `UI-###` entry：
- **UI-169**：PHASE 0.5 dangling IPC 修复
- **UI-170**：PHASE 1 DesktopSettingsPanel 拆
- **UI-171**：PHASE 2 ResultView 拆
- **UI-172**：PHASE 3 plugin-manager 拆
- **UI-173**：PHASE 4 SimpleChat 拆（如执行）
- **UI-174**：PHASE 5 useSkillStore 评估
- **UI-175**：PHASE 6 closeout

## 9. 4 canonical 文档同步

每 PHASE 同步：
- `docs/DOC-REGISTRY.json`（`BLOCK-9.2` active → completed + linkedCommits）
- `docs/next-steps-roadmap.md`（launch + closeout entry）
- `docs/project-workspace-handoff.md`（launch + closeout entry）
- `docs/AUDIT-LOG.md`（PHASE 收口 entry + closeout entry）

## 10. 不外推（G0 阶段纪律）

- 不修改业务行为
- 不引入新依赖
- 不动 preload.js / electron.d.ts / desktopBridge.ts
- 不外推 packaged / Provider / GA / P7 / notarization / dist staleness G1+ 工作
- 不外推 UI-157 / UI-158 / UI-159 既有 in_progress 实机复核
- 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1
- 不动 agent-tools/ / agent-transcripts/（历史抹底产物）
- 不修改 `docs/senior-engineer-review-2026-08-16.md` 评审报告内容
- 不修改 `docs/block-9-2-mega-file-split-survey.md` 调研报告（已收口，后续只 Read）

## 11. 与 BLOCK-9 / BLOCK-9.1 边界

| 维度 | BLOCK-9 | BLOCK-9.1 | BLOCK-9.2 |
|------|---------|-----------|-----------|
| 范围 | 前端 `_data.ts` / `project-workspace.tsx` + `buildPreviewTable` 提取 | 后端 `src/main.js` | 5 个非文件级巨型文件（后端 + 前端混） |
| 拆分类别 | 拆 _data.ts + 抽 buildPreviewTable + 拆 project-workspace | 拆 18 setup* + setupDesktopEnv | 拆 plugin-manager + 4 个前端巨型文件 |
| 行数降幅 | _data.ts 2157→5 文件 + project-workspace.tsx 3222→3114 + types/helper 提取 | main.js 2450→1066 = -56.5% | 估计 -2000 行（5 文件合计）+ 修 dangling IPC bug |
| PHASE 数 | 4（0/1/2/3 拆 + 4 closeout） | 5（0/1/2/3/4 拆 + 5 closeout） | 7（0 调研 + 0.5 dangling 修复 + 1/2/3/4/5 拆 + 6 closeout） |

## 12. 当前状态

- **PHASE 0 调研**：已收口（worker `d06a18b5` 完成）
- **PHASE 0.5 dangling 修复**：已收口（worker 发现 + 主 agent 立即修复）
- **PHASE 1 DesktopSettingsPanel 拆**：当前进行中
- **PHASE 2/3/4/5/6**：按 PHASE 1 收口后顺序推进

---

**不变量**：本计划文件为 BLOCK-9.2 工作包唯一 active canonical 计划 v0.2，PHASE 1 收口后调整为 v0.3。

## 13. 关联收口文档（PHASE 4 第二轮 commit 3 落地后追加）

- [`docs/block-9-2-mega-file-refactor-closeout.md`](block-9-2-mega-file-refactor-closeout.md) — BLOCK-9.2-MEGA-FILE-REFACTOR 工作包完整 closeout（11 节 / TL;DR + 5 PHASE + 累计指标 + 不变量 + 不外推）
- [`docs/block-9-2-useSkillStore-evaluation.md`](block-9-2-useSkillStore-evaluation.md) — PHASE 5 useSkillStore.ts 评估决议（7 节 / 5 大不拆理由 + useChatStream hook 反向佐证 + UI-179 not_applicable）

**PHASE 4 第二轮 commit 3**（`1a58f2c`）落地后，PHASE 4 closeout + PHASE 5 evaluation 登记完成；2026-08-18 PHASE 6 二次收口 4 commits `b2564ac` + 本节关联文档 commit + DOC-REGISTRY 完整 closeout 同步 + AUDIT-LOG + closeout 报告全部完成。BLOCK-9.2-MEGA-FILE-REFACTOR 工作包 COMPLETED。
