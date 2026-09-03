# BLOCK-53 — 项目创建体验补丁：拖拽直达 + 一次性引导

> 状态：`planned`（候选，待用户裁决启动；当前 active 为 NONE，排队 BLOCK-51 之后）
> 立项日期：2026-09-03（用户裁决「做成一个独立的包」）
> truthDomain: `block-53-project-creation-ux`
> 来源：codex vs BioF3 新项目创建体验对比调研（本会话）

## 1. 背景

对比调研结论：codex「项目 = 目录」哲学下新项目 1 步（cd + 回车），BioF3 注册式 3-4 步（点+ → 选目录 → 确认面板 → 创建）。差异属终端工具 vs GUI 工作台的属性不同，**不改注册哲学，做体验补丁降低仪式感**——拖拽直达 + 一次性引导。

### 1.1 BioF3 现状（调研锚点）

- 创建主流程：`frontend/src/pages/home.tsx` L120-213（openDirectoryDialog → pendingWorkspace 确认 → createProject → 跳转 `/project/{id}`）

- 后端：`core/biof3-server/api-data.js` L205 `db.createProject({..., workspacePath})`——只注册路径，不建 git 不建文件

- 非 git 项目审阅为诚实空态（BLOCK-32 `project_workspace_not_git`）

- 多入口并存：目录选择 / 手动路径（UI-257）/ 应用内选择器（UI-259）/ 空白项目（UI-258）

## 2. 方案（两个补丁）

### P1 — 拖拽目录直达创建

- 首页（及项目工作台左栏「+」面板）支持**拖拽系统目录到窗口**：Electron `will-navigate`/`drop` 事件拦截 OS 文件拖入

- 拖入目录 → 直接进入既有 `pendingWorkspace` 确认面板（完整路径 + 项目名 + 在此处创建/重新选择）——**复用 UI-253 既有确认链路，不绕过确认**（拖拽降低的是「打开系统选择器」的成本，不降低确认安全性）

- 目录校验复用 `file:validate-directory` IPC（src/ipc/file-dialog.js L78-129 既有）

- 拖入非目录文件（单文件）→ 忽略或轻提示

### P2 — 非 git 目录一次性引导

- 进入项目页时若 workspace 非 git 仓库：一次性内联引导条「初始化 git 仓库以启用审阅与版本历史」（**一次性**：dismiss 后记录偏好不再弹，对齐 codex 信任屏「每目录只弹一次」哲学）

- 点击 → 复用既有 git 能力在 workspace 执行 `git init` + 初始提交（走后端既有 git 通道；确认面板明示将创建 `.git`）

- 引导条状态存储：本地偏好（localStorage 或 settings），不改 projects 表结构

- 非 git 空态（BLOCK-32 诚实空态）保持为引导后的稳态兜底——引导是可选加速，不是强制

### 非范围

- 不改注册式项目模型（projects 表 / workspace\_path 语义不动）

- 不做目录结构模板自动发现（生信目录识别——留候选）

- 不做项目列表与磁盘的同步扫描

- 0 新 npm 依赖 / 0 新 IPC（P1 用 Web 标准拖放事件 + 既有 validate-directory；P2 若 git init 需新只读通道则最小面新增）

## 3. 阶段

- **P0 立项**：本计划 + DOC-REGISTRY + roadmap/README + AUDIT-LOG 登记。

- **P1 拖拽直达**：首页 + 左栏面板 drop 处理 → pendingWorkspace 确认链复用；vitest（drop 事件→确认面板状态机）。

- **P2 git init 引导**：非 git 检测（复用 BLOCK-32 既有检测链）+ 一次性引导条 + git init 执行通道；vitest（引导出现/一次性记忆/init 调用）。

- **P3 门禁**：定向 vitest + tsc + `docs:check` + `ui:audit:check`；新 UI 编号同提交登记台账。

- **P4 dev Electron 实机**：拖拽真实目录创建项目全链路 + 非 git 项目引导 init 后审阅可用；证据 `acceptance/block-53/`。

- **P5 收口**：台账回写 + registry completed。

## 4. 验收门

- P1：拖拽目录 → 确认面板出现且路径正确 → 创建成功跳转；拖拽单文件无副作用；既有四条创建路径（UI-257/258/259 + 目录选择）零回归。

- P2：非 git 项目首次进入见引导条 → init 后消失且审阅可用；dismiss 后不再出现；既有 git 项目不出现引导。

- 治理：`docs:check` + `docs:reconcile` 收口必跑。

- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 风险与对策

| 风险                         | 对策                                            |
| -------------------------- | --------------------------------------------- |
| Electron 窗口拖放默认行为（导航到文件路径） | P1 实施时在窗口级阻止默认 will-navigate/drop，仅白名单首页与左栏面板 |
| git init 于含敏感内容目录的用户顾虑     | 确认面板明示动作内容；一次性引导不自动执行                         |
| 拖拽与既有粘贴/拖放附件（composer）事件冲突 | P1 限定 drop 监听挂载区域（首页/左栏），不进 composer          |

## 6. 进度记录

- 2026-09-03 P0（planned 登记）：用户裁决独立立项；方案源自 codex（1 步创建 / 信任屏一次性 / agents\_md 自动发现）vs BioF3（注册式 3-4 步）对比调研——取「降低仪式感」两补丁（拖拽直达 + 一次性引导），不改注册哲学；本计划落盘并注册 DOC-REGISTRY；排队 BLOCK-51 之后。

