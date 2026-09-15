# BLOCK-89-WORKSPACE-FILE-OPS 工作包计划 — 工作区文件树全能力文件操作（本地/远程全对齐）

> 状态：completed / 整包收口（2026-09-15，P0–P3 一次会话完成；P3 实机 14/14 allPass，证据 `acceptance/block-89/`）
> 用户裁决原话：「我觉得要新开一个全新的工作包  本地和远程都具备全能性能力  不要有区分  你来适配 能否做到呢」
> 评估结论已向用户呈报：**能做到**——gateway 文件面 list/read/write/stat/mkdir/mv/rm 两后端已就绪，唯一缺口 cp（双后端各补一个薄方法）+ REST 暴露 + 前端交互层。
> §6 门禁对账（收口实测）：契约测试 21/21（workspace-file-ops 9 + node-agent fs 含 fs_cp）+ 相邻 block67-routes/block73/data-import 11 过 1 skip；前端 fileOps 7/7 + 受影响面 57/57 + tsc 0；实机 flow `workspace-file-ops` 14/14 allPass；hygiene/docs:check 240/ui:audit PASS；test:changed 聚合被既有 scratch `obs.tmp.cjs`（非本包文件面）卡分类冲突，按其指引定向直跑全部 9 项受影响 Node 测试 + 前端受影响面（2 红=P6 源绑定 D8 例外基线 HEAD 同败，重采属 G0-RS）。

## 0. 责任边界与 Plan ID

- **新建 Plan ID**：`BLOCK-89-WORKSPACE-FILE-OPS`（独立责任与验收边界：工作区文件操作能力面；非任何既有包增量）。
- BLOCK-88（工程师协作）维持排队不动；本包占用 active 槽位（启动时槽位空闲）。
- UI 增量预登记：**UI-378 工作区文件树文件操作**（右键菜单 + 拖拽 + 弹层）。

## 1. 代码事实基线（2026-09-15 复核）

| 事实 | 位置 | 状态 |
| --- | --- | --- |
| gateway 文件面接口 `list/read/write/stat/mkdir/mv/rm`，local+ssh 双后端已实现 | `core/biof3-server/helpers/workspace-gateway.js:96-158（ssh）/242-278（local）` | ✅ 就绪 |
| node-agent fs verbs（POSIX shell，版本哈希 ensureAgent 自动部署） | `core/biof3-server/helpers/remote-execution/node-agent.js` | ✅ 就绪，缺 `fs_cp` |
| REST 仅有 tree/file 读 + SSH PUT 写 + import/upload | `core/biof3-server/routes/files.js` | ❌ 无 move/copy/delete/mkdir 暴露 |
| 前端文件树纯只读（每行 button，点击=预览/展开），无右键菜单/拖拽/删除入口 | `frontend/src/pages/project-workspace/FileTreeItem.tsx` / `RightFileTree.tsx` | ❌ 待建 |
| 路径安全 `safeJoinUnder`+realpath（local）/ `safeRemoteJoin`（ssh） | `routes/files.js:85-96` / `workspace-gateway.js:23-33` | ✅ 就绪 |
| 刷新机制：local 2s 轮询 + `projectWorkspaceChanged` 事件 + 手动刷新 | `RightFileTree.tsx:106-128` | ✅ 就绪 |
| 右键菜单先例 | `frontend/src/components/branch/BranchTabs.tsx` onContextMenu | ✅ 有房风 |

## 2. 设计裁决

- **D1 一套 REST 端点双后端同构**：`POST /api/workspaces/:projectId/fs/move|copy|delete|mkdir`，全部 `requireTrustedDesktopOrigin` + 按 `workspaceKind` 走 `resolveWorkspaceBackend`（与 tree/file 路由同构）；前端零感知 workspaceKind。
- **D2 能力对齐补 cp**：local 后端加 `cp`（`fsp.cp` recursive）；ssh 后端加 `cp`（node-agent 新 verb `fs_cp` = `cp -R`，版本哈希变更自动重部署，无需手动）。
- **D3 删除语义统一**：确认后直接删除（用户裁决「不要有区分」→ 不引入本地回收站 `shell.trashItem` 特例通道；远程本无回收站）。EPERM/EBUSY（文件被占用）等错误如实上报。
- **D4 冲突语义单一**：服务端目标已存在 → `409` 拒绝；拖拽等批量场景由前端预检目录清单自动 `-2` 后缀（对齐 `copyImportWithoutOverwrite` 房风），服务端不隐藏冲突。
- **D5 交互形态**：行级右键上下文菜单（重命名/移动/复制/删除/新建文件夹）+ HTML5 拖拽（拖到目录=移动，Ctrl+拖=复制）；删除需确认弹层。
- **D6 刷新走既有事件**：操作成功后 `dispatchGewuEvent(projectWorkspaceChanged)`，不建第二套文件变更真相（BLOCK-68 红线延续）。
- **D7 投影手机端桌面-only 先行**：REST 端点天然可后续接 mobile gateway，本期不做投影文件树（uninstall-plan 桌面-only 先例）。

## 3. 范围

### P1 后端能力对齐 + REST + 契约测试
1. `workspace-gateway.js`：local/ssh 两后端各补 `cp` 方法。
2. `node-agent.js`：新增 `fs_cp` verb（`cp -R`，语义对齐 `fs_mv`：目标父目录先建、错误单行 JSON）。
3. `routes/files.js`：新增 4 个 fs 操作端点（D1），路径边界/错误分类与既有路由同构（409 冲突 / 400 非法路径 / 404 不存在 / 502 远程连接失败 classified）。
4. 契约测试 `test/workspace-file-ops.test.mjs`：双后端 move/copy/delete/mkdir 全链 + 目录递归 + 越界路径负例 + 409 冲突 + ssh 后端 mock/夹具。
5. `test/impact-map.json`：登记新增测试与 acceptance 目录映射。

### P2 前端 UI-378
1. `FileTreeItem.tsx`：行级 onContextMenu + 拖拽（draggable、drop 目标高亮、Ctrl+拖=copy）。
2. 右键菜单组件（房风 BranchTabs）：重命名 / 移动 / 复制 / 删除 / 新建文件夹。
3. 确认弹层（删除）+ 目标路径选择（移动/复制）+ 重命名输入；409 冲突提示与自动后缀。
4. 操作成功 → `projectWorkspaceChanged` 派发；错误 toast/行内提示。
5. 组件测试（`*.test.tsx`，mock gotcha 遵循 endsWith 匹配纪律）+ `docs/ui-productization-audit.md` UI-378 登记。

### P3 实机验收 + 收口
1. dev-verify flow `workspace-file-ops` 登记（`.agents/skills/gewu-dev-infra/dev-verify/`）。
2. 实机断言链：本地项目 mkdir→（写文件）→move→copy→delete 全链 + 树刷新事件生效 + 409 冲突；证据 `acceptance/block-89/`。
3. 远程（ssh）证据等级：契约测试覆盖双后端同构语义；真节点（aliyun/dell，BLOCK-67 资产）可达则加实机远程链，不可达则如实登记「ssh 面以契约为证」。
4. 收口门禁：hygiene + docs:check + ui:audit:check + test:changed（fail-fast 聚合）。

## 4. 非范围（exclusions）

- 从 OS 资源管理器拖入文件导入工作区 / 拖出到 OS（候选池登记，另行立项）。
- 新建空文件（create-file）端点与入口。
- 本地回收站删除（D3 已裁决统一硬删）。
- agent WorkingTreeReview 与用户删档的冲突特殊保护（靠既有刷新收敛，v1 不做）。
- 投影手机端文件树与 fs 端点的 mobile gateway 对齐。
- packaged / Provider / GA 验证（G0 开发期常态，不外推）。

## 5. 依赖与环境纪律

- 0 新 npm 依赖（fsp.cp / cp -R 均平台内建）。
- 后端变更须重启 dev 栈（`scripts/restart-dev-stack.sh` 可从 agent shell 直接跑）；node-agent 变更经版本哈希 ensureAgent 自动部署。
- 并行包文件面隔离：G0-RS（Mac 侧 P4R）、BLOCK-85（双真机验收）均不在本机文件面；`obs.tmp.cjs` 为既往会话遗留观测探针 scratch，不触碰。
- 与 BLOCK-73（showHidden）、BLOCK-67（ssh gateway）同文件面但均已收口，无在制冲突。

## 6. 验收门禁预声明（收口对账用）

| 门禁 | 预期 |
| --- | --- |
| 契约测试 `test/workspace-file-ops.test.mjs` | 全绿（双后端 + 负例） |
| UI-378 组件测试 | 全绿 + tsc 0 |
| 实机 flow `workspace-file-ops` | allPass（证据 `acceptance/block-89/`） |
| docs:check / ui:audit:check / hygiene | PASS |
| test:changed | 影响范围内无新增红（存量例外如实归属） |

**完成语义**：P1–P3 全过 + 台账/registry 回写 + 提交推送 = completed；UI-378 实机过 = verified（dev Electron 边界内）。

## 7. 预期节奏

参照 BLOCK-86 节奏，一次会话 P0→P3 收口可期；P1/P2 可各自成提交。
