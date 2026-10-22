---
capability: q8-mcp-lazy-catalog
goal: 大目录 MCP server 不再把全部工具 schema 塞进 agent 上下文——超过阈值时只投影 catalog（R1，list/describe）与 call（R2，按名代理调用）；调用时复核服务级/逐工具策略；小目录零变化。
acceptance:
  - 阈值（默认 30，测试可 env 覆盖）以上的 server 只投影 `mcp_<server>__catalog` 与 `mcp_<server>__call`；真实工具不再单独投影；阈值以下行为不变。
  - catalog 只列/描述策略允许的工具（server allow/block + 逐工具 enabled）；call 在调用时复核策略，blocked/disabled/unknown 一律拒绝；不绕过 timeout/连接态。
  - catalog 合同 R1/retrieval/none；call 合同 R2/execution；read/plan 可发现目录但不能调用。
  - `GET /api/mcp/servers` 附 `catalogMode`；货架显示目录模式与按需工具数；组件测试。
  - 测试：many-tools fixture 集成 + projection/manager/policy 回归 + 9223 live 目录模式截图；closeout 十三门 PASS。
reopen: 按目标工具 hint 动态降档（read-only 目标在 read/plan 直接调用）、分页/搜索超过 200、设置页可调阈值、真实 >200 工具目录实机、trust/Q1 审批联动。
status: completed
---

# BLOCK-241 · Q8 深化：MCP 大目录懒加载（catalog/call 代理）

> 用户裁决：2026-10-22「启动 BLOCK-241：大目录懒加载」。
> 前置：BLOCK-156 P3 动态投影、BLOCK-204 逐工具策略/投影上限、BLOCK-221 服务级策略、BLOCK-240 四 hint 合同。

## 1. P0 实码勘察（2026-10-22，只读实测）

| 面 | 当前证据 | 结论 |
| --- | --- | --- |
| 投影入口 | `mcp-projection._buildProjection()` 把所有 connected server 的工具逐个投影；全局 `projectionLimit`（默认 40）截断 | 大目录会被**硬截断**：第 41 个工具直接消失，模型无法发现 |
| 工具命名 | `mcp_<server>_<tool>`，sanitize 后撞名去重 | 来源前缀已具备；可加保留段 `__catalog` / `__call` |
| 策略 | `serverPolicy.evaluateTool`（block 优先/allow 白名单）+ `toolPolicy.policyFor`（enabled/timeoutMs/contractMode） | 代理调用可复用同一判定，不能另建策略 |
| hint | BLOCK-240 已把 readOnly/destructive/openWorld/idempotent 写入合同；MCP 默认 R2 | catalog R1、call R2；目标工具 hint 只影响未来 reopen 的动态降档 |
| 状态面 | `/api/mcp/servers` 已有 `policy.projectedToolCount` | 可加 `catalogMode` 解释「生效 2 / 已连接 N」 |
| 测试夹具 | `test/fixtures/mcp-fixture-server.cjs` 只有 2 工具；需要 many-tools 夹具 | 新建零依赖 stdio 夹具，工具数 > 测试阈值 |

**P0 结论**：不新增 API/依赖/数据库；在投影层加 catalog/call 两个合成工具，策略判定沿用 BLOCK-204/221。大目录从「截断」改为「目录 + 按需 schema + 代理调用」。

## 2. 范围与阶段

| 阶段 | 内容 | 出口断言 |
| --- | --- | --- |
| **P1 投影与代理** | 阈值（默认 30，`PETRI_MCP_CATALOG_THRESHOLD` 可覆盖）以上：只投影 `mcp_<server>__catalog`（R1）与 `mcp_<server>__call`（R2）；catalog list/describe 只读、有界；call 按名调用并在调用时复核 server/tool policy、timeout、连接态 | many-tools 集成：list/describe/call/block/disable/unknown/小目录零变化 |
| **P2 状态面** | `catalogModeByServer()` + `/servers` 的 `catalogMode`；货架 metrics 显示「目录模式 · N 个工具按需加载」 | 路由/组件测试 |
| **P3 实机与收口** | 9223 live 用 many-tools 夹具展示目录模式；UI-549 台账；closeout 十三门 | live 全过 + 十三门 PASS |

**批内纪律**：①策略在 call 时复核（投影快照不能成为放行依据）；②catalog 不泄露 blocked/disabled 工具的 schema；③call 的合同保守 R2，read/plan 只能发现不能调用；④小目录（≤阈值）逐字零变化；⑤新 acceptance 目录同批登记 impact-map。

## 3. 非范围（reopen）

- 按目标工具 hint 动态降档（read-only 目标在 read/plan 直接调用）。
- catalog 分页/搜索超过 200 条、真实 >200 工具目录实机。
- 设置页可调阈值（本轮 env/常量）。
- trust 降档接审批（随 Q1）。
- UI 工具浏览器（本轮只在货架显示目录模式；工具列表仍由 agent 通过 catalog 读取）。

## 4. 验收门禁

1. 红绿先行：many-tools fixture 集成（大目录只出 catalog/call、list/describe、call、block/disable/unknown、小目录不变）先红后绿。
2. Node：block241 + mcp-projection + mcp-client-manager + block204/221 回归。
3. 前端：McpShelfPane 目录模式 metrics + 类型。
4. `quality:types` 0、theme 17/17、lint/knip/closeout 十三门。
5. 9223 live：many-tools server → 货架显示目录模式 + 截图。
6. `output:judge` 收口声明前跑。

## 5. 完成语义

completed = catalog/call 代理 + 策略复核 + 状态面 + 测试 + live + UI-549 台账 + closeout 十三门 + canonical 回写。若 live 受环境阻塞，如实记 `in_progress` 并给阻塞点。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口（2026-10-22）

**结论：BLOCK-241 completed；UI-549 verified（dev Electron 边界内；9223 离屏 live 7/7）。**

### 6.1 交付

- **阈值**：单 server 可用工具数 > 阈值（默认 30，`PETRI_MCP_CATALOG_THRESHOLD` 可覆盖）→ 目录模式；≤阈值逐字保持原逐工具投影。
- **catalog**：`mcp_<server>__catalog` R1/retrieval/none；list（query/limit≤200/offset，有界）与 describe；只列当前策略允许的工具，不泄露 blocked/disabled。
- **call**：`mcp_<server>__call` R2/execution；按原始工具名代理调用；每次调用重新读 server allow/block + 逐工具 enabled/timeout；blocked/disabled/unknown 一律 `tool_not_available`；参数非对象拒绝。
- **状态面**：`catalogModeByServer()` + `GET /api/mcp/servers` 的 `policy.catalogMode`；货架显示目录模式与按需工具数。
- **兼容**：合成名冲突时回退逐工具投影；全局 `projectionLimit` 仍生效；零新依赖/零 API/零数据库。

### 6.2 验证

- block241 **5/5**；mcp-projection **15/15**；前端 **18/18**；theme 17/17；`quality:types` 0。
- 9223 离屏 live **7/7**（`acceptance/ui-549/` 亮/暗截图；REST catalogMode + UI copy）。
- `npm run closeout` 十三门 PASS；`output:judge` PASS。

### 6.3 边界（reopen）

- 按目标工具 hint 动态降档（read-only 目标在 read/plan 直接调用）未做；目录模式下 `call` 保守 R2，所有目标调用需 full 档。
- catalog 分页/搜索超过 200、真实 >200 工具目录、设置页可调阈值未做。
- trust 降档接审批随 Q1。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
