# BLOCK-9-MEGA-FILE-REFACTOR 工作包（巨型文件拆分重构）

**最后更新**：2026-08-16 22:55
**状态**：`active`（2026-08-16 22:50 用户裁决"按照你的建议来"启动 BLOCK-9）
**Plan ID**：`BLOCK-9-MEGA-FILE-REFACTOR`
**评审依据**：`docs/senior-engineer-review-2026-08-16.md`

---

## 1. 决策与定位

按用户裁决"按照你的建议来"（基于高级软件工程师评估报告的优先级表 P0/P1 5 项中的 3 项）启动 BLOCK-9，目标**纯代码组织重构**：

- **拆 `project-workspace.tsx` 3222 → 4 文件**（P0，保留 re-export 兼容入口）
- **拆 `_data.ts` 2157 → 5 文件**（P0，分类 registry / categories / inventory / demos / 兼容入口）
- **抽 `buildPreviewTable` 到 `lib/file-preview/`**（P1，解决 ResultView + SimpleChat 重复）

**原则**：
- **不修改行为**（只搬代码，0 业务逻辑变更）
- **不引入新依赖**（不引入 refactor 工具如 `react-refactor` / `ts-morph`）
- **保留向后兼容**（原 import 路径继续生效，re-export 兼容层）
- **不破坏测试**（既有 vitest 用例 0 改动）
- **不外推**（BLOCK-9 完成 = 3 项；剩余 6 项留后续工作包）

**为什么 BLOCK-9 可主 agent 直做**：
- 纯代码组织变更（不依赖 IPC 桥 / dev Electron 实机）
- 拆分前后行为完全一致
- 4 治理门 GREEN（tsc 0 / vitest 0 失败 / docs:check / ui:audit:check）
- 拆分后所有 import 路径形式应能编译通过

---

## 2. PHASE 划分

### PHASE 1：拆 `_data.ts` 2157 → 5 文件

**前置**：摸清 `_data.ts` 实际内容结构（interface / categories / tools 数组 / demo 数据）

**目标结构**：
```
frontend/src/tools/
├── registry.ts          # InputField / OutputDef / Tool interfaces
├── categories.ts        # toolCategories 数组
├── inventory.ts         # tools: Tool[] 数组（按 category 分组）
├── demos/
│   ├── index.ts         # 聚合所有 demo 导出
│   ├── <tool-id-1>.ts   # 每个工具一个 demo 文件
│   └── ...
└── ...

frontend/src/pages/_data.ts  # 仅 re-export 保留向后兼容
```

**风险**：
- `tools` 数组可能内部引用 demo 数据，需要解耦
- 需保持每个工具的 `demo` 字段引用相对路径正确

**验证**：
- `tsc --noEmit` 0 错误
- 所有 `import { tools, toolCategories } from '...'` 继续工作
- tsc 重命名追踪：grep 找所有 `_data` 引用

### PHASE 2：抽 `buildPreviewTable` 到 `lib/file-preview/`

**前置**：对比 `ResultView.tsx` 和 `SimpleChat.tsx` 的 `buildPreviewTable` 实现，确认**完全一致**或选择更完整版本

**目标结构**：
```
frontend/src/lib/file-preview/
└── buildPreviewTable.ts       # 提取的共享版本（带 tsdoc 注释）
```

**风险**：
- 行为差异（如果有）：选择更完整版本；老版本注释“已废弃，请使用 lib/file-preview”
- 默认参数不一致：统一为最严格签名

**验证**：
- ResultView.tsx 和 SimpleChat.tsx 都改为 `import { buildPreviewTable } from 'frontend/src/lib/file-preview/buildPreviewTable'`
- 既有测试 0 改动 + 0 失败

### PHASE 3：拆 `project-workspace.tsx` 3222 → 4 文件

**前置**：摸清 15 个子组件 + 7 个工具函数的实际依赖与命名

**目标结构**：
```
frontend/src/pages/project-workspace/
├── index.tsx                 # 路由 + 布局（page 默认 export）
├── FileTree/
│   ├── index.tsx             # FileTree 容器
│   ├── FileTreeList.tsx      # 文件树列表
│   ├── FileTreeItem.tsx      # 单个文件节点
│   └── types.ts              # FileTree internals
├── FilePreview/
│   ├── index.tsx             # 文件预览容器
│   ├── WorkspaceFilePreview.tsx
│   ├── TextBlock.tsx
│   ├── PreviewAssets.tsx
│   ├── types.ts
│   └── helpers.ts            # 7 个工具函数（isCsvFile / isPdfFile / isHtmlFile / withReportTheme / detectOfficeKind / formatSize / buildWorkspacePreviewTable）
└── OfficePreview/
    ├── index.tsx
    ├── OfficePreviewPane.tsx
    ├── BinaryPreviewCard.tsx
    └── types.ts

frontend/src/pages/project-workspace.tsx  # re-export 兼容入口
```

**风险**：
- 子组件共享的 state / props 需要通过 props 传递（不能依赖模块级变量）
- `import` 路径变化可能影响 tsconfig path resolution
- 既有 page 必须能继续从 `frontend/src/pages/project-workspace` 找到

**验证**：
- `tsc --noEmit` 0 错误
- 既有路由（如果有）继续工作
- 既有测试 0 改动

### PHASE 4：审计 + closeout

- 4 治理门 GREEN
- 4 canonical 文档同步
- DOC-REGISTRY `active → completed` + 新增 CLOSEOUT reference entry
- closeout 报告
- AUDIT-LOG 登记

---

## 3. 验收门禁

| # | 命令 | 必跑 |
|---|---|---|
| 1 | `npm run docs:check` | ✅ PHASE 4 commit 前 |
| 2 | `npm run ui:audit:check` | ✅ PHASE 1 + 2 + 3 + 4 |
| 3 | `cd frontend && npx tsc --noEmit` | ✅ PHASE 1 + 2 + 3 + 4 |
| 4 | `npm run docs:reconcile` | ✅ PHASE 4 commit 前 |
| 5 | `cd frontend && npx vitest run` | ✅ PHASE 2 + 3 + 4 |
| 6 | `npm run ui:audit:check` 同步 | ✅ PHASE 3 commit 前 |

---

## 4. 完成语义

- `_data.ts` 2157 → 5 文件（registry / categories / inventory / demos / 兼容）
- `buildPreviewTable` 抽到 `lib/file-preview/` 解决重复
- `project-workspace.tsx` 3222 → 4 文件（FileTree / FilePreview / OfficePreview / 兼容）
- 4 治理门 GREEN
- 既有 vitest 0 失败 / 0 改动
- `desktopBridge.ts` 0 diff / `electron.d.ts` 0 diff / `preload.js` 5 方法签名不变 / 4 page 0 diff / `core/shared-backend/*` 0 diff / `agent-tools/` 0 diff

---

## 5. 不外推

- 不外推 P1 剩余 2 项（main.js 2450 拆分 / SimpleChat.tsx 2153 拆分）— 留后续工作包
- 不外推 P2 + P3 5 项
- 不外推 BLOCK-5 E1-d/E1-e G1+ 架构改动
- 不外推 release-pipeline dist staleness G1+ 红线
- 不外推 i18n 资源抽离
- 不重新激活 BLOCK-2/3/4/5/6/7/8
- 不动 preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/

---

## 6. 下一块候选（须经用户显式裁决启动新工作包）

按 single work package serial 纪律，本工作包收口后 **不主动启动**新工作包。剩余候选：

| 候选 | 来源 | 备注 |
|---|---|---|
| **BLOCK-9.1** Main.js 2450 拆分 | 评审报告 P1 | 15 IPC setup 函数拆模块 |
| **BLOCK-9.2** SimpleChat 2153 拆分 | 评审报告 P1 | 86 hooks + 多角色 UI 混杂 |
| **BLOCK-9.3** plugin-manager 1457 拆分 | 评审报告 P2 | 27 函数散落 |
| **BLOCK-9.4** DesktopSettingsPanel 1515 拆分 | 评审报告 P2 | 单组件多领域 |
| **BLOCK-9.5** useSkillStore 743 拆分 | 评审报告 P2 | Singleton store 反模式 |
| **BLOCK-9.6** IPC channel 常量集中 | 评审报告 P3 | 卫生改进 |
| BLOCK-7.1 / BLOCK-8.1 UI-132/161 视觉截图 | 工具边界 | 用户 "暂时不提" |
| UI-156/157/158/159/AGENTWB-001/002 实机 | 工具边界 | 用户 "暂时不提" |
| BLOCK-9 / BLOCK-10 平台 / i18n | 用户 "暂时不提" | |

**当前无 active 工作包**（BLOCK-9 收口后）。
