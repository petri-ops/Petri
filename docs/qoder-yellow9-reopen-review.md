---
id: QODER-YELLOW9-REOPEN
kind: reference
status: active
canonical: true
truthDomain: qoder-yellow9-reopen
entrypoint: docs/README.md
phase: P0-LAUNCH
registeredAt: 2026-11-23
owner: main-agent
goal: 母纲 Q-MATRIX 9 个保留 🟡 reopen 项的统一立项评审稿——逐项登记范围/形态/待裁决/验收边界，受单工作包串行纪律约束，一项 active（A2）其余 queued。
---

# Qoder 9 项 🟡 reopen 立项评审稿（2026-11-23）

> 用户发令「🟡9 开始吧 可以立项了」+ 裁决「立 9 项评审稿 + 立刻开工 A2」（Jev 首推 A2，confidence 0.49）。
> TASK-FORM 归类：**立项评审稿**（taxonomy §3）——大面逐项裁决但未到启动；每项实施时按范围再分 BLOCK / 轻量包 / UI 增量。
> 单工作包串行：本稿是统一评审账本（不占 active 槽位），**A2 为唯一 active 实施包**，其余 8 项 queued 待 A2 收口后按队列逐项发令。
> 不进 G1+；L1/L2 只借 Qoder 行为合同，不接 Qoder 端点。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 母纲口径（现读）

`docs/qoder-essence-absorption-plan.md:318` 矩阵 ✅86·🟡9·🔴0·⛔7=102；保留 9 项 = `A2/E12/J2/J4/J6/L1/L2/L5/L6`（无候选池承接的 reopen 项）；§6.5 串行队列已清零（P4-REM 收口）。

## 九项登记表（范围 / 形态 / 现状 / 待裁决 / 验收边界）

| 项 | 对照点（母纲行） | 范围（本次 reopen 可做部分） | 形态预估 | 现状证据 | 待裁决 D | 验收边界 |
|---|---|---|---|---|---|---|
| **A2 ✅ completed（2026-11-23）** | 审批意图解释（:159） | 模型/本地模型解释层（确定性解释已交付 BLOCK-243）；「解释」按钮 + 分析中骨架 + 失败仍可允许/拒绝 | 轻量包 / BLOCK（取决于模型接入面） | `BLOCK-243` 确定性解释在案 | D1 默认否新 provider（已遵守，复用 callModelTask）/ D2 复用现有本地绑定（已遵守） | **已达成**：P1 纯函数 5/5 + P2 路由端到端 2/2 + P3 组件 15/15 + HK-01 9/9；证据 `acceptance/a2-approval-explanation/` |
| **E12 ✅ completed（2026-11-23）** | Notebook cell 级编辑（:228） | NotebookEdit（cell 读写/执行） | BLOCK | 无 cell 级工具 | D1=复用 workspace_exec 既有审批门（已遵守）/ D2=先工具层最小切片（已遵守） | **已达成**：`notebook_edit` 工具（schema+handler+contract+metadata，工具数 119），P1 纯函数 5/5+handler 端到端 3/3+registry 15/15+邻域累计 38/38；execute 只返借道计划不绕过审批。证据 `acceptance/qoder-e12-notebook-edit/` |
| **J2 ✅ completed（2026-11-23）** | 技能自进化建议（:280） | 建议列表 / 一键建任务 / 忽略 | 轻量包 | 无 | D1=本地 lessons 审计为源（已遵守）/ D2=自动建任务默认否（已遵守，仅出 prompt 草案） | **已达成**：投影器 `skill-suggestion-projector.js` + 只读/忽略路由 `skill-suggestions.js` + 独立忽略账本（不写 lessons.status）；P1 5/5 + 路由 2/2 = 7/7，全门禁绿。一键建任务走既有 createAgentTask 链（不新建执行器）；前端面板留可选增量。证据 `acceptance/qoder-j2-skill-suggestions/` |
| J4 | MCP 信任/OAuth 余项（:282） | agent 侧 `authenticate` 工具 + 项目级默认策略 | 轻量包 | BLOCK-239/240/241/243/258 已交大头 | D1 项目级默认拒绝取值 / D2 authenticate 工具签名 | 契约测 + 与既有 trust 门一致性 |
| J6 | Agent builder（:284） | 自定义 Agent/角色（当前仅内置 roles） | BLOCK | 内置 roles 在案 | D1 自定义角色 schema / D2 是否持久化位置 | 角色 CRUD + 使用契约；zero-G1+ |
| L1 | 联网搜索方言（:307） | `web_search` provider 方言/权威度（核心已交 BLOCK-247） | 轻量包 | SearXNG + 显式授权 + 来源主机名在案 | D1 只借行为合同不接 Qoder 端点（已定）/ D2 权威度口径 | 方言映射契约；不改出网硬边界 |
| L2 | 网页抓取方言（:308） | `web_fetch` provider 方言/权威度（核心已交 BLOCK-247） | 轻量包 | SSRF 硬边界 + 逐跳复检在案 | 同 L1 | 同 L1；不得放宽 SSRF/协议白名单 |
| L5 | 插件宿主契约（:311） | 通用 utility-process host/sandbox（Q5 surface/pack host API 已交 BLOCK-216） | BLOCK | surface/pack host 在案 | D1 utility-process 是否新依赖 / D2 sandbox 边界 | host API + manifest 契约；默认拒绝 |
| L6 | 插件权限/生命周期/审计（:312） | 生命周期/审计统一（深链安装 BLOCK-242 + trust BLOCK-243 已交） | 轻量包 / BLOCK | 深链 + trust 在案 | D1 审计落点（本地 SQLite）/ D2 生命周期事件集 | 审计事件可查 + 权限变更留痕 |

## 非范围（全项）

- 不接 Qoder 云端端点（L1/L2 只借行为合同）；不引入产品级新依赖（D 项裁决前一律"否"）；不改产品 sandbox/CSP/凭据/B1 token/handler/pack 声明（P6 后遗纪律）；不翻任何观感项状态（无偏好裁决保持 in_progress/pending 不代签）；不碰 G1+（Provider/GA/公证/远程发布）。

## 依赖 / 证据位置

- 依赖：A2 依赖 BLOCK-243 解释骨架；J4 依赖既有 MCP trust 门；L1/L2 依赖 BLOCK-247 工具；L5/L6 依赖 pack host + pack-registry。零新依赖默认，D 项裁决例外需走 DEPENDENCY-CHANGE-CHECKLIST。
- 证据：每项独立 `acceptance/<item-id>/`；本评审稿 `acceptance/qoder-yellow9-review/`（若有额外读数）。

## 完成语义

- 本评审稿 completed = 9 项范围/形态/D 待裁决/验收边界全部登记、registry + README + AUDIT-LOG 三件套同提交（评审完成态，非 9 项实施完成）。
- 各实施项 completed = 各自 HK-01 红绿 + 定向测试 + docs/ui 门禁 + 证据落 acceptance + 六件套回写 + commit；active 槽位一次仅一项。
- A2 开工登记：本稿登记同批在 AUDIT-LOG 写「启动登记（active QODER-A2）」行；其余 8 项 queued，各自开工需 A2 收口后发令（本稿已获用户总发令，逐项仍走 state 核对 + 启动 checklist）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
