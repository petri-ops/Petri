# BLOCK-451 · M-55 SSE 真实端点行为测试腿（plan · completed）

> 发令链：主控提示词 2026-11-16「交接时点 main@4d3ef9c1」整段一次性发令+预授权裁决「从恢复到交付全程自主推进，禁止中途请求确认」；执行队列①probe 当次仍 404 → 走②M-55（唯一自主可执行候选）。Jev `next:suggest --supply=cloud` 返 QODER-ESSENCE-ABSORPTION 0.60，经核为规划大纲非可执行，按交接提示词队列②收敛到 M-55。
> 形态：轻量包（plan 不设独立 truthDomain/entrypoint，锚点=本文件 + AUDIT-LOG 条目，对标 TEST-INFRA-DEBT 先例）。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 事实基线（2026-11-16 当次读数）

- HEAD `4d3ef9c1`（交接落册）；原快照 `398b6dc4` 已被覆盖。
- 工作区存在「换标批 v4 定稿」tracked WIP：19 个 `icons/*` + `src/main/desktop-shell.js` + `icons/icon-tray.png`——他方在制资产，零触碰零提交。
- r-enrichment bundle `2026-11-16T08:12Z` 复探仍 404（`NoSuchBucket` / `x-oss-ec=0015-00000101`）→ P6 pressure 腿维持 external-blocked。
- M-55 原登记（`gap-ledger.json`）：`external-blocked`，note=「SSE 真实端点行为测试需 :3001 无窗栈实机；本包零后端改动」。
- 解锁前提已当次实测：后端无头启动 HTTP 200；`/api/events` 返 hello 帧；终态 task `ecd059a8…` 回放 22 帧、seq 1→20、终态 `run_terminal → done 摘要 → 裸 [DONE]`。

## 2. 范围

1. **纯函数判据**：`scripts/lib-sse-frames.mjs` — `parseSseStream()`（跨 chunk 半帧归并、裸 `[DONE]` 保真、`: ping` 透明）+ `classifySseFrames()`（终态顺序、failed 具名标红）。
2. **契约测试**：`test/m4-sse-real-endpoint.test.mjs` — 7 项（帧切分 / 半帧归并 / ping 透明 / afterSeq 续传 / 终态顺序 / 缺 DONE 负测 / failed 负测），HK-01 红绿先行。
3. **影响图挂载**：`test/impact-map.json` 的 `m-blueprint-program` 规则追加新脚本 pattern 与新测试 tests（单一归属，不双挂、不漏挂）。
4. **当次实机证据**：`acceptance/block-451/sse-real-endpoint-live.json`（真实 :3001 done task 回放采集）。

## 3. 非范围（exclusions）

- 换标批 WIP（icons/**、desktop-shell.js、icon-tray.png）——零触碰。
- P6 pressure 腿（bundle 404 external 原册）、U 类 7 项、E 类人眼签字、G1+（Provider / 公证 / GA / packaged 三轴 / 远程发布）。
- 不改后端 SSE 生产代码、不改 `MAX_AGENT_ITERS`、零新增依赖、零放宽基线。

## 4. 依赖与环境纪律

- 后端无头启动：`PETRI_LOCAL_DATA_DIR`/`PETRI_DB_PATH` 指向 `.petri-dev-user-data/data` + `R_SERVER_PORT=3001` + `PETRI_CREDENTIAL_BACKEND=file`，`node core/petri-server/server.js`；跑完 kill 进程。
- `scripts/lib-sse-frames.mjs` 新增后必须恰好命中一条 `classifiesScripts:true` 规则（否则 `test:changed` fail-closed 全量升级）——已挂 `m-blueprint-program`。

## 5. 验收门禁（预先声明，收口逐项对账）

| 门禁 | 预期 |
| --- | --- |
| HK-01 红绿 | 红=`ERR_MODULE_NOT_FOUND`（缺 lib）；绿=7/7 PASS |
| M4/SSE 邻域回归 | 37/37 PASS（新 7 + m4 三组 + loop-sse-contract） |
| impact-map orphan 守护 | 新文件已挂规则；存量 2 orphan（BLOCK-449/450 引入未挂）如实登记 W 归属 |
| `quality:types` | 0 红 |
| `docs:check` | PASS（本文件登记 registry active work-package + coverage 计数重算） |
| 当次实机读数 | `acceptance/block-451/sse-real-endpoint-live.json` allPass=true |

## 6. 完成语义

七项契约测试全绿、邻域无回退、impact-map 新文件单一归属、实机证据 allPass、门禁绿且零放宽/零新增依赖/零触碰换标 WIP 才标 completed。存量 orphan 与他方 WIP 属他包归属，如实登记不冒充本包通过。不用文档措辞升级运行时结果。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 7. 收口笔录（2026-11-16 · BLOCK-451 / COMPLETED）

**交付**：① `scripts/lib-sse-frames.mjs` 纯函数判据（`parseSseStream` 跨 chunk 半帧归并 + 裸 `[DONE]` 保真 + `: ping` 透明；`classifySseFrames` 终态顺序/失败具名标红）；② `test/m4-sse-real-endpoint.test.mjs` 7 项契约（帧切分/半帧归并/ping 透明/afterSeq 续传/终态顺序/缺 DONE 负测/failed 负测）；③ `test/impact-map.json` 单一归属挂载（lib-sse-frames.mjs pattern + 新测试 tests + `acceptance/block-451/**` pattern，归入 `m-blueprint-program`）；④ 当次实机读数 `acceptance/block-451/sse-real-endpoint-live.json` allPass=true。

**HK-01 红绿先行**：红步=`ERR_MODULE_NOT_FOUND`（scripts/lib-sse-frames.mjs 不存在，test fail 1）；绿步=7/7 PASS。M55-5 首轮暴露实现缺陷（loop 内部 `eventType:"done"` 误入终态序列）→ 修实现（终态序列只含 run_terminal/done 摘要/DONE）而非放宽断言，复跑 7/7。

**门禁实况**：M4/SSE 邻域 37/37 PASS（新 7 + m4 三组 + loop-sse-contract）；新文件 lint 0 warning（首轮 2 项 object-injection 用游标写法消除，未进抑制基线）；`quality:types` 0 红；`quality:secret` PASS；`quality:arch` PASS（cruise 全新）；`ui:audit:check` PASS（633 编号）；`docs:check` PASS（589 注册文档，BLOCK-451 active→completed + coverage 重算）；impact-map JSON 合法、新文件 unknown=[]。

**closeout 状态（如实，不冒充全绿）**：`npm run closeout` 前四门（audit:compact / hygiene / docs:check / ui:audit:check）PASS，第 5 门 `test:changed` FAIL，两个失败项均为**存量红、非本包引入**：① `test/scripts-platform-contract.test.mjs` — `scripts/build-packaged-isolated.sh` 缺 `# platform:` 标注（BLOCK-440 引入，HEAD 版即如此，`git diff HEAD` 对该文件为空）；② `test/test-affected.test.mjs:94` — `acceptance/block-450/evidence.json` 未被 impact-map 覆盖（block-450 目录 HEAD 已跟踪，433 个 acceptance 目录中仅 block-450 与 block-451 unknown；本包已修自己的 block-451→unknown=[]，block-450 存量未碰）。二者按「零触碰他包/存量归属如实登记」纪律保留，不冒充本包通过。

**范围守住**：零新增依赖 / 零放宽基线 / 零触碰换标批 WIP（19 图标 + desktop-shell.js + icon-tray.png）/ 新文件面与 WIP 零重叠 / 不改后端 SSE 生产代码 / 零撤销既有裁决。P6 pressure 腿（bundle 11-16T08:12Z 复探仍 404 NoSuchBucket）维持 external-blocked 原册。

**证据**：`acceptance/block-451/`（sse-real-endpoint-live.json，真实 :3001 done task `ecd059a8…` 回放：HTTP 200 / text-event-stream / 22 帧 / seq 1→20 / hasDoneSentinel / 终态 run_terminal→done 摘要→DONE / 零 issues）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
