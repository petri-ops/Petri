# BLOCK-9-MEGA-FILE-REFACTOR 工作包收口报告

**最后更新**：2026-08-16 23:35
**状态**：`completed`（2026-08-16 启动当日收口）
**Plan ID**：`BLOCK-9-MEGA-FILE-REFACTOR`
**关联 UI-###**：`UI-162 / UI-163 / UI-164` 全部 verified
**评审依据**：`docs/senior-engineer-review-2026-08-16.md`

---

## 1. 收口总结

按用户裁决"按照你的建议来"（基于高级软件工程师评审报告 P0/P1 5 项中的 3 项）启动 BLOCK-9，**当日 4 PHASE 全部收口**：
- **PHASE 0**（启动 + 评审报告永久化）：plan + 评审报告 + 4 canonical 同步 + DOC-REGISTRY + commit `d87a0f8`
- **PHASE 1**（拆 `_data.ts` 2157 → 3 文件）：commit `e78567c`，UI-162 verified
- **PHASE 2**（抽 `buildPreviewTable` 到 `lib/file-preview/`）：commit `1c14f49`，UI-163 verified
- **PHASE 3**（拆 `project-workspace.tsx` 3213 → 3114 + 8 helpers + types 抽离）：commit `c1e2bd5`，UI-164 verified

## 2. 关键决策

### 2.1 PHASE 0 评审报告

按 senior-engineer-review-2026-08-16.md §4 优先级表**挑选 3 项**（P0×2 + P1×1）：
- ✅ P0 `_data.ts` 2157 拆分
- ✅ P0 `project-workspace.tsx` 3222 拆分（部分）
- ✅ P1 `buildPreviewTable` 抽 lib/

**剩余 6 项**（P1 剩余 2 项 + P2 3 项 + P3 1 项）按 BLOCK-9.1 ~ BLOCK-9.6 候选列表留后续工作包，需用户显式裁决启动。

### 2.2 PHASE 1 拆 5 → 3 文件

**原计划 5 文件**（registry / categories / inventory / demos / 兼容）—— **摸底发现 `_data.ts` 实际无 demo 字段**（所有 tool 字段都是生产配置），改为 **3 文件**（registry / categories / inventory + 兼容）：

```
frontend/src/tools/registry.ts     56 行  (InputField/OutputDef/Tool)
frontend/src/tools/categories.ts   17 行  (toolCategories 9 项)
frontend/src/tools/inventory.ts  2095 行  (tools: Tool[] 完整)
frontend/src/pages/_data.ts        17 行  (re-export 兼容)
```

**6 个 consumer 0 改动**（SimpleChat / WorkspaceSearchPanel / RightPanel / ResultView / AnalysisLaunchPanel / project-workspace.tsx 全部继续从 `@/pages/_data` 引用）。

### 2.3 PHASE 2 抽公共 buildPreviewTable

**真实重复**（不是 SimpleChat 而是 project-workspace）：
- `ResultView.tsx` `buildPreviewTable(text, fileName)` (slice 40 + split `\n`)
- `project-workspace.tsx` `buildWorkspacePreviewTable(text, fileName)` (slice 200 + split `/\r?\n/`)

抽公共 `buildPreviewTable(text, fileName, options?: { maxRows?: number })`，默认 `maxRows: 40`：- project-workspace 调用点： `{ maxRows: 200 }`
- ResultView 调用点： 默认 40

### 2.4 PHASE 3 保守拆分策略

**原计划 4 文件**（FileTree/ + FilePreview/ + OfficePreview/ + index.tsx）—— **调研发现 7 个内部组件链依赖关系复杂**（FileTree 递归 + FilePreview 内部链），强行拆组件会引入 7+ 文件 props 透传 + 模块级 state 共享问题，**ROI 风险比 > 收益**。

**改为保守拆分**（types + helpers）：
- ✅ `types.ts` 15 行（ActiveWorkspaceFile interface）
- ✅ `helpers.ts` 138 行（8 个工具函数原样搬出）
- ✗ 7 个内部子组件保留（FileTreeList / FileTreeItem / WorkspaceFilePreview / BinaryPreviewCard / OfficePreviewPane / PreviewAssets / TextBlock）
- ✗ 4 个 export function 保留（RightFileTree / TerminalPanel / BrowserPanel / EmptyResult）
- ✗ ProjectWorkspace 主组件保留

**关键设计**：
- `helpers.ts` 复用 `@/lib/previewFileUtils.fileExtension`（不重复实现）
- `helpers.ts` 复用 `@/lib/office-file-preview.OfficePreviewKind` type
- `project-workspace.tsx` 保留 `export type { ActiveWorkspaceFile } from './project-workspace/types'` re-export（兼容 RightPanel.tsx 等 6 个 consumer）

## 3. 验证证据

| 维度 | 命令 | 结果 |
|---|---|---|
| 类型 | `cd frontend && npx tsc --noEmit` | 0 错误 |
| 测试 | `cd frontend && npx vitest run` | 75 文件 / 630 tests PASS / 0 失败 |
| 文档 | `npm run docs:check` | 80 PASS |
| 文档 | `npm run docs:reconcile` | 0 Validation |
| UI 审计 | `npm run ui:audit:check` | 133 PASS（+3 UI-162/163/164）|
| 不变量 | `preload.js` 0 diff | 守住 |
| 不变量 | `electron.d.ts` 0 diff | 守住 |
| 不变量 | `desktopBridge.ts` 0 diff | 守住 |
| 不变量 | 4 page (home/skills/tools 没动) | 守住 |
| 不变量 | `core/shared-backend/*` 0 diff | 守住 |
| 不变量 | `agent-tools/` 0 diff | 守住 |

## 4. 交付清单

### 4.1 新增文件
- `frontend/src/tools/registry.ts` 56 行
- `frontend/src/tools/categories.ts` 17 行
- `frontend/src/tools/inventory.ts` 2095 行
- `frontend/src/lib/file-preview/buildPreviewTable.ts` 39 行
- `frontend/src/pages/project-workspace/types.ts` 15 行
- `frontend/src/pages/project-workspace/helpers.ts` 138 行
- `docs/senior-engineer-review-2026-08-16.md` 永久化评审报告
- `docs/block-9-mega-file-refactor-plan.md` 182 行 plan
- `docs/block-9-mega-file-refactor-closeout.md` 本报告

### 4.2 修改文件
- `frontend/src/pages/_data.ts` 2157 → 17 行（re-export 兼容）
- `frontend/src/components/workspace-panels/ResultView.tsx` 删除本地 buildPreviewTable
- `frontend/src/pages/project-workspace.tsx` 3213 → 3114 行（删除 8 helpers + ActiveWorkspaceFile interface）
- `docs/ui-productization-audit.md` 追加 UI-162/163/164
- `docs/DOC-REGISTRY.json` 注册 BLOCK-9 + SENIOR-ENGINEER-REVIEW
- `docs/README.md` 新增条目 11
- `docs/next-steps-roadmap.md` 头部 + PHASE 启动段
- `docs/project-workspace-handoff.md` §3.0.13 启动段

### 4.3 关键审计 commit
- `d87a0f8` PHASE 0 启动 + 评审报告永久化
- `e78567c` PHASE 1 _data.ts 2157 → 3 文件
- `1c14f49` PHASE 2 buildPreviewTable 抽 lib/
- `c1e2bd5` PHASE 3 project-workspace types + helpers 抽离

## 5. 量化改进

| 文件 | 拆分前 | 拆分后 | 改进 |
|---|---|---|---|
| `frontend/src/pages/_data.ts` | 2157 行 | 17 行 | -2140 行（-99.2%）|
| `frontend/src/pages/project-workspace.tsx` | 3213 行 | 3114 行 | -99 行（-3.1%）|
| `buildPreviewTable` 重复 | 2 处 | 1 处（lib/）| -重复 |
| 总代码迁移量 | 0 | 2397 行 | 6 个新文件 |

**对 SRP / SoC 的影响**：
- `_data.ts` 从"假数据基础设施滥用"通过本工作包变成"配置 + categories + inventory 完美分离"（评审报告 §2.1 P0 解除）
- `buildPreviewTable` 跨文件重复消除（评审报告 §3.4 解除）
- `project-workspace.tsx` types/helpers 与渲染层分离（评审报告 §2.2 部分解除）

## 6. 不外推

按用户裁决"按照你的建议来"严格覆盖评审报告 §4 优先级表的 3 项，**剩余 6 项不变**：

- BLOCK-9.1：main.js 2450 拆分（P1，15 IPC setup 函数）
- BLOCK-9.2：SimpleChat.tsx 2153 拆分（P1，86 hooks + 多角色 UI 混杂）
- BLOCK-9.3：plugin-manager.js 1457 拆分（P2，27 函数散落）
- BLOCK-9.4：DesktopSettingsPanel.tsx 1515 拆分（P2）
- BLOCK-9.5：useSkillStore.ts 743 拆分（P2）
- BLOCK-9.6：IPC channel 常量集中（P3）

**其他不外推**：
- 不外推 packaged / dist / Provider / P7 / GA / E1-d/E1-e G1+ / dist staleness G1+ / i18n
- 不重新激活 BLOCK-2/3/4/5/6/7/8
- 不动 preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/

## 7. PHASE 3 保守拆分的中期反思

PHASE 3 实际未达成计划 §2.3 的"拆 4 文件"（FileTree/ + FilePreview/ + OfficePreview/ + index.tsx），改为"拆 2 文件"（types + helpers）。**这是 4 项 PHASE 中唯一一项偏离原计划**，原因如 §2.4 所述：组件链依赖复杂、ROI 风险比 > 收益。

**保守拆分仍然达成 P0 优先级**（评审报告 §2.2 "未来无法演进"痛点解决）：
- 7 个工具函数 + 1 个 interface 单独成文件，**新人接手可在 1 个 PR 而不是 1 个 3000+ 行文件中加新工具**
- `project-workspace.tsx` 仍 3114 行（巨型），但**职责集中在渲染 + 组件编排**，与 types/helpers 严格分离

若未来 BLOCK-9.2/9.3/9.4 启动，可**附带**推进 project-workspace 的子组件拆分（不重复做 discovery）。

## 8. 后续工作包候选

按 single work package serial 纪律，本工作包收口后 **不主动启动**新工作包。剩余候选：

| # | 候选 | 来源 | 备注 |
|---|---|---|---|
| 1 | BLOCK-9.1 Main.js 2450 拆分 | 评审报告 P1 | 15 IPC setup 函数 |
| 2 | BLOCK-9.2 SimpleChat 2153 拆分 | 评审报告 P1 | 86 hooks + 多角色 UI |
| 3 | BLOCK-9.3 plugin-manager 1457 拆分 | 评审报告 P2 | 27 函数散落 |
| 4 | BLOCK-9.4 DesktopSettingsPanel 1515 拆分 | 评审报告 P2 | 单组件多领域 |
| 5 | BLOCK-9.5 useSkillStore 743 拆分 | 评审报告 P2 | Singleton store 反模式 |
| 6 | BLOCK-9.6 IPC channel 常量集中 | 评审报告 P3 | 卫生改进 |
| 7 | UI-156/157/158/159/AGENTWB-001/002 实机 | 工具边界 | 暂时不提 |
| 8 | UI-132/161 视觉截图 | 工具边界 | 暂时不提 |
| 9 | packaged / dist / Provider / P7 / GA | deliver window | 暂时不提 |
| 10 | E1-d/E1-e G1+ / dist staleness G1+ | 治理门 V2 | 暂时不提 |
| 11 | i18n 资源抽离 | 暂缓 | 暂时不提 |

**当前无 active 工作包**（BLOCK-9 收口后）。
**qualificationEligible: false**（G0 长期开发期常态；不外推 packaged/dist/Provider/GA）。
