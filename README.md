# 🧫 Petri · 格物

> 🧫 Petri — a desktop AI agent that is general by design and vertical by content: ships with multi-omics learning & practice packs, extends via MCP, runs local-first. A petri dish where your skills grow.

**Petri · 格物** 是一个通用 AI Agent 桌面应用：**通用内核 + 垂直领域内容**。首个内置垂直领域为**全组学（multi-omics）学习与实战**——AI 陪伴式导师在你的机器上规划任务、调用工具、执行分析、产出报告，数据不出本机。

Petri is a general-purpose AI agent desktop app, seeded with vertical-domain content — starting with multi-omics learning and hands-on practice. Local-first and MCP-native: it plans, runs tools and analyses right on your machine.

## Highlights / 特性

- 🤖 **通用 Agent 内核** — 任务规划、工具调用（内置工具 + MCP 服务器接入）、子智能体编排、工作区改动审阅（PR-style diff 评审）
- 🧬 **垂直领域内容包** — 首发全组学学习与实战内容（基因组/转录组/蛋白组学习路径 + DESeq2 等实战 golden path），领域以内容包形态入驻，内核零改动
- 🔌 **MCP 原生** — stdio / streamable HTTP 双传输 MCP 客户端，第三方工具即插即审
- 🛡️ **Local-first** — 本地文件存储 + SQLite + 内嵌运行时本地执行；分析在本地 R/Python 运行时完成，数据不出本机
- 🖥️ **桌面体验** — Electron + React 18 + Vite；项目工作区、Result Studio 成果面、知识库、联邦协作（P2P 桌面互联）

## Quick Start / 快速开始

要求：Node.js ≥ 24（推荐 fnm）、npm。

```bash
# 1. 安装依赖（根 + 前端）
npm install
cd frontend && npm install && cd ..

# 2. 启动前端 dev server（:3000）
cd frontend && npm run dev   # 保持运行

# 3. 启动桌面应用（另开终端；自动拉起 :3001 本地后端）
npm run dev
```

生产构建（SPA + 站点）：`npm run build:all`；桌面打包：`npm run build:win` / `npm run build:mac`。

> 当前版本处于 G0 开发期（`v0.0.1-rc.7` 工程候选），Result Studio 为 `implemented_unverified / experimental`；签名/公证/远程分发属后续阶段，尚不可用。

## Architecture / 架构一览

| 层 | 技术 | 入口 |
| --- | --- | --- |
| 桌面壳 | Electron | `src/main.js`（装配）+ `src/main/` + `src/ipc/` |
| 前端 | React 18 + Vite + TypeScript (strict) | `frontend/src/`（路由见 `frontend/src/App.tsx`） |
| 本地后端 | Node/Express（`core/petri-server`） | `core/petri-server/server.js` |
| MCP | 工具注册单入口 | `core/petri-server/mcp/registry.js` + `agent-tools/` |
| 数据 | better-sqlite3 + 迁移 | `src/migrations/`、`core/petri-server/db/` |

- IPC 通道唯一注册表：`src/ipc/channels.js`（渲染进程只经 `frontend/src/lib/desktopBridge.ts`）
- 领域分析能力由**插件/领域包 + Result Studio** 承载（`/extensions` 货架）

## Development / 开发

```bash
npm run state          # 会话状态一键恢复
npm run test:changed   # 影响范围定向测试（默认方式）
npm run closeout       # 收口门禁聚合（hygiene/docs/ui-audit/test/quality 十二门）
npm run docs:check     # 文档治理门禁
```

工程指令与治理纪律见 [AGENTS.md](./AGENTS.md)；文档入口见 [docs/README.md](./docs/README.md)。

## License / 许可

[MIT](./LICENSE) © petri-ops contributors
