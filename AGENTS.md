# BioF3 Desktop 项目指令

本文件指导 AI Agent 理解和处理 BioF3 桌面版项目。

## 项目定位

BioF3 Desktop = Electron 桌面应用 + Vite SPA 前端 + MCP Server
本地化 AI 陪伴的全组学学习与实战平台

## 当前阶段纪律（最高优先级 · G0 长期开发期）

**项目当前长期处于 G0 开发期，不是发布期**。`docs/next-steps-roadmap.md` 已写明：

- `v0.0.1-rc.7` 是当前 OSS 线上工程候选版，**不是 GA / 正式发布版**
- `qualificationEligible: false` 是 G0 开发期的**常态事实**，不是缺陷、不是待办、不是下次校验需推动的事
- `Result Studio` 长期保持 `implemented_unverified / experimental`，RS-P7 deferred
- 真实 `Provider` 矩阵、`packaged Electron` 公证/签名、`OSS` 远程接手、`GA` 公证流水均属 G1+ 阶段，**当前阶段不校验、不实现、不视为缺口**

**Agent 纪律**：

1. **不得**主动建议或启动 `Provider / 公证 / GA / 远程发布 / dist staleness` 等 G1+ 工作 —— 这些是 G1+ 工作，不是当前 active 工作包候选
2. **不得**在收口报告、closeout 笔录、AUDIT-LOG 或 ui-productization-audit.md 反复写 "`qualificationEligible` 维持 false" / "未做 Provider" / "未做 GA" —— 这些是 G1+ 阶段事项，按当前阶段纪律是**不外推**而不是"待办"
3. **不得**把"`dev Electron / packaged Electron 三轴对齐"`描述为"待完成" —— 当前 G0 已收口的开发态 + packaged 实机核对是当前阶段的合理证据等级；`qualificationEligible` 升 `true` 需 G1+ 阶段
4. 收口笔录用语：直接写"G0 开发期常态 · 不外推 packaged/Provider/GA" 一句即可，**不**列举未做项
5. UI-AGENTWB-### 等前端工作包的状态标头：`dev Electron 边界内 verified` / `packaged 边界内 verified` 即为**当前阶段最高证据等级**，不需要补 G1+ 阶段才有的 Provider / GA
6. 用户若未明确裁决启动 G1+ 阶段，**禁止**主 Agent 主动提出"是否要做 Provider / GA / release-pipeline"

**变更 G1+ 阶段纪律需用户显式裁决**：用户当前已裁决"长期处于 G0 开发期"（2026-08-15），任何提前进入 G1+ 的提议都视作越权，必须先回到此节确认。

## 技术栈

| 层级 | 技术 | 入口文件 |
|------|------|----------|
| 桌面壳 | Electron | `src/main.js` |
| 前端 | React 18 + Vite + TypeScript | `frontend/src/` |
| 工具 | MCP Server | `src/mcp-server.js` |
| 数据库 | better-sqlite3 | `src/` |

## 开发命令

```bash
# Electron 开发
npm run dev          # 启动 Electron (npm run dev:electron)
npm run dev:electron # 带 --dev 标志

# 前端开发
cd frontend && npm run dev   # Vite dev server (:3000)
cd frontend && npm run build # 构建 SPA

# 全量构建
npm run build:all    # SPA + 站点
npm run build:mac    # macOS 构建
npm run build:win    # Windows 构建

# 检查
npm run docs:check   # 文档治理门禁（必跑，秒级）
npm run ui:audit:check  # UI 台账门禁（必跑，秒级）
npm run test:changed:list               # 根据 test/impact-map.json 预览影响范围
npm run test:changed                    # 运行影响范围内的定向测试（默认方式）
npm run test:files --prefix frontend -- <相关文件>  # 定向前端测试

npm run check        # 全量静态检查 + 所有门禁（默认不跑，留给发布前 / CI）
npm run test:all:workspace # 全量 Node + 前端测试（默认不跑，留给发布前 / CI）
```

## 架构要点

### 目录结构

```
desktop/
├── src/                    # Electron 主进程
│   ├── main.js            # 主进程入口 (61KB)
│   ├── preload.js         # 预加载脚本
│   ├── plugin-manager.js  # 插件管理器 (47KB)
│   └── mcp-server.js      # MCP 服务端
├── frontend/src/           # 渲染进程
│   ├── pages/            # 路由页面
│   │   ├── single-cell/  # 单细胞分析
│   │   ├── spatial/       # 空间转录组
│   │   ├── figcode/       # 可交互图表
│   │   └── admin/         # 管理面板
│   ├── components/       # React 组件
│   │   ├── copilot/       # AI Copilot
│   │   ├── desktop/       # 桌面特有
│   │   └── ui/            # 通用 UI
│   ├── hooks/             # React Hooks
│   ├── lib/               # 工具函数
│   │   └── desktopBridge.ts  # IPC 桥接
│   └── themes/            # 主题系统
├── test/                   # Electron 测试
└── core/                   # 核心后端（仓库内，已内联；r-server/py-server/shared-backend）
```

> 架构去耦（2026-07）：core 已从 vendor submodule 内联；OSS/PostgreSQL/docker 双模式已移除，
> 现为「本地文件存储 + SQLite + 内嵌运行时本地执行」。详见 `docs/dependency-decoupling-checkpoint.md`。

### 关键规范

1. **前端使用 TypeScript strict 模式**
2. **Electron IPC 调用必须通过 `lib/desktopBridge.ts`**
3. **MCP 工具在 `src/mcp-server.js` 注册**
4. **状态管理：React useState + 自定义 hooks，禁止使用 zustand**
5. **路由页面在 `pages/` 下，非页面组件用 `_` 前缀**

## AI 行为指引

### 模型与委派策略

- 主 Agent 使用 `gpt-5.6-sol`，负责规划、架构、需求存在歧义的决策、跨模块取舍与最终审查；实际模型由 Codex 当前任务的模型选择器或主配置固定，不能只依赖提示词切换。
- 对边界清晰、范围狭窄、可重复且能独立验证的任务，主 Agent 应主动委派给已注册的 `luna_worker`，例如定向测试、机械性代码调整、独立文件实现和只读核查。
- 每次委派必须明确任务范围、文件或职责所有权、预期输出、验证要求，以及不得回退或覆盖其他 Agent 改动的约束。
- 不把需求含糊、破坏性、安全敏感、治理裁决、紧密耦合或需要跨模块架构判断的工作委派给 `luna_worker`。
- 当主线依赖委派结果时，主 Agent 必须等待其完成，复核代码与验证证据后再集成和宣布结果；子 Agent 的完成声明不能代替主 Agent 终审。
- 多 Agent 委派只用于当前唯一 active 工作包内部的任务拆分，不得绕过“单工作包串行”纪律并行启动新的阶段或工作包。

### Codex / Claude Code 统一入口

- `AGENTS.md` 是所有 AI Agent 共用的唯一工程指令；Codex、Claude Code 和其他 Agent 不得各自维护第二套项目规范。
- `CLAUDE.md` 只作为 Claude Code 的兼容路由，必须指向本文件和同一组 canonical 文档，不重复保存当前阶段、分支、验收数量或工作包进度等易漂移事实。
- 所有 Agent 按同一顺序恢复当前状态：先读 `docs/AUDIT-LOG.md`，再核对 Git/运行时/Acceptance 证据，最后读取 `docs/next-steps-roadmap.md`、`docs/project-workspace-handoff.md` 和当前唯一 active 工作包。
- 当前阶段、下一步或资格状态发生变化时，只更新其 canonical 文档及必要台账；不得为了同步不同 Agent 而在 `CLAUDE.md`、临时 prompt 或聊天记录中复制一份状态。
- 若入口文件与 canonical 文档冲突，以 Git、SQLite、Artifact Truth、Acceptance Evidence 和 canonical 文档为准，先降级冲突声明并修复入口，不能任选对实现最方便的一份。

### 审计广播台（最高优先级）

- **每次会话开始时，必须先读 `docs/AUDIT-LOG.md`**，处理其中 🔴 阻塞项和 🟢 待合并项，再开始主线工作。
- 该文件是非主 agent（审计/辅助 agent）向主 agent 广播发现的唯一入口，包含代码质量问题、契约不一致、分支待合并等。
- 处理完成后，将对应条目状态改为 ✅ 并在"处理记录"登记。
- 非主 agent 完成新审计后，必须把发现追加到 `docs/AUDIT-LOG.md` 并提交，不要只写在单独报告里。
- `AUDIT-LOG.md` 只保存活跃广播；除非追溯具体问题，不读取 `docs/archive/` 中的历史审计账本。

### 项目治理与文档生命周期

- 创建或修改计划、Goal、工作包，完成阶段收口、Handoff、归档/替代文档，或创建/移除 Git Worktree 时，必须使用 `$biof3-project-governance`。该 skill 的 canonical 位置是 [`.agents/skills/biof3-project-governance/SKILL.md`](.agents/skills/biof3-project-governance/SKILL.md)；`.claude/skills/` 下的同名相对符号链接只为让 Claude Code 能发现它，不是第二份副本。
- 项目当前文档从 [`docs/README.md`](docs/README.md) 进入；完整规则见 [`docs/document-governance.md`](docs/document-governance.md)，机器目录见 [`docs/DOC-REGISTRY.json`](docs/DOC-REGISTRY.json)。
- 未运行 `npm run docs:reconcile` 并通过 `npm run docs:check`，不得宣布工作包 `completed`、`qualified`、`verified` 或已归档收口。
- 不得在存在未知 WIP 时批量移动、删除、暂存或提交文档；Acceptance 证据不得被普通文档归档替代。
- 当前状态必须回写 canonical roadmap/handoff/工作包，禁止多个 active canonical 计划宣称同一事实。
- 开发形态为**单工作包串行**：同一时间只有一个 active 工作包与一个进行中阶段，收口后才启动下一个。不并行开新工作包，不提前实现后续阶段。
- 当前不使用 Git Worktree（`G0-RS-WT0` 已 `deferred`，判据见 [`docs/g0-result-studio-plan.md`](docs/g0-result-studio-plan.md) §14）；Result Studio 在主工作区分支 `codex/g0-result-studio-product` 上开发。
- [`docs/worktree-governance.md`](docs/worktree-governance.md) 当前是休眠纪律：只有其中记录的重开条件成立才可创建 Worktree，且必须按该文件 §3～§8 执行，不得临时另立简化流程。

### 测试范围纪律（定向优先）

- 默认**只跑与本次改动相关的测试**，不跑全量 `npm run test:all:workspace`（1300+ 项，耗时数分钟）。
- 影响范围由 `test/impact-map.json` 维护，`npm run test:changed:list` 必须可复现；未知生产路径 fail-closed，直接升级为全量 Node/前端检查，不得静默漏测。
- 需要手工收窄时，使用 `node --test <files>` 或 `npm run test:files --prefix frontend -- <files>`；当前工作包专项门禁仍必须按计划执行。
- 当前工作包的专项门禁必须跑（例如 `npm run g0:result-studio:p3`），它是该阶段的收口依据。
- 治理门禁 `npm run docs:check` 与 `npm run ui:audit:check` 必须跑：它们是硬要求且只需数秒。
- 根 `npm run check` 与全量 `npm run test:all:workspace` 默认不跑，留给发布前或 CI。若因此存在未验证范围，必须在收口报告中如实说明，不得把定向通过表述为全量通过。

### UI 进度自动对账

- 不得把 `docs/ui-productization-audit.md` 中的旧状态直接当成未实现结论；先核对已有 Git 提交证据，避免重复开发。
- 每个 UI 增量必须在同一提交更新 `docs/ui-productization-audit.md`，并在提交标题或正文标注对应 `UI-###`。
- 实现完成、尚未实机验收的条目使用 `in_progress`；只有实机证据充分时才能使用 `verified`。
- 提交前运行 `npm run ui:audit:check`；根 `npm run check` 也会自动执行该门禁。

### 修改大型文件前

- `main.js` (61KB) — 先理解 Electron 进程模型和 window 管理
- `plugin-manager.js` (47KB) — 理解插件生命周期

### 新增功能检查清单

- [ ] 前端路由/页面 → 在 `frontend/src/pages/` 下创建
- [ ] Electron IPC → 通过 `preload.js` 暴露接口
- [ ] MCP 工具 → 更新 `src/mcp-server.js` 的 tool definitions
- [ ] 类型定义 → 在 `frontend/src/` 下创建 `*.types.ts`
- [ ] 测试 → 在 `frontend/src/` 同目录创建 `*.test.ts`

### 代码风格

- 组件：函数式 + 命名导出
- 样式：CSS Modules 或 `*.module.css`
- 工具函数：`lib/` 下按功能分组

## 相关文档

- `frontend/src/lib/desktopBridge.ts` — IPC 通信封装
- `src/mcp-server.js` — MCP 工具定义
- `frontend/src/App.tsx` — 应用入口
