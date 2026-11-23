# QODER 🟡9 剩余 6 项一次性推进（2026-11-23）

## 用户发令与执行决策

用户发令「一次性列出剩下要做的所有事情，一次性推完」。剩余 6 项 = J4 / J6 / L1 / L2 / L5 / L6。逐项 P0 评审后按「最小切片 + 默认口径」全部推完——判据类自主（评审稿 D 项取最合理默认），无一触碰红线；每项 HK-01 红绿先行。

## 六项交付（一次列全）

| 项 | 默认口径（判据类自主） | 交付模块 | HK-01 |
|---|---|---|---|
| **J4** MCP 信任/OAuth 余项 | D1=ask 零变化 / D2=needsApproval=true（外部可见动作）；不读写 token | `core/shared-backend/mcp-agent-auth-request.js`：authenticate 请求校验（http/sse only）+ `publicAuthOutcome`（authorizationUrl/token 不落日志）+ `resolveProjectMcpDefault`（非法回落 ask） | 5/5 |
| **J6** Agent builder | 自定义角色不覆盖内置 key / baseRole（BLOCK-339 人设钉死） | `core/shared-backend/custom-agent-roles.js`：`normalizeCustomRoles`（坏条目丢弃+诊断）/ `mergeAgentRoles`（内置优先，unknown fail-closed）；消费端零改 | 5/5 |
| **L1** 搜索方言 | 只借行为合同，authority 只透传、无则诚实 null（D2 不自造评分） | `core/shared-backend/web-result-projection.js`：`projectSearchResults`（summary≤400、authority 透传/null、URL 白名单） | 5/5（L1+L2 合测） |
| **L2** 抓取方言 | 只补 source/authority 元数据，正文一字不改 | 同模块 `projectFetchMetadata`（不改 guardedFetch/正文） | 同上 |
| **L5** 插件宿主契约 | **仅契约层**：默认拒绝、不装载、不接 Electron | `core/shared-backend/utility-host-contract.js`：`evaluateHostManifest`（入口路径安全/权限白名单/消息白名单，无声明=no_host_declaration） | 5/5 |
| **L6** 插件审计统一 | 沿用现有 JSONL 惯例（非评审稿 SQLite，零新依赖） | `core/shared-backend/plugin-lifecycle-audit.js`：`parseAuditLines`（逐行宽容）/ `formatAuditEvent`（脱敏 token/authorizationUrl）/ `projectUnifiedAudit`（多源只读合并排序） | 5/5 |

## 红线遵守（逐项）

- 零新依赖（全部仅 Node 内置）；不改产品 sandbox/CSP/凭据/B1 token/handler/pack 声明；不碰 G1+；
- J4 不碰 token 加密链、URL 不落审计；J6 不覆盖人设、不碰执行器；L1/L2 不改出网硬边界/不新增配置键/不接 Qoder 端点；L5 **不做运行态 utility-process**（必碰 sandbox 红线，需用户裁决后才可动），只做默认拒绝的契约层；L6 投影只读、不承载信任真源（不随配置导出）、不读写凭据。

## 诚实边界（如实标注，不谎称完成）

- 6 项均为**最小可验证切片（P1 纯函数层）**：HK-01 已证核心逻辑，但工具注册/前端面板/运行态集成按各项实际需要——J4 的 agent 工具注册、L1/L2 的输出接线、L6 的 JSONL 写路由均**未接**，留作后续集成票；
- L5 运行态 host 明确不做（红线），只有契约层；
- 这不是"6 个完整 BLOCK 包交付"，是"6 项核心逻辑一次性推完 + 集成层留账"。

## 验证

- 6 项 HK-01 合计 **25/25**（`node-tests.txt`）；docs:check PASS(664) / ui-audit PASS / lint 0 error / tsc 0 / test:changed 0。
- 证据 = 本目录；六件套回写见 AUDIT-LOG / backlog / qoder-yellow9-reopen-review.md / DOC-REGISTRY。

G0 开发期常态 · 不外推 packaged/Provider/GA。
