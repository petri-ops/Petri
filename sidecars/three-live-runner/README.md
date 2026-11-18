# three-live-runner sidecar（BLOCK-462 L4 verification adapter）

three-live@1.4.0（外部工具，B-2 裁决 2026-11-18：**外部 MCP + adapter 隔离、capability 默认关、零产品依赖**）。
安装于 `.petri-dev-user-data/three-live`（自管 prefix，零产品 package.json 改动、零全局污染）。

## 安装（幂等 bootstrap）

```bash
npm install --prefix .petri-dev-user-data/three-live three-live@1.4.0 --no-save
```

## verification adapter（L4 核心）

```bash
node sidecars/three-live-runner/verify.mjs --glb <ws 相对 .glb> --out <ws 相对目录> [--append-truth <ws 相对 .scene3d.json>]
```

编排 `info → render → sim` 三步（three-live CLI 逐命令实测，见下表）；stdout 唯一 JSON 契约出口；
`verdict=pass` 当且仅当三步全过；失败诚实 exit 1。`digest` = 确定性字段集 sha256
（glbSha256 + renderSha256 + renderBytes + simExit + simNodes + toolVersion）——headless 渲染
双跑一致已实测（同 GLB → 同 PNG sha256），因此 digest 可复现。
`--append-truth` 把 `verifierResults{tool,verdict,diagnosticsRef,digest,at}` 以 digest 去重追加进
SceneSpec `metadata.provenance`（单一真相，不建第二份）。

契约测试：`test/block462-verify-adapter.test.mjs`（6 测试：pass/fail/复现/truth 追加幂等/越界拒绝）。

## 工具面实测对账（2026-11-18，three-live@1.4.0）

| 裁决材料（九工具 + Agent Gym） | 实测 | 备注 |
|---|---|---|
| MCP server | ✓ `three-live mcp`（stdio，标准 JSON-RPC） | 实测枚举 **10 工具**（裁决记 9，差异如实登记） |
| validate | ✓ `validate` | **仅 .js/.html**——sand3d GLB 路径不适用（如实登记；GLB 走 info+render+sim） |
| render | ✓ `render` | .js/.html/**.glb** → PNG contact sheet（实测 1024×1024，双跑 sha256 一致） |
| sim | ✓ `sim` | .js/.html/**.glb** 60Hz；s3d_joint GLB 无 KHR_interactivity 时走 orbit/explode 兜底场景，实测产出全 9 节点状态 exit=0 |
| info | ✓ `info` | GLB/USDZ 容器结构 |
| gym（Agent Gym） | ✓ `gym` + MCP 三件 `three_live_gym_reset/step/close` | 闭环 RL 形态环境（本包未编排，留 P2 后续按需） |
| convert | ✓ `convert` | GLB/USDZ 容器转换（本包未编排） |
| link | ✓ `link` | web playground 链接（本包未编排） |
| textures / from-image | ✓ `textures` / `from-image` | **AI 贴图/图生场景：需外部 AI endpoint——按 charter 本地主权默认关，未启用** |

MCP 工具实测清单（stdio tools/list）：`three_live_validate / render / convert / sim / link /
gym_reset / gym_step / gym_close / from_image / bake_textures`。

## MCP 货架接入（capability 默认关 · 用户显式开启）

three-live-mcp 为标准 stdio MCP server。**接入是用户动作**（capability 默认关——本包不改动
用户 mcp-servers 配置）。用户决定开启时：

1. 设置 → MCP 服务器登记 stdio server：command=`node`，args=`<仓库>/.petri-dev-user-data/three-live/node_modules/three-live/dist/three-live-cli.js mcp`；
2. `mcp-tool-policy` 逐工具策略（BLOCK-204 既有面）默认 deny，按需显式 allow（建议首批只开
   `three_live_validate/render/sim/info` 四个只读验证工具；`from_image/bake_textures` 需外部 AI
   endpoint，保持 deny——本地主权边界）；
3. `capabilities` 面不变（capability 声明默认关的既有治理不因本包改变）。

## Agent Gym 编排（gym.mjs · BLOCK-467 / 3D P4）

`gym.mjs` 编排一次 episode（reset → step×N → finalize），消费工作区内 GLB（含 BLOCK-459 探针），
stdout 单行 JSON 为唯一机器出口，失败诚实 exit 1；digest 为确定性字段集 sha256（双跑一致）。
**只编排与证据，不引训练框架**（R3）：

```text
node gym.mjs --glb <ws-relative .glb> --out <ws-relative dir> [--steps N] [--actions <json>] [--ticks 30]
```

- `reset` = CLI `gym reset --session <tmp> <GLB>` 起 episode + t0 observation；
- `step` = CLI `gym step --session <tmp> --actions <json> --ticks N` ×N，逐次 observation 摘要
  （step/tick/reward/score/done/bodies 计数）；
- **"close" 语义**：three-live CLI 只有 `reset/step/play` 子命令（现场 `gym --help` 实测），
  `three_live_gym_close` 仅存在于 MCP tools/list；本编排层不引 MCP transport，改以 session 文件
  读回+封存表征 episode close（payload.sessionNote 如实登记该缺口）；
- 证据落 `<out>/gym-evidence.json`（与 stdout 同内容）。

## 非范围

- viewer 包入驻 viewer registry / 双形态呈现 / 选择总线（=P3 另包）；
- 训练框架 / RL 策略网络 / 策略学习（R3 边界：只编排与证据）；
- textures/from-image 的外部 AI 服务（默认关，charter 本地主权）。
