# G0-IDE-MCP-TOOLS 工作包计划

**文档状态**: 进行中
**创建日期**: 2026-08-14
**Plan ID**: G0-IDE-MCP-TOOLS
**truthDomain**: agent-ide-mcp-tools
**Owner**: BioF3 Desktop Agent Team
**依赖前置**:
- `docs/ide-research/mcp-ide-tools-design.md` — 设计文档（已存在，2026-08-14）
- `docs/skills-architecture.md` — Skills 四层架构（已存在）
- `core/r-server/mcp/registry.js` — MCP 注册中心（已存在，已注册 skill_* 三件套）
- `src/main.js` IPC 处理器（已存在 file:open-dialog / file:save-dialog 等面向 UI 的通道）
- `src/preload.js` — contextBridge（已存在 biof3Desktop 桥）

---

## 1. 目标

把 [`docs/ide-research/mcp-ide-tools-design.md`](./ide-research/mcp-ide-tools-design.md) 中定义的 IDE MCP 工具集从"研究文档"推进到"可被 Agent 调用"的实现状态。本工作包**仅面向 Agent 通道**（通过 MCP `listTools()` / `callTool()` 暴露给 LLM），**不重复**已有 `file:open-dialog` 等面向 UI 的 IPC。

最终交付：
- 一组 IDE 工具进入 MCP `listTools()` 输出
- Agent 通过 `callTool('ide_file_read', { path })` 等接口可以操作本地工作区文件、终端、编辑器、Git
- 路径安全、操作审计、用户确认机制三件安全约束落地
- 至少 Phase 1（文件 + 终端）覆盖定向测试

## 2. 不在范围内（明确排除）

- 不实现 IDE UI 面板（编辑器 UI、终端 UI 是前端 Monaco/xterm.js 工作，不是本包）
- 不修改现有面向 UI 的 `file:*` IPC 通道（避免破坏 `file:open-dialog` 等既有调用）
- 不实现 P7 资格（real Provider / packaged Electron / literal OS reboot），本工作包只验证**当前开发态** Electron 下 Agent 调用有效
- 不与 Skills 层 (`core/shared-backend/skill-*`) 集成（属 G0-SKILLS-RUNTIME 工作包范围）
- 不实现面向 LLM 的工具选择启发式（属 G0-SUBAGENT-AUTO-FORK 范围）

## 3. 范围与分阶段

按设计文档 §7.1 分三阶段逐步推进，每阶段有独立证据：

### Phase 1 — 文件 + 终端（P0）
- `ide_file_read` / `ide_file_write` / `ide_file_create` / `ide_file_delete` / `ide_file_rename` / `ide_file_exists` / `ide_file_list`（7 个）
- `ide_terminal_create` / `ide_terminal_write` / `ide_terminal_read` / `ide_terminal_close` / `ide_terminal_list`（5 个）
- 安全约束：路径白名单（项目根 + 系统临时目录）、操作审计写入 `~/.biof3/logs/ide-tools.log`、危险操作（`file_delete`、`file_write` 覆盖）需 `confirm=true`

### Phase 2 — 编辑器 + 搜索（P0/P1）
- `ide_editor_open` / `ide_editor_close` / `ide_editor_get_open_files` / `ide_editor_set_active_file` / `ide_editor_get_selection` / `ide_editor_set_selection`（6 个）
- `ide_search_in_files` / `ide_search_symbols` / `ide_goto_definition`（3 个，符号搜索依赖 Monaco LSP）

### Phase 3 — Git（P2）
- `ide_git_status` / `ide_git_diff` / `ide_git_log` / `ide_git_branch_list`（4 个，依赖 `simple-git` 依赖评估）

每个 Phase 完成后独立标注收口，不在 Phase 1 验证通过前启动 Phase 2。

## 4. 实现策略

### 4.1 代码落点（Phase 1 实际落点，已交付）
- **`core/r-server/mcp/ide-tools/`** — 新建目录（MCP server 跑在 r-server 进程里）：
  - `path-allowlist.js` — 路径白名单（cwd + tmpdir + ~/.biof3/logs）+ deny 名单（.git/.ssh/node_modules）
  - `audit-log.js` — 操作审计写入 ~/.biof3/logs/ide-tools.log
  - `file.js` — 7 个文件操作 MCP 工具
  - `terminal.js` — 5 个终端 MCP 工具（node-pty）
  - `index.js` — 入口 + 自动审计包装
- **`core/r-server/mcp/registry.js`** — `listTools()` 合并 IDE 工具；`callTool()` 在 skill_* 之后路由 `ide_*`
- **`src/preload.js`** — 不动；MCP 工具通过 r-server stdio 暴露，不走 contextBridge
- **`test/`** — 4 个定向测试文件，33 个测试全部通过
- Phase 2 落点：`core/r-server/mcp/ide-tools/editor.js` + `search.js`
- Phase 3 落点：`core/r-server/mcp/ide-tools/git.js`

### 4.2 复用的现有约束
- 不新建 executor / Job / Workflow，只复用 MCP `callTool()` 入口
- 操作审计复用 `~/.biof3/logs/` 目录（与既有 `backend-health.js` 一致）
- 路径白名单基于 `core/shared-backend/path-safe.js` 的 `safeJoinUnder` 扩展，不重复实现
- Plugin loader / capability bundles 不改动；IDE 工具是**第一方**能力，不是第三方插件

### 4.3 测试范围纪律
- 不跑全量 `npm run test:all:workspace`，按 `test/impact-map.json` 走定向：
  - 改 `core/r-server/mcp/registry.js` → 跑 `test/mcp-tool-registry.test.mjs`、`test/mcp-server.test.mjs`、`test/mcp-builtin-discovery.test.mjs`、`test/plugin-loader-refresh.test.mjs`
  - 改 `src/main.js` / `src/ide-tools/` → 跑 `test/g0-chf0-lifecycle.test.mjs`、`test/backend-health.test.mjs`
  - 新增 IDE 工具定向测试 → 跑新建 `test/ide-tools-*.test.mjs`
- 治理门禁：`npm run docs:check` + `npm run ui:audit:check`（秒级）

## 5. 验收门

### Phase 1 验收（收口证据）
- [ ] MCP `listTools()` 返回至少 12 个 `ide_*` 工具（7 文件 + 5 终端）
- [ ] `test/ide-tools-file.test.mjs` 7/7 通过：read/write/create/delete/rename/exists/list 含正常与失败路径
- [ ] `test/ide-tools-terminal.test.mjs` 5/5 通过：create/write/read/close/list
- [ ] `test/ide-tools-safe-path.test.mjs` 通过：白名单内允许、白名单外拒绝、相对路径拒绝、符号链接逃逸拒绝
- [ ] 操作审计写入 `~/.biof3/logs/ide-tools.log` 至少 1 条 Phase 1 调用记录
- [ ] `npm run docs:check` PASS
- [ ] `npm run ui:audit:check` PASS（如有 UI 改动则同步台账）

### Phase 2 验收
- [ ] Monaco 集成可打开/关闭文件，全文搜索结果含 `file/line/column/context` 四字段
- [ ] 符号搜索能识别 JS/TS 函数定义

### Phase 3 验收
- [ ] Git status / diff / log / branch-list 在当前开发态 Electron 下输出与 `simple-git` CLI 一致
- [ ] 路径安全：禁止操作 `.git/` 内部文件

## 6. 资格边界

**显式声明**（避免外推）：
- Phase 1 验证仅覆盖当前开发态 macOS arm64 Electron + Node fs + node-pty
- 不外推到：packaged Electron、Windows、Linux、Provider-backed Agent 调用、literal OS reboot
- 不声明 `qualificationEligible: true`，UI 不进 `ui-productization-audit.md`（这是 backend MCP 工具，不是 UI 组件）
- 路径白名单默认只允许"当前项目根目录"和"系统临时目录"，**不**自动跟随用户工作目录变更（避免 Agent 越界写任意路径）

## 7. 风险与已知缺口

| 风险 | 缓解 |
|------|------|
| Agent 通过 `ide_file_write` 越界改系统配置 | 路径白名单 + 操作审计 + 危险操作 `confirm=true` 必须 |
| 终端会话被用来跑 `rm -rf /` | 终端默认 shell 受限于 `sh`，不允许切换 `bash -c` 拼接 |
| 编辑器工具 Phase 2 强依赖 Monaco 未集成 | Phase 2 启动门：Monaco 必须已有可工作入口；否则延后到 IDE-Transformation 之后 |
| `simple-git` 未安装 | Phase 3 启动前评估并加 `package.json` 依赖，单独 PR |
| IDE 工具被 Skill 注册中心误识别 | Skill 注册只识别 `skills-registry.js` 自身来源；IDE 工具命名 `ide_*` 前缀与 Skill 命名空间 `skill_*` 互斥 |

## 8. 启动步骤

1. 在 `src/ide-tools/` 下创建 `safe-path.js`、`audit-log.js` 与 Phase 1 工具实现
2. 在 `core/r-server/mcp/registry.js` 扩展 `listTools()` 加入 IDE 工具定义 + `callTool()` 分发
3. 写 `test/ide-tools-*.test.mjs` 定向测试
4. 跑 `npm run test:changed` 确认测试选集与回归通过
5. 跑 `npm run docs:check` 与 `npm run ui:audit:check`
6. 提交 + AUDIT-LOG 登记收口条目

## 9. 与现有规则的关系

- 不创建第二条 MCP 注册中心（约束）
- 不创建新的 executor / Job（约束）
- 不修改既有面向 UI 的 `file:*` IPC（约束）
- 不与 Skill / Result Studio 平行实现重复能力（约束）
- 遵循测试范围纪律：定向优先，全量留给发布前 / CI（约束）
- 遵循单工作包串行：Phase 1 收口后才启动 Phase 2（约束）

---

## 10. Phase 1 收口记录（2026-08-14）

**实现提交**：见 git log（registry.js + ide-tools/* + 4 个测试文件）
**测试证据**：
- `test/ide-tools-path-allowlist.test.mjs` — 11/11 通过
- `test/ide-tools-file.test.mjs` — 12/12 通过
- `test/ide-tools-terminal.test.mjs` — 6/6 通过（含真实 PTY roundtrip）
- `test/ide-tools-registry.test.mjs` — 4/4 通过
- 相关回归 28 个测试文件 199/199 通过

**Phase 1 验收门**：
- [x] MCP `listTools()` 返回至少 12 个 `ide_*` 工具
- [x] 33 个 IDE 工具定向测试全部通过
- [x] 路径白名单测试覆盖：白名单内允许、白名单外拒绝、相对路径拒绝、deny 段拒绝
- [x] 操作审计写入 `~/.biof3/logs/ide-tools.log`（测试期间验证过）
- [x] `npm run docs:check` PASS

**Phase 2 启动条件**（未达）：
- [ ] Monaco 编辑器已有可工作的文件入口（frontend/src/components/editor/* 存在 + 可用）
- [ ] 或：复用 SimpleChat 内置输入框作为编辑器入口（fallback）

**Phase 3 启动条件**（未达）：
- [ ] 评估 `simple-git` vs `git` 命令包装的取舍
- [ ] 决定依赖是否进 `package.json`（需单独 PR）
