---
capability: settings-proxy-runtime-policy
goal: BLOCK-202 = 阶段 A 速赢 III（runlist W3）＝ P0-4 代理设置（httpProxy / httpsProxy / noProxy / 自签 CA）+ P0-2 全局审批默认档位 + 工具曝光白/黑名单 + 派生并发/深度可配。现状事实（§0 实码核对）：全仓**零代理支持**（grep HTTP_PROXY/HTTPS_PROXY/NO_PROXY 仅命中注释，出站 fetch 无 agent）、**无自签 CA 用户入口**（只有隧道侧的 NODE_EXTRA_CA_CERTS 注释）；审批档位只由请求上下文 `context.accessMode` 决定，缺省塌缩 `full`（agent-runner:769）；并发/深度**只读 env**（spawn-agent-tools:38-55，PETRI_SPAWN_*），设置页不可见；**不存在工具白/黑名单**（模型看到的工具面=全量注册表∩会话子集∩路由收窄）。本包把四项都升为注册表族 `network` / `runtime` 的设置面，语义默认=现状。
acceptance:
  - P0 拆前基线：`test/block201-settings-baseline.test.mjs` 冻结族/键集合（8 族 35 键）；BLOCK-199 冻结基线一字未动；四档判定与 BLOCK-180 审批资源/指纹放行链零改动。
  - P1 network 族：四项（httpProxy/httpsProxy/noProxy/caFile）经共享注册表校验写盘；`applyNetworkEnv` 在**后端启动时**写 HTTP(S)_PROXY / NODE_USE_ENV_PROXY / NO_PROXY / NODE_EXTRA_CA_CERTS；**NO_PROXY 强制并入 localhost / 127.0.0.1 / ::1**（本地回环永不走代理，网关与隧道自检不受影响）；CA 文件不存在时不设置 env 并回结构化诊断；清空代理必须撤掉 env（不留陈旧代理）。
  - P2 runtime 族：`approvalDefaultMode` 四档（read/plan/workspace-write/full）**只作上下文缺省兜底**（显式传值永远优先）；`spawnConcurrency` 1-8、`spawnMaxDepth` 1-3（沿用既有硬上限），**env 优先 > 文件 > 历史默认 3/1**，env 遮蔽在快照里点名；`toolAllow` / `toolDeny` 逗号分隔，按「白名单先收窄 → 黑名单再摘」过滤模型可见工具面。
  - P3 设置面：代理面板挂「计算与数据」节（保存后明确提示**需重启后端生效**，并列已配置/已应用，不谎称即时生效）；审批与编排面板挂「决策原语」节（四档 + 并发/深度 + 白/黑名单 + env 遮蔽横幅）。两面板均有 400 diagnostics 原样展示。
  - P4 证据：`test/block202-network-runtime.test.mjs` 11 例（env 写入/回环/CA 缺失/清空撤 env/restartRequired/优先级/钳制/默认档位/曝光过滤/env 遮蔽）；前端两面板 7 例；**9223 离屏实机探针 15/15 allPass**（acceptance/block-202/ 两张截图），探针跑完即杀实例（无可见窗口纪律）。
  - P5 收尾：config-transfer 扩到 8 族（导出/导入/按区重置覆盖新族）；drift 门加两族承载与写路由；impact-map 登记；closeout 门禁全绿 + 五件套回写。
  - 完成语义：代理=配置与启动时应用（运行中改需重启，诚实提示）；审批=默认值可配，**不是新的权限系统**；工具白/黑名单=**曝光层，不是安全边界**（直接调用仍走既有 policy/审批门）。
reopen: 代理热切换（无重启生效，需要 per-request dispatcher）、SOCKS 代理、代理认证凭据、CA 多证书目录；工具级策略（超时/审批档位/启用）属 P1-2（runlist W5）；正向白名单与路由/子集交互的完整矩阵；审批档位「按项目覆盖」。
status: completed
---

# BLOCK-202 · 阶段 A 速赢 III（代理设置 / 审批档位 / 并发深度 / 工具曝光）

执行序位置=`docs/stage-3-4-execution-runlist.md` 的 **W3**（W0=BLOCK-199、W1=BLOCK-200、W2=BLOCK-201 已 completed）。
用户发令：2026-10-17「行 搞完W3」。

## 0. P0 勘察（实码）

- 代理：`grep HTTP_PROXY|HTTPS_PROXY|NO_PROXY|httpProxy|noProxy|NODE_EXTRA_CA_CERTS` 在 core/src 仅命中两处注释（mobile-gateway/tunnel.js:48、helpers/ai-settings.js:11）——**没有任何实现**。
- 审批：`agent-runner.js:769` 决定 accessMode（read/workspace-write/plan 透传，其余塌缩 full）；policy 层 `agent-tool-policy.js` 的四档判定与 BLOCK-180 放行链是既有语义，本包不碰。
- 并发/深度：`spawn-agent-tools.js:38-55` 直接读 env（1-8 / 1-3 钳制）。
- 工具面：`resolveToolDefsForContext`（会话子集）→ tool-router 收窄 → 全量下发，无用户可配的曝光名单。

## 1. 判定：patch + 新建薄层（不重建）

- network/runtime 都是**新增概念**（此前不存在），故新建 helper 与 REST 面；但**不复用另一套读写**：两者都与既有族一样走 shared-config 注册表 + commitGuard（未知键 400，不静默丢键），导出/导入/重置自动并入 config-transfer（8 族）。
- 审批侧只改「默认值来源」，不动判定实现——这是刻意的：把四档语义改动留给需要独立验收的包。
- 不做：代理热切换（需要 per-request dispatcher 与连接池语义，属 reopen）、SOCKS、代理认证、工具级策略（W5/P1-2）。

## 2. 实现切面

- `core/packages/shared-config/config-schema.js`：+`network`（4 键）、+`runtime`（5 键）两族。
- `helpers/network-config.js`：read/write/save + `applyNetworkEnv`（启动时写 env；回环强制并入 NO_PROXY；CA 缺失诊断）+ `getNetworkSnapshot`（configured/applied/restartRequired）。
- `helpers/runtime-policy.js`：审批默认档位、并发/深度（env>文件>默认）、白/黑名单解析与曝光过滤、快照与 env 遮蔽。
- `routes/runtime-config.js`：GET/PUT `/api/network`、GET/PUT `/api/runtime-policy`（400 + diagnostics）。
- 接线：`server.js` 启动 apply 网络 env；`agent-runner.js` 缺省档位 + 曝光过滤；`spawn-agent-tools.js` 改读 runtime-policy（env 语义保留）；`config-transfer.js` 扩 8 族。
- 前端：`NetworkProxyPanel`（计算与数据节）、`RuntimePolicyPanel`（决策原语节）；settingsFamilies 增加 compute→network、decisions→+runtime；面板 670 行（为守基线抽出 UsageSection，净不增）。

## 3. 验收证据

- 后端：`test/block202-network-runtime.test.mjs` 11/11；`block201-config-transfer` 9/9（8 族往返）；`block201-settings-baseline` 4/4（8 族 35 键）；`block199-config-drift` 6/6（+2 族承载/写路由）。
- 前端：两面板 7/7；settingsSearch 8/8；类型门禁绿。
- 实机：`block202-network-runtime-live` **15/15 allPass**（REST 9 + DOM 4 + 复位 2），`acceptance/block-202/`（JSON + ui519/ui520 截图）；探针结束即杀 9223（无可见窗口）。
- closeout：十三门全绿。

## 4. 边界（收口笔录口径）

1. **代理需重启**：Node 只在启动时读 proxy/CA env；设置页明确提示，不谎称即时生效。
2. **本地回环永不走代理**：NO_PROXY 强制并入 loopback——这是验收门要求，不提供关闭开关。
3. **审批档位只是默认值**：显式 accessMode 永远优先；四档判定与 BLOCK-180 链零改动。
4. **工具白/黑名单是曝光层**：不构成安全边界，直接调用仍被既有 policy/审批拦。
5. **覆盖率**：配置注册表 8 族 / 35 键；14 落点中仍有多处未收编（W4），不得称「配置已统一」。
6. G0 开发期常态 · 不外推 packaged/Provider/GA。
