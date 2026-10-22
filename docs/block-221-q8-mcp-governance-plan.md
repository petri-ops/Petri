---
capability: q8-mcp-governance
goal: Q8（MCP 与扩展治理）垂直切片——把 MCP 从「能用」推进到「默认不信任、可授权、可解释」：先堵住服务级凭据外泄，再给每个 server 一层可写的工具允许/阻断策略，并让治理状态在服务清单上可见。
acceptance:
  - `GET /api/mcp/servers` 不再回传明文 env 值：只回 `envKeys`（键名可见）＋`envCount`；写入侧（POST）语义不变，env 仍加密落盘。
  - 新增服务级策略 store `mcp-server-policy.json`（`helpers/mcp-server-policy.js`）：逐 server `{ trust, allow, block }`，默认 `trust=ask` + 空 allow/block（=全允许，行为不变）。
  - 投影过滤：`block` 命中即不投影；`allow` 非空时只投影其中工具；两者都命中时 block 优先；未知工具名与未知 serverId 在写侧 fail-closed（400/404），不静默吞。
  - 路由：`PUT /api/mcp/servers/:id/policy`（写）与 `GET /api/mcp/servers/:id/policy`（读）；`GET /api/mcp/servers` 每行附 `policy` 摘要（trust / allow 数 / block 数 / 投影工具数）。
  - 有界与健壮：策略条目上限、工具名长度上限、坏 store fail-closed 视为空策略（不阻断连接、不放开过滤）。
  - 定向测试：脱敏、默认全允许、block 优先、allow 白名单、未知工具 400、未知 server 404、坏 store 降级、投影计数；`test:changed` 绿 + closeout 十三门 PASS。
reopen: per-server 信任位接入审批层（需与 Q1 审批事件契约一起设计，避免绕开 D4 默认）；MCP OAuth per-server authenticate；大目录懒加载与 schema 按需；深链安装安全面（SHA-256/大小/风险提示）；annotations 四 hint（destructive/openWorld/idempotent）进策略；技能自进化建议；服务货架 UI 的信任/阻断可视化操作面（本轮只做数据面与只读摘要）。
status: completed
---

# BLOCK-221 · Q8（垂直切片）：MCP 服务级治理——凭据脱敏 + 工具允许/阻断

> 用户裁决：2026-10-20「Q8 扩展治理（推荐）」= 按母纲硬顺序 P3 → **Q8** → Q9 → P4。
> 波次母纲：`docs/qoder-essence-absorption-plan.md` §6-Q8（A7/J2/J3/J4/J5/J6）。

## 1. P0 实码勘察（2026-10-20，只读实测）

| 面 | 现状证据 | 结论 |
| --- | --- | --- |
| 服务清单数据面 | `routes/mcp-client.js:27` `GET /api/mcp/servers` → `manager.getStatuses()`；`client-manager.js:183` 用 `{...cfg, status}` 展开 | 配置**整行**（含 env）下发给渲染进程 |
| env 落盘与读取 | `helpers/mcp-settings.js`：落盘为 `enc:v1:` 密文（CAP-2），但 `listMcpServers()` 逐键 `envCrypto.decryptSecret()` **还原明文**后返回 | **明文凭据经 HTTP 面外泄**（渲染进程/任何本地进程都能读）；这是本轮要先堵的真缺陷 |
| 逐工具策略 | `helpers/mcp-tool-policy.js`（`mcp-tool-policy.json`，`enabled/timeoutMs/contractMode` + 投影上限）+ `mcp-projection.js:109-111` 消费 | 已有**逐工具**停用面；**无服务级** allow/block，也无「这个 server 整体可信度」概念 |
| 信任位 | 全仓 grep `autoApprove/trustedServers/allowlist` 只命中 `helpers/runtime-policy.js` 的**全局** `toolAllowList/toolDenyList`（环境变量驱动） | 无 per-server 信任；全局列表不是服务治理 |
| 注解扩展 | `mcp-projection.js:64` 只消费 `readOnlyHint`（CAP-1 降档到 read/plan） | destructive/openWorld/idempotent 未进策略 |
| OAuth | `core/petri-server/helpers` 下无 MCP OAuth 实现 | 缺口，需独立契约（reopen） |
| 写面现状 | `mcp-client.js:78` 自注「v1 无设置页，API 为唯一写面」；`McpShelfPane.tsx`（244 行）只有增删/连断 | 服务级策略先做数据面 + 只读摘要；操作 UI 记 reopen |

## 2. 范围（垂直切片）

1. **凭据脱敏（先修缺陷）**：`getStatuses()` 不再透传 env 明文，改 `envKeys` + `envCount`；前端 `McpServerRow` 同步改型（唯一消费点是类型与 fixture，无渲染依赖）。
2. **服务级策略 store**：`helpers/mcp-server-policy.js`
   - 形状：`{ version: 1, servers: { "<serverId>": { trust: 'ask'|'allow', allow: string[], block: string[] } } }`
   - 校验：serverId 必须已配置；工具名 `[A-Za-z0-9_.:-]{1,128}`；单 server allow/block ≤200 条；未知工具名仅在「已连接」时判定，离线写入放行但留 diagnostic（与 `mcp-tool-policy` 的 unknown-tool 口径一致：能改、不静默）。
   - 读侧 fail-closed：文件缺失/坏 JSON/形状错 → 空策略（**不放开过滤、不阻断连接**）。
3. **投影过滤**：`_buildProjection()` 在逐工具策略之后追加服务级判定（block 优先 > allow 白名单 > 默认全允许）。
4. **路由**：`GET/PUT /api/mcp/servers/:id/policy`；`GET /api/mcp/servers` 每行 `policy` 摘要（`trust`、`allowCount`、`blockCount`、`projectedToolCount`）。
5. **测试** `test/block221-mcp-server-policy.test.mjs`。

## 3. 非范围（reopen）

- per-server 信任位接审批层：`trust` 本轮只落库与展示，**不改变 D4 审批默认**——降档必须与 Q1 审批事件契约一起做，避免绕开治理。
- OAuth per-server `authenticate`；懒加载/schema 按需；深链安装安全面（SHA-256/大小/风险提示）；四 hint 进策略；技能自进化建议；货架 UI 的信任/阻断操作面。

## 4. 完成语义

completed 需：脱敏 + store + 过滤 + 路由 + 测试 + canonical 回写 + closeout 十三门。**明确声明这是 Q8 垂直切片**：凭据可见性与服务级工具面已治理；信任位降档、OAuth、深链安装、懒加载仍在 reopen。

## 5. 收口（2026-10-20）

**结论：BLOCK-221 Q8 垂直切片 completed（含一处真实安全缺陷修复）。**

### 5.1 交付

- **凭据脱敏（缺陷修复）**：`client-manager.getStatuses()` 不再展开 `cfg.env`——改回 `envKeys`（排序键名）+ `envCount`。此前 `GET /api/mcp/servers` 会把**解密后的 MCP env 明文**（第三方 token）下发给渲染进程；落盘是密文，读侧 `listMcpServers()` 还原明文后被整行透出。现状态面不再含任何值；`env` 仍加密落盘、进程内连接照常使用明文。
- **服务级策略 store** `helpers/mcp-server-policy.js`（`mcp-server-policy.json`）：逐 server `{ trust: 'ask'|'allow', allow[], block[] }`；单表 ≤200 条、工具名 `[A-Za-z0-9_.:-]{1,128}`；读侧坏 JSON/坏条目 fail-closed 为空策略（不放开过滤、不阻断连接）。
- **求值顺序**：block 优先 → allow 非空即白名单 → 默认全允许（历史行为不变）。`evaluateTool` 返回 `reason`（`blocked`/`not_in_allow_list`/`allowed`），治理可解释。
- **投影接线**：`mcp-projection._buildProjection()` 在逐工具策略之后追加服务级判定；新增 `projectedCountByServer()` 供可见面统计。
- **路由**：`GET/PUT /api/mcp/servers/:id/policy`（未知 server 404、非法 trust/名/越界 400 + diagnostics；已连接但清单外工具只留 `*_unknown_tool` diagnostic 仍收，离线可预配）；`GET /api/mcp/servers` 每行附 `policy` 摘要（trust / allowCount / blockCount / allow / block / projectedToolCount）。
- **前端类型**：`McpServerRow` 改 `envKeys`/`envCount` + `policy?` 摘要（渲染层无 env 消费点，无视觉改动）。

### 5.2 验证

- `test/block221-mcp-server-policy.test.mjs` **9/9**：默认全允许 / block 优先 / allow 白名单 / 写侧 fail-closed（未知 server、非法 trust、非法名、越界）/ 未知工具仅 diagnostic / 去重 / 坏 store 降级 / **脱敏（状态行序列化后不含明文 token）** / 投影裁剪（3 → 1 且计数一致）/ 摘要一致。
- 邻域回归：`mcp-client-manager`、`mcp-projection`、`mcp-client-settings`、`block160-env-crypto`、`block163-http-transport`、`block203-mcp-servers`、`block204-tool-policy(+baseline)` 共 **40/40**。
- 前端 `pages/extensions` + `hooks`：**19 文件 / 145 项全绿**；`quality:types` 0。
- `test:changed` + `closeout` 十三门见收口笔录。

### 5.3 顺带处置（收口期发现的既有债务）

- **落点总账补登 4 族**：`data-retention`、`memory-policy`、`subagent-profile`、`trust-policy` 早已进 `config-schema` 注册表，却从未登记进 `test/block203-landing-registry` 的落点表（该测只在「动了 config-schema」时才进 impact 范围，于是长期无人发现）。本轮补齐为 14 + 9 = **23 处**，并保留「运行时态/授权态不得做成注册表族」的断言。
- **刻意不做成配置族**：`mcp-server-policy.json` 登记为 `runtime-state`（非族）。理由=信任位/允许/阻断是**安全决策**，跟着「设置全景导出」走会在另一台机器上还原出别人的信任判断——导出即越权。因此它不进 `CONFIG_FAMILIES`、不进导出导入。
- **Windows 可移植修**：`test/block203-ai-settings-root` 的动态 `import()` 改 `pathToFileURL`（Windows 上绝对路径会被读成 `d:` 协议直接报错）。
- **环境**：本机 `tar` 默认解析到 Windows bsdtar（不支持 `--force-local`），收口需 PATH 前置 `D:\Program Files\Git\usr\bin`（GNU tar）与 `...\Git\bin`（bash）——已并入 AUDIT-LOG 的 🟡 环境行。

### 5.4 边界（reopen）

- `trust` 位本轮**只落库与展示**，不改变 D4 审批默认：降档（allow=自动批准）必须与 Q1 审批事件契约一起做，避免绕过治理。
- 未做：MCP OAuth per-server authenticate、大目录懒加载与 schema 按需、深链安装安全面（SHA-256/大小/风险提示）、`destructiveHint/openWorldHint/idempotentHint` 进策略（现仅 `readOnlyHint`）、技能自进化建议、服务货架 UI 的信任/阻断操作面（本轮只做数据面 + 只读摘要）。
- **2026-10-22 追加**：服务货架 UI 操作面已由 **UI-547** 交付（`verified` dev Electron 边界内；allow/block 编辑 + 生效投影计数 + 400 diagnostics；trust 仍只读随 Q1）。HTTP OAuth per-server authenticate 已由 **BLOCK-239** 交付（UI-548 verified；SDK provider/auth + localhost callback + 密文 token store）。**剩余 reopen**：stdio/SSE OAuth、token revoke/账号切换、agent 主动 authenticate 工具、真实 provider 矩阵（G1+）、懒加载/深链/三 hint。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
