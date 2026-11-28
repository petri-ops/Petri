# 🧫 Petri · 格物

> 🧫 Petri — a general-purpose agent that runs on your machine: local sovereignty, fully auditable, evidence by construction.

**格物（Petri）是跑在你机器上的通用 agent——本地主权、全链可审计、证据自证；以目标为输入、工具为手足、真实产物为交付；领域能力（生信等）由已安装领域包按需放大，不是与生俱来的身份。** 通用能力（编排 / 知识 / 工具 / 模型计量 / 可靠性）是开发主线；领域内容包是优势放大器。

Petri is a general-purpose agent running entirely on your machine — local sovereignty, end-to-end auditability, evidence by construction. Domain capabilities (e.g. multi-omics) come from installed domain packs, not from the agent's identity.

## Highlights / 特性

- 🤖 **通用 Agent 内核** — 任务规划、工具调用（内置工具 + MCP 服务器接入）、子智能体编排、工作区改动审阅（PR-style diff 评审）
- 🧬 **垂直领域内容包** — 首发全组学学习与实战内容（基因组/转录组/蛋白组学习路径 + DESeq2 等实战 golden path），领域以内容包形态入驻，内核零改动
- 🔌 **MCP 原生** — stdio / streamable HTTP 双传输 MCP 客户端，第三方工具即插即审
- 🛡️ **Local-first** — 本地文件存储 + SQLite + 内嵌运行时本地执行；分析在本地 R/Python 运行时完成，数据不出本机
- 🖥️ **桌面体验** — Electron + React 18 + Vite；项目工作区（会话产物卡 / 文件预览 / 批注 / 项目总览）、知识库、联邦协作（P2P 桌面互联）

## Quick Start / 快速开始

要求：Node.js ≥ 24（推荐 fnm）、npm。

```bash
# 1. 安装依赖（根 + 前端）
npm install
cd frontend && npm install && cd ..

# 2. 一条命令启动完整 dev 栈（BLOCK-457 唯一入口）
#    Electron main 先绑端口 → 自起 :3001 后端（含迁移）→ 拉起 :3000 Vite → 载窗。
#    不要再手动 `npm --prefix core/petri-server start`：双 spawner 会 EADDRINUSE。
npm run dev
```

生产构建（SPA + 站点）：`npm run build:all`；桌面打包：`npm run build:win` / `npm run build:mac`。

> 当前处于 G0 maintained + G1 进行中，版本以 `package.json` 为准；Result Studio 已于 item 90 阶段二（2026-11-28）**物理退役**（见 [清理影响面清单](./acceptance/item90-result-studio-phase1/IMPACT-INVENTORY.md) 与 [退役记录](./docs/g0-result-studio-plan.md)），查看场景由会话区产物卡与文件面板承接；签名/公证/远程分发按 G1 顺序推进。

## Architecture / 架构一览

| 层 | 技术 | 入口 |
| --- | --- | --- |
| 桌面壳 | Electron | `src/main.js`（装配）+ `src/main/` + `src/ipc/` |
| 前端 | React 18 + Vite + TypeScript (strict) | `frontend/src/`（路由见 `frontend/src/App.tsx`） |
| 本地后端 | Node/Express（`core/petri-server`） | `core/petri-server/server.js` |
| MCP | 工具注册单入口 | `core/petri-server/mcp/registry.js` + `agent-tools/` |
| 数据 | better-sqlite3 + 迁移 | `src/migrations/`、`core/petri-server/db/` |

- IPC 通道唯一注册表：`src/ipc/channels.js`（渲染进程只经 `frontend/src/lib/desktopBridge.ts`）
- 领域分析能力由**插件/领域包**承载（`/extensions` 货架；Result Studio 已于 item 90 阶段二退役，产物展示由 `ChatArtifactCard` 与 `GeneratedFilesSurface` 承接）

## Development / 开发

```bash
npm run state          # 会话状态一键恢复
npm run test:changed   # 影响范围定向测试（默认方式）
npm run closeout       # 收口门禁聚合（门数现读 `npm run closeout` 输出）
npm run docs:check     # 文档治理门禁
```

工程指令与治理纪律见 [AGENTS.md](./AGENTS.md)；文档入口见 [docs/README.md](./docs/README.md)。

## Signing / 签名

Petri Desktop 的 Windows 代码签名策略见 [Code signing policy](./docs/releases/code-signing-policy.md)：签名仅覆盖官方 GitHub Release 与官方 OSS 下载渠道发布的产物，其他渠道分发的包不受签名保护。

## License / 许可

[MIT](./LICENSE) © petri-ops contributors
