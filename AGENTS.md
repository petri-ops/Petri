# Petri Desktop（格物）项目指令

本文件指导 AI Agent 理解和处理 Petri（格物，原名 Petri）桌面版项目。

## 项目定位

Petri Desktop（格物，原名 Petri）= Electron 桌面应用 + Vite SPA 前端 + MCP Server
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

## 产品个性纪律（对标不改魂 · 2026-10-12 用户裁决，需时刻警醒）

> 用户裁决原话：「避免成为另一个 Zcode 或者 codex 呀 保留自己的特色 借鉴他们的优点」

- **魂（永不丢，是 Petri 区别于通用 agent 的身份）**：①**通用 agent 能力是主线核心**——编排 / 知识 / 工具 / 模型计量 / 可靠性五维（G0 成熟度蓝图）是最核心开发重点，议程不因对标收缩；②**本地主权**——agent 本体（推理循环 / 工具 / 记忆 / 编排）全链跑在用户机器上，断网可用、无厂商中继、全链可审计（Codex/ZCode 的核心链路在云端，这是通用能力维度上 Petri 的第一优势形态）；③**可信与透明即能力**——治理（动态审批 / 用户规则 / ack 审计）、编排（事件驱动 / 队列 / 水位续传 / 血缘）、证据自证（探针 / 实机验证文化）不是合规负担，而是"值得托重的 agent"的差异化卖点；④**场景资产**（全组学 / artifact plane / Gen UI 数据面）是优势放大器与锚点之一，不是唯一锚点。
- **形（可借，照常吸收）**：对标产品（ZCode/Codex）的交互范式、质感基线、沙箱可视化、审批 UX、传输范式——先例=BLOCK-55（plan 模式）/159/162/164/166/167；借来的形必须长出自己的形态优势（上②③），不做无差别的形态复刻。
- **立项自检问句（新工作包发令前主代理必过）**：「这个能力的形态与 ZCode/Codex 的差别在哪？本地可审计 / 治理透明 / 证据自证体现了吗？」——问句用于防"照抄通用形态"，**不用于砍通用能力主线**；答不出差别形态的，先想清楚自有形态再立项。
- 与 2026-09-26 BLOCK-122 裁决同向：通用编码面（agent 通用能力）就是开发主线。

## 技术栈

| 层级   | 技术                           | 入口文件                                                       |
| ------ | ---------------------------- | ---------------------------------------------------------- |
| 桌面壳  | Electron                     | `src/main.js`（装配入口，实拆于 `src/main/` + `src/ipc/`）       |
| 前端   | React 18 + Vite + TypeScript | `frontend/src/`                                            |
| 工具   | MCP Server                   | `src/mcp-server.js`（仅 stdio 壳）→ 工具真实注册在 `core/petri-server/mcp/registry.js` + `core/petri-server/agent-tools/` |
| 数据库  | better-sqlite3               | 桌面侧 `src/database/` + 迁移 `src/migrations/`；后端侧 `core/petri-server/db/` |

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

# 代码质量与安全门禁（BLOCK-105，已入 closeout 链）
npm run quality:secret  # 密钥泄漏扫描（fail-closed：生产面命中即红）
npm run quality:arch    # 架构规则（dependency-cruiser：IPC 必经 desktopBridge / 前后端边界 / 依赖方向）
npm run quality:lint    # ESLint blocking（存量在 eslint-suppressions.json 抑制基线，新增违规即红）
npm run quality:types   # 前端类型门禁（tsc --noEmit -p frontend/tsconfig.json；fail-closed：任何类型红即红）
npm run quality:knip    # 死代码扫描（report-only 全量报告：core 懒 require 盲区，数字属上界）
npm run quality:knip:check # 死代码保留面棘轮（CK-11 收官冻结：exports/types/files 逐键基线 test/knip-baseline.json，新增即红；清理后 --update 下调）
npm run quality:baseline # P0 四项体检基线重扫（Knip/jscpd/audit/密钥，报告落 acceptance/block-105/）

# 开发基础设施（BLOCK-71）
npm run state        # 会话状态一键恢复：分支/WIP/AUDIT-LOG 未决项/active 工作包
npm run audit:compact  # AUDIT-LOG 自稳（BLOCK-170）：「最后更新」链/处理记录表超窗行自动剪切归档（搬移不改写，幂等）；closeout 首步自动执行
npm run hygiene:check   # 工作区卫生：死符号链接 + 临时残留 + 换行漂移 + 符号链接检出退化 + 文本源码控制字节（只报告不代删）
npm run closeout     # 收口门禁聚合（fail-fast）：audit:compact(自稳先行) → hygiene → docs → ui-audit → test:changed → gate:code-size → gate:arch-cycles → quality:secret → quality:arch → quality:lint → quality:types → quality:knip:check（十一门）
npm run verify -- <flow> # dev-verify 实机校验 flow（--list 查清单；前置 dev 栈在跑）
npm run skills:check    # 产品 Skill 契约校验（resources/skills/）
```

## 架构要点

### 目录结构

```
desktop/
├── src/                    # Electron 主进程（72 个 .js）
│   ├── main.js            # 装配入口（686 行；历史巨型文件已拆分，勿按 61KB 旧账理解）
│   ├── main/              # 主进程职责模块（窗口/后端进程/插件加载/品牌/CSP…17 文件）
│   ├── ipc/               # IPC handler 按域拆分（20 文件）+ channels.js = 通道唯一注册表
│   ├── preload.js         # 预加载脚本（自包含字面量，不 require 本地模块）
│   ├── migrations/        # 桌面侧 SQLite 迁移（NNN_*.sql，由 migration-runner.js 应用）
│   ├── database/          # 桌面侧库访问（如 result-db.js）
│   ├── plugin-manager.js  # 插件管理器（562 行，生命周期见 src/main/_plugin-loader.js）
│   └── mcp-server.js      # MCP stdio 壳（协议层，工具实体在 core 侧 registry）
├── frontend/src/           # 渲染进程（84k 行 TS/TSX）
│   ├── pages/            # 路由页面：home / knowledge / plugins / project-workspace /
│   │                     #   result-studio / settings / skills / window（+ review.tsx 等顶层页）
│   ├── components/       # React 组件（162 个 .tsx）：copilot / desktop / workspace-panels /
│   │                     #   knowledge / result-studio / window / ui / editor / settings / …
│   ├── hooks/             # React Hooks
│   ├── lib/               # 工具函数
│   │   └── desktopBridge.ts  # IPC 桥接
│   └── themes/            # 主题系统
├── test/                   # Node 侧测试（317 个 .test.mjs，前端测试住在 frontend/src 同目录）
└── core/                   # 核心后端（仓库内，已内联）：petri-server / shared-backend / packages
```

> 路由实际注册在 `frontend/src/App.tsx`（主窗）与窗口面路由；新增页面以该文件为准，不要按已删除的
> 单细胞/空间转录组/figcode/admin 旧结构假设目录存在——分析能力现由插件与 Result Studio 承载。

> 架构去耦（2026-07）：core 已从 vendor submodule 内联；OSS/PostgreSQL/docker 双模式已移除，
> 现为「本地文件存储 + SQLite + 内嵌运行时本地执行」。详见 `docs/dependency-decoupling-checkpoint.md`。

### 关键规范

1. **前端使用 TypeScript strict 模式**
2. **Electron IPC 调用必须通过** **`lib/desktopBridge.ts`**
3. **MCP 工具的真实注册处是** **`core/petri-server/mcp/registry.js`**（`listTools()` / `callTool()` 单入口）与 **`core/petri-server/agent-tools/`**（`tool-defs.js` + `registry.js`）；`src/mcp-server.js` 只是 stdio 协议壳，不得在壳内声明工具
4. **状态管理：React useState + 自定义 hooks，禁止使用 zustand**
5. **路由页面在** **`pages/`** **下，非页面组件用** **`_`** **前缀**
6. **新增 IPC 通道先在** **`src/ipc/channels.js`** **登记**（通道唯一注册表），再在 `preload.js` 增同名包装；`preload.js` 必须保持自包含字面量（sandbox 进程不能 require 本地模块），两侧漂移由 `test/ipc-channels-registry.test.mjs` 双向守护

## AI 行为指引

### 模型与委派策略

- 主 Agent 使用 `gpt-5.6-sol`，负责规划、架构、需求存在歧义的决策、跨模块取舍与最终审查；实际模型由 Codex 当前任务的模型选择器或主配置固定，不能只依赖提示词切换。

- 对边界清晰、范围狭窄、可重复且能独立验证的任务，主 Agent 应主动委派给子 Agent（并行会话、只读探查代理等可用执行体），例如定向测试、机械性代码调整、独立文件实现和只读核查。

- 每次委派必须明确任务范围、文件或职责所有权、预期输出、验证要求，以及不得回退或覆盖其他 Agent 改动的约束。

- 不把需求含糊、破坏性、安全敏感、治理裁决、紧密耦合或需要跨模块架构判断的工作委派给子 Agent。

- 当主线依赖委派结果时，主 Agent 必须等待其完成，复核代码与验证证据后再集成和宣布结果；子 Agent 的完成声明不能代替主 Agent 终审。

- 多 Agent 委派只用于当前唯一 active 工作包内部的任务拆分，不得绕过“单工作包串行”纪律并行启动新的阶段或工作包。

### Codex / Claude Code 统一入口

- `AGENTS.md` 是所有 AI Agent 共用的唯一工程指令；Codex、Claude Code 和其他 Agent 不得各自维护第二套项目规范。

- `CLAUDE.md` 只作为 Claude Code 的兼容路由，必须指向本文件和同一组 canonical 文档，不重复保存当前阶段、分支、验收数量或工作包进度等易漂移事实。

- 所有 Agent 按同一顺序恢复当前状态：先读 `docs/AUDIT-LOG.md`，再核对 Git/运行时/Acceptance 证据，最后读取 `docs/next-steps-roadmap.md`、`docs/project-workspace-handoff.md` 和当前唯一 active 工作包。

- 当前阶段、下一步或资格状态发生变化时，只更新其 canonical 文档及必要台账；不得为了同步不同 Agent 而在 `CLAUDE.md`、临时 prompt 或聊天记录中复制一份状态。

- 若入口文件与 canonical 文档冲突，以 Git、SQLite、Artifact Truth、Acceptance Evidence 和 canonical 文档为准，先降级冲突声明并修复入口，不能任选对实现最方便的一份。

### 审计广播台（最高优先级）

- **每次会话开始时，必须先读** **`docs/AUDIT-LOG.md`**，处理其中 🔴 阻塞项和 🟢 待合并项，再开始主线工作。

- 该文件是非主 agent（审计/辅助 agent）向主 agent 广播发现的唯一入口，包含代码质量问题、契约不一致、分支待合并等。

- 处理完成后，将对应条目状态改为 ✅ 并在"处理记录"登记。

- 非主 agent 完成新审计后，必须把发现追加到 `docs/AUDIT-LOG.md` 并提交，不要只写在单独报告里。

- `AUDIT-LOG.md` 只保存活跃广播；除非追溯具体问题，不读取 `docs/archive/` 中的历史审计账本。

### 项目治理与文档生命周期

- 创建或修改计划、Goal、工作包，完成阶段收口、Handoff、归档/替代文档，或创建/移除 Git Worktree 时，必须使用 `$petri-project-governance`（BLOCK-61 改名前为 `$petri-project-governance`）。该 skill 的 canonical 位置是 [`.agents/skills/petri-project-governance/SKILL.md`](.agents/skills/petri-project-governance/SKILL.md)。
- 会话启动/收口/实机验收/工作区卫生/产品 Skill 编写/子 Agent 委派等日常开发实践，使用 `$petri-dev-infra`（canonical：[`.agents/skills/petri-dev-infra/SKILL.md`](.agents/skills/petri-dev-infra/SKILL.md)，BLOCK-71 沉淀；自洽工具包——脚本/模板/原则随包携带，跨仓库复用见包内 PORTING.md，委派任务书模板在包内 `templates/`）。
- **开发时决策建议器（Jev/Laya）主动行使（2026-09-24 用户裁决，无需用户提醒）**：规划定向测试前跑 `npm run test:suggest -- --supply=cloud`、台账回写前跑 `npm run doc:suggest -- --supply=cloud --context "<改动说明>"`、测试失败归因时跑 `node scripts/block114-failure-triage.mjs`、收口/交接给下一个工作包建议前跑 `npm run next:suggest -- --context "<收口摘要 + 队列>" --candidates "…"`（Jev 选**一个**，禁止"或"式多选；用户裁决 2026-10-24）、收口声明前跑 `npm run output:judge`——到点即跑，结果（含零建议）如实附在交付说明里；确定性规则优先于模型，零建议不是故障。用法/选型/红线见 [`.agents/skills/petri-dev-infra/references/DEV-DECISION-TOOLS.md`](.agents/skills/petri-dev-infra/references/DEV-DECISION-TOOLS.md)；**调用与否以 `decision_log` 为准（`npm run decision:report` 可查账）**。
- **Skill 使用透明度（2026-09-24 用户裁决；2026-09-25 补充 Jev 计数）**：会话中实际使用（加载并依据其内容行事）了某个 skill 时，在该次交付/答复的收尾用标签列出，形如 `〔skills: petri-dev-infra(SKILL, references/DEV-DECISION-TOOLS) · jev×N〕`；**jev×N = 本工作阶段（自上次收尾）Jev 决策建议器调用次数**（`npm run decision:session` 分段口径：每次收尾**重跑取数**得「本轮增量 + 会话累计」双数字——**复用上一轮数字即违规**〔2026-09-25 用户两次抓真：复用 60 与复用 1 均为执行违规〕；零次如实标 `jev×0`；禁止凭记忆估数）；**只标真实使用的**——未使用任何 skill 的纯问答可不标，不得虚标。
- 评审代码变更/审查 diff/写审计报告时，使用 `$petri-code-review`（canonical：[`.agents/skills/petri-code-review/SKILL.md`](.agents/skills/petri-code-review/SKILL.md)，BLOCK-71 沉淀；六维度评审 + P1/P2/Minor 分级 + 表行式报告模板；P1 修复后方可收口）。

- 新建页面/组件、写样式、暗色模式与主题色工作、排查「颜色不一致」反馈，或评审涉及 CSS 的 diff 时，使用 `$petri-css-theme`（canonical：[`.agents/skills/petri-css-theme/SKILL.md`](.agents/skills/petri-css-theme/SKILL.md)，UI-392/393 沉淀；海军蓝 token 阶梯 + 禁零定义/禁 slate 字面量 + infima 特异性战争规则 + 页头标准件；机械化门禁=theme-token-contract.test.ts，写样式后必跑）。

- **Agent Skill 发现桥（canonical 只在 `.agents/skills/`，禁止第二份副本）**：各宿主的项目级 skill 目录用**同名相对符号链接**指向 `.agents/skills/<name>`——`.claude/skills/`（Claude Code）、`.codebuddy/skills/`（CodeBuddy）；两者均已入库随仓库分发。新增、改名或删除 Agent skill 时必须同步补齐全部发现桥，否则对应宿主静默发现不到（`use_skill <name>` 报 not found）。`.codebuddy/` 下除 `skills/` 外的运行时数据由 `.gitignore` 排除。**Windows 前提**：Git 默认 `core.symlinks=false` 会把桥检出为纯文本文件（内容为目标路径），宿主按目录加载不到 → 静默 `not found`；该形态目标可解析所以死链检查放行，退化由 `hygiene:check` 检查项 4 兜住（2026-09-20 实测 8 桥 7 文本时全链绿灯）。克隆后首件事：`git config core.symlinks true` → `git rm -r --cached .claude/skills .codebuddy/skills && git checkout -- .claude/skills .codebuddy/skills` → `npm run hygiene:check` 须报「全部为真 symlink」。

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

- `frontend/src/components/copilot/SimpleChat.tsx`（1664 行）— 聊天主链，改前先读 `conversationRunStore` 语义

- `frontend/src/components/desktop/WorkingTreeReview/ReviewMode.tsx`（1310 行）与 `pages/project-workspace.tsx`（1170 行）— 工作区/评审投影

- `src/main.js`（686 行，装配入口）— 进程模型与 window 管理已拆到 `src/main/`（窗口/后端进程/插件加载）与 `src/ipc/`（按域 handler），改行为通常落在子模块而非入口

- `src/ipc/working-tree-review.js`（633 行）/ `src/ipc/window-manager.js`（623 行）/ `src/plugin-manager.js`（562 行，生命周期见 `src/main/_plugin-loader.js`）

- 体积由 `npm run gate:code-size`（`scripts/code-size-ledger.mjs`）机械守护，超标走台账登记而非临时放宽

### 新增功能检查清单

- [ ] 前端路由/页面 → 在 `frontend/src/pages/` 下创建

- [ ] Electron IPC → 先在 `src/ipc/channels.js` 登记通道，`src/ipc/` 加 handler，`preload.js` 加包装，前端只经 `desktopBridge`

- [ ] MCP 工具 → 在 `core/petri-server/mcp/registry.js` / `core/petri-server/agent-tools/` 登记定义与执行

- [ ] 类型定义 → 在 `frontend/src/` 下创建 `*.types.ts`

- [ ] 测试 → 在 `frontend/src/` 同目录创建 `*.test.ts`

- [ ] 渲染进程 IPC 走 `desktopBridge`（禁止直引 electron/node 内建——`npm run quality:arch` 会拦）

### Lint 债务纪律（BLOCK-105 棘轮）

- `eslint-suppressions.json` 是存量违规抑制基线：**新增违规即红**，存量只许收缩不许放宽。

- 新违规处置三分类：真缺陷修 / 化石删 / 误报豁免（豁免必须走 `--suppress-all` 重扫入库+reason 留痕，**禁止全局关规则**）。

- 批量收缩：修一批后 `npx eslint . --suppress-all` 刷新基线（parsing error 无法抑制，先清化石）。

- 架构新桥（如跨层引用）：dependency-cruiser 规则的 pathNot 登记制，登记即留痕。

### 代码风格

- 组件：函数式 + 命名导出

- 样式：CSS Modules 或 `*.module.css`

- 工具函数：`lib/` 下按功能分组

## 相关文档

- `frontend/src/lib/desktopBridge.ts` — IPC 通信封装

- `core/petri-server/mcp/registry.js` — MCP 工具注册与执行单入口（`src/mcp-server.js` 仅 stdio 壳）

- `frontend/src/App.tsx` — 应用入口

