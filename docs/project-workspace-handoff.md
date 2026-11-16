最后更新：2026-11-16（**交接落册 · BLOCK-450 completed 后待办分类清单入册**：见下方 §当前待办分类清单——外部 1 / U 类裁决 7+ / 可执行候选 1（M-55）/ E 类人眼 / 延期挂起 / G1+ 出籍；BLOCK-449/450 已收口，M 程序 M7 §8 与 M2 尾巴全清。串行槽位空闲。G0 开发期常态 · 不外推 packaged/Provider/GA.）

---

# 工作区交接（Workspace Handoff）

## 恢复顺序（接手 Agent 必读）

1. `docs/AUDIT-LOG.md`（处理 🔴/🟢 未决项——当前无未决；🟡 区为延期/待评估不阻塞）
2. `npm run state`（分支 / WIP / active 工作包两层语义）
3. `docs/next-steps-roadmap.md` + 本文档（重点：§当前待办分类清单）
4. `AGENTS.md` 为唯一工程指令；事实优先级：当次命令输出 > Git/源码 > 证据 JSON > canonical 文档

## 当前事实快照（2026-11-16 交接时点）

- `main` @ `398b6dc4`，tracked 树干净；**12 项 untracked 用户资产/前会话产物零触碰零提交**（`assets/`、`petri-logo-concepts*`、`tmp-block342-live/`、`tmp-review/`、`model3d/`、`scripts/backfill-artifact-chain.mjs`、evals smoke JSON×2、NSO shard summary、`docs/post-h9-optimization-blueprint-2026-11-10.md` 受保护原件）。
- 串行槽位空闲；BLOCK-449（M7 §8 第 3/5 条补腿收口）与 BLOCK-450（M2 尾巴清偿）已收口，M 程序可自主执行项清零。
- 无窗栈可无头启动：`PETRI_DB_PATH`/`PETRI_LOCAL_DATA_DIR` 指向 `.petri-dev-user-data/data` + `R_SERVER_PORT=3001` 起 `node core/petri-server/server.js`；vite `:3000`；9223 离屏实例走 `scripts/start-test-instance.sh`（禁 `PETRI_TEST_ONSCREEN`，跑完立即 kill）。

## 当前待办分类清单（2026-11-15 读数 · 2026-11-16 交接落册）

> 事实来源：`acceptance/m-blueprint-2026-11-11/m7/gap-ledger.json` + `m4/m5a` 原档 + AUDIT-LOG 🟡 区当次核对。本节是交接快照，不是第二真相源：各项终态以各自 evidence 原档为准；清偿时在对应工作包收口并增量更新本节。

### 一、等外部条件（1 项）

| 项 | 卡点 | 解锁动作 |
| --- | --- | --- |
| P6 pressure 腿重采（BLOCK-448/449 唯一 external 原册） | `r-enrichment` capability bundle HTTP 404（probe 2026-11-15T07:37Z） | bundle 恢复 → `npm run g0:result-studio:p6:update` → `closeout:full` 复跑 |

附注：dev 库本体 4 组 seq 碰撞行将在下次后端启动时由 BLOCK-450 重排逻辑自愈（副本已验证），无需人工动作。

### 二、等用户裁决（U 类，Agent 不可代答）

| 项 | 来源 |
| --- | --- |
| U-04 档位收敛（IDE `accessMode` / `tools_only` 强制） | gap-ledger M-43 |
| TypeScript 双版本决策（`^5.9.3` vs `^5.5.4`） | M-65 |
| npm workspaces 迁移评估 | M-66 |
| test:changed 长耗时拆片范围 | M-59 |
| evals 接入 closeout（改 `package.json` + 裁决） | M-58 |
| MCP 白名单默认（BLOCK-434 M5-A 唯一 done-partial） | m5a 原档 |
| 竞争力纲 CP-16/17/18：vision 注记 vs BLOCK-176 work-package 注记冲突对账 | BLOCK-449 S0 登记 |

### 三、可执行候选（有实现路径，需用户发令）

| 项 | 说明 |
| --- | --- |
| M-55 SSE 真实端点行为测试腿 + 挂 impact-map rule | 当时 external-blocked=无窗栈未起；现栈可无头启动，属测试基建小包 |

### 四、等人眼签字（E 类，不代答）

- UI 设计专项 **22 条签字槽全空**（BLOCK-415~423 收口口径；路线材料在册，如 `docs/post-s7-h7-human-eye-route.md`）。
- M-42 / M-44（M6 期自动人眼路线 + 对比度观感确认）；M7 gap-ledger 口径 `pending_human_eye=2` 同源。

### 五、已裁决延期/挂起（条件触发，非欠账）

Windows 代码签名（待证书）· i18n 抽离（待国际化决策）· C-34 Claude 缓存断点（待 G1+ 预算）· CP-19 数据桥 WS 化（宜整段设计）· **G0 `macos-arm64: qualified` 视觉证据唯一性问题**（2026-07-27 裁决暂不发布故挂起；**重开条件=任何对外发布前必须先处理**）· G0-RS-P7 重资格（G1+）。

### 六、G1+ 出籍（阶段禁区，不算待办）

Provider 矩阵 / 公证签名 / GA / packaged 三轴对齐 / 远程发布 / `qualificationEligible` —— G0 开发期常态 · 不外推。

### 七、已过时注记（后续进展覆盖，随 audit:compact 自然归档）

M-14（lint errors 属在制 WIP——BLOCK-449 T1 已清账，warnings 2445 基线守住）；M-46 干净树三连部分（BLOCK-449 达成，P6 残腿归第一节）。

### 八、零触碰区与按纪律未跑（非债务）

- 12 项 untracked（第一节快照所列）——处置权在用户。
- `npm run check` / `npm run test:all:workspace` / `test:all:sharded`——按定向优先纪律留发布前 / CI，不是缺口。
