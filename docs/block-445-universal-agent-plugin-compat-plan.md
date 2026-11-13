# BLOCK-445 · 通用 Agent 插件/技能兼容层

> 目标（用户原话）：「任何 agent 的插件、技能都可以兼容」。
> 本包按「先可靠、后跨端」落地：来源发现通用化 → 能力投影 → MCP App 页面宿主链路。
> 诚实边界见文末 §5，不冒充「已完全兼容」。

## 1. 范围

| ID | 交付 | 验收 |
| --- | --- | --- |
| S0 | 收口 BLOCK-444 单插件转换器为基座 | `test/block444-*` 6/6；挂入 impact-map |
| S1 | `scripts/lib/agent-plugin-sources.mjs`：任意 Agent 的清单候选（ZCode/Claude/Codex/CodeBuddy/OpenCode/Continue/Kiro/Qwen/Windsurf/Trae…）、用户级与工作区级插件根扫描、`.agents/skills` 直读、无清单单技能目录 | `test/block445-*` 5/5；单技能目录可直接安装 |
| S2 | `commands/*.md` → 合成技能（默认开启，`--no-command-skills` 可关） | apply 后技能列表含 `cmd-<plugin>-<name>`，落 `skill.json` |
| S3 | MCP App 页面宿主链路（Phase 1 只读渲染）：后端 `readResource` + REST、主进程 `gen-ui:prepare-mcp-app`、preload API | 离屏 Electron 实测 `prepareMcpApp` 返回 `petri-genui://gen-…/index.html`，iframe 注入成功、无协议错误 |
| S4 | 真实插件回归 + 门禁 + 台账 + 提交推送 | 见 §4 |

## 2. 架构事实（为什么能兼容）

Petri 已有等价物：
- `core/shared-backend/skill-registry.js` **原生双格式**：`skill.json` 与 `SKILL.md`（frontmatter + 正文），`installSkillFromDir` 合成件落 `prompts/system.md`；
- `core/petri-server/mcp/client-manager.js`：stdio / http(StreamableHTTP) / sse 三传输 + OAuth；
- `src/main/gen-ui/`：独立 origin 沙箱 `petri-genui://gen-<id>`、`assembleGenUiShell`、CSP、guest-bridge、劫持侦测。

因此大部分外部插件的实际价值（skills、MCP 工具）无需改 Petri 运行时即可投影；交互页面复用 gen-ui 沙箱。

## 3. 命令与使用

```bash
# 单个插件（目录或 zip），默认 dry-run
node scripts/import-external-plugin.mjs --source <pluginDir>
node scripts/import-external-plugin.mjs --zip <plugin.zip>
# 真实写入（技能落 PETRI_USER_DATA_DIR/skills，MCP/命令输出 JSON，插件目录复制供 server 引用）
node scripts/import-external-plugin.mjs --source <pluginDir> --apply --data-dir <dir>
# 扫描任意 Agent 的用户级/工作区级插件与技能目录
node scripts/import-external-plugin.mjs --scan [--scan-root <dir>]… [--apply] [--json]
# 关闭命令→技能投影
node scripts/import-external-plugin.mjs --source <dir> --apply --no-command-skills
```

输出报告含 `imported`（skills / mcpServers / commandTemplates）、`unsupported`（逐能力诊断）、
`diagnostics`（含 `mcp_entry_script_missing`）、`requiresInstall`（插件需 npm install / build）。

安全边界：**从不执行插件代码**，不 require 插件 JS；不跟随软链；技能体积 ≤10MB / 500 文件；
zip 走既有解压器（穿越条目拒绝 + 失败清理）；默认 dry-run。

## 4. 当次实测读数

- `test/block444-external-plugin-import.test.mjs` **6/6**；`test/block445-agent-plugin-sources.test.mjs` **5/5**。
- 真实 ZCode 插件（`reference/ZCode/apps/zcode-cli/packages/*`）dry-run：

| 插件 | 可迁移 skills | MCP | 不可迁移 |
| --- | --- | --- | --- |
| documents-plugin (0.2.2) | 2（docx / docx-viewer） | 1 stdio | mcp-apps-ui / subagents |
| pdf-plugin (0.2.3) | 2（pdf / pdf-viewer） | 1 stdio | mcp-apps-ui / subagents |
| design-plugin (0.7.2) | 1 | 0 | hooks |
| visualize-plugin (0.1.2) | 1 | 0 | — |
| browser-use-plugin (0.5.1) | 2 | 0 | — |

- `documents-plugin --apply`：2 个技能安装成功、`${ZCODE_PLUGIN_ROOT}` 替换为复制目录、
  `mcp-imported.json` 生成；真实发现的诊断 `mcp_entry_script_missing`（ZCode 插件为 TS 源码，
  `dist/server.mjs` 需先 `npm install && npm run build`），已显式提示而非静默给出跑不起来的配置。
- S3 后端：mock MCP HTTP server 的 `resources/read` → 注册 200 / connect 200 /
  `POST /api/mcp/servers/:id/resource` 200（HTML 探针命中）/ 空 uri 400。
- S3 离屏 Electron：`window.petri.genUi.prepareMcpApp` 存在，返回沙箱 URL，iframe 注入后
  `frames=1`，实例日志无 `fragment read failed / unknown gen-ui session`；端口与用户 MCP 配置已恢复。

## 5. 未覆盖（精确原因，非「做不了」）

| 项 | 原因 | 补腿 |
| --- | --- | --- |
| ZCode JS 扩展宿主（`extension.main` + 能力表 RPC + `contributes.views/slots`） | Petri 无扩展进程与能力网关；扩展代码会 import `@zcode-dev/plugin-api` | 长期：Node 子进程宿主 + 运行时 shim + 能力表（先做无 UI 子集） |
| `hooks/` | 无钩子运行时（安全面最敏感） | 独立包，需定义事件白名单与审计 |
| MCP App **自动渲染** | 宿主链路已通，但工具结果里 `_meta.ui.resourceUri` → 前端 `GenUiCard` 的自动分支未接（需对齐消息/工具结果结构） | Phase 2：前端干净文件加分支 + 双向 RPC（`callServerTool` / `updateModelContext`） |
| 插件 MCP server 的构建与依赖 | 外部插件多为 TS 源码，`dist/` 未随仓库提供 | 用户在该插件目录 `npm install && npm run build`（报告已给 `requiresInstall`） |
| 扩展视图插槽 / 逐插件信任 | 需渲染层插槽 + 权限模型 | 长期，且渲染层仍有他方在制 WIP |

## 6. 治理

零放宽既有阈值/基线；改动文件 lint 0 error；`docs:check` / `docs:reconcile` / `hygiene` /
impact-map 覆盖门与 `test:changed` 见提交记录。证据：
`acceptance/m-blueprint-2026-11-11/m6a/universal-plugin-compat.json`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
