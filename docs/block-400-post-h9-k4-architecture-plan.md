---
capability: block-400-post-h9-k4-architecture
status: active
goal: 按第四轮蓝图 §4 K4 降低读者需要持有的概念数；可机械验证的防回退/对账做成棘轮门与行为断言，结构性重构按 W5b 逐刀纪律如实挂起带补腿条件。
acceptance:
  - 源码扫描契约数量只减不增门（新增即红）+ 负测，release-contract 已结构化校准入证据
  - 插件源单源防回退契约，装配面两处各自拼数组如实标注不冒充已单源
  - 三树版本漂移只读对账（typescript 漏网检出），不改任何 package.json / 不撤销既有裁决
  - H10 证据 tracked 状态与 120→90 已入仓的事实校准
  - W5b / 12 环 / knip 精确债 / 3 族行为断言逐件 deferred 带 sliceRef
  - docs:check / ui:audit:check / 定向 test:changed / closeout 全绿
reopen: W5b 独立切片发令后按 §5 逐刀推进；每刀拆前拆后同套绿
---

# BLOCK-400 · post-H9 K4 架构去补丁与单源收编

> 状态：active · P0-LAUNCH
> 发令：用户 2026-11-10 预授权连续工作「K0→K7 全部推完，全程零参与」。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## §1 立项自检（产品个性 · 强制问句）

**与 ZCode/Codex 的差别形态**：①**本地可审计**——源码扫描契约数量、插件源调用点、三树版本、环/键/巨型文件行数全部由仓内脚本复算；②**治理透明**——涉及构建链版本策略与核心循环重构的改动一律出 U 类材料/W5b 切片，不代答、不为「整完」硬闯；③**证据自证**——新机械门自带篡改负测，「解析面已单源」与「装配面仍两处」分级标注，不把防回退契约冒充行为断言。形态上是「通用 agent 可维护性维度」，不是领域内容。

## §2 运行时核实（多处蓝图读数已过时）

| 蓝图声明 | 实码核实 | 处置 |
| --- | --- | --- |
| K-20「4 族 `src.includes(...)` 源码扫描契约」 | **部分过时**：`release-contract.test.mjs:92-119` 已由 BLOCK-394 B-20 换成结构化 JSON 声明解析（`scripts/post-s7-tool-declaration.mjs`）；仍成立 3 族：`loop-orchestrator-subdomains.test.mjs:126-164` 行数锚（已重锚 1579 且修正 `wc -l` 口径）、`block199-config-drift.test.mjs:177-214`、`nso-w5b-second-truth.test.mjs:44-78` | 加只减不增棘轮门；3 族改行为断言需重写测试替身，挂 W5b |
| K-19「插件源装配三处」 | **部分过时**：BLOCK-395 B-18 已把 `server.js:77-80` 收敛到 `pluginLoader.resolveDefaultPluginSources()`，`registry.js:358` 同源；第三处「`agent-tools/plugin-loader.js:749-769`」路径写错，真实是 `core/petri-server/plugin-loader.js:750-760` 的单源本体。**但装配面仍两处各自拼 source 数组**（`registry.js:376-384`、`server.js:108-113`） | 防回退契约 + 装配面如实标注 |
| K-31「version-parity 10 处 / typescript+uuid 三树漂移」 | **部分过时**：`post-s7-version-parity-gate.mjs:27-38` 现为 7 个登记点（5 引用 + 2 字面量）；uuid `^9.0.1`、better-sqlite3 `^12.11.1` 根与 core 已同版；typescript 根 `^5.9.3`（dependencies）vs frontend `^5.5.4`（devDependencies）仍漂移，且 `post-s7-dependency-parity-gate.mjs:27-35` 只比 dependencies → **恰好漏网** | 只读对账检出 + U 类材料，不改版本 |
| K-22「12 环 / 330 键 / 动态 require 三处 / knip.json:38」 | 成立：`acceptance/block-109/arch-cycles-baseline.json` 12 环、`test/knip-baseline.json` 330 键、三处动态 require 仍在；`knip.json` 全量 `core/**/*.js` entry 行号漂到 `:41`（顶层 entry 已收窄为 10 个精确入口） | 防回退契约；精确债收敛挂 W5b |
| K-21「120 条未映射 / H10 在制候选」 | **已过时**：`test/impact-map-coverage-baseline.json` 当前 **90 条**；`acceptance/post-s7-2026-11-10/h10/` 8 份证据经 `git ls-files` 复核**全部 tracked**（BLOCK-395 收口已入仓），`unmapped-decay-batch2.json` 记 120→90、`cycle-clusters.json` 12 环全归因 | 终态按已入仓校准；剩余 90 条归规则需 owner 裁决 |
| K-18「五巨型文件 / loop-orchestrator 不入 MANIFEST」 | 成立：1579 / 2089 / 2080 / 1793 / 1605 行；`loop-orchestrator.js` 不入 `code-size-ledger.mjs:45-70` 且被 `test/post-s7-h9-size-ledger-trace.test.mjs:14-22` 反向钉住（另立 `scripts/post-s7-big-file-ratchet.mjs` 独立锚），非无人管 | W5b 逐刀挂起 |

## §3 交付（机械可验证子集）

1. `scripts/lib/post-h9-k4-architecture.mjs`：源码扫描契约计数、插件源调用点、三树版本对账、环/键/巨型文件读数、H10 tracked 复核（纯函数 + 只读）。
2. `scripts/post-h9-k4-source-scan-ratchet.mjs`：新机械门，按文件冻结当前 `includes`/行数锚计数，新增即红、清零后重打；带负测。
3. `test/post-h9-k4-architecture.test.mjs`：四族契约现状、插件源单源、版本漂移检出、H10 tracked、W5b 挂起项现状，逐条篡改负测。
4. `docs/post-h9-k4-decision-material.md`：U 类（typescript 版本统一需裁决）+ W5b 五刀切片与补腿条件。
5. K-18/19/20/21/22/31 逐件终态。

## §4 范围 / 非范围 / 风险

- **范围**：见 §3 五项 + 门禁取证 + canonical 回写。
- **非范围**：不改任何 `package.json` 版本/锁文件（零新增依赖）、不拆五个巨型文件、不改核心循环依赖注入消环、不动 knip 精确债、不重写 3 族测试替身、不动 10 项用户资产与蓝图原件、不撤销既有用户裁决、不放宽任何基线。
- **依赖**：K0（判据与台账）、K2（常量重构先例）。
- **风险**：新棘轮门若把测试文件自身计入 → 排除表 + 负测钉死；版本对账若误判 devDependencies → 显式区分「只读报告」与「阻塞门」，不擅自判红破坏既有裁决。

## §5 W5b / U 类挂起项与补腿条件

| 项 | 补腿条件 | 归属 |
| --- | --- | --- |
| W5b 五巨型文件逐刀拆分 | 一切片=一会话，拆前拆后同套定向测试绿；每刀 `gate:code-size` 例外只减不增、行数锚随交付刷新 | W5b |
| 12 环按簇消亡（抽 runAgentLoop / 依赖注入） | 归簇≠消亡；每消一簇 `--update` 下调基线 + 全量回归 | W5b |
| knip 330 键精确债 | 先处理 3 处动态 require 与 `core/**/*.js` 全量入口语义，再判死导出 | W5b |
| 3 族源码扫描契约换行为断言 | 需重写测试替身/能力真相（release-contract B-20 已示范），不能靠删 `includes` 字面 | W5b |
| 剩余 90 条 unmapped 归规则 | impact-map 归属裁决，禁一次性盲挂 | A + U |
| `typescript ^5.9.3` vs `^5.5.4` 统一 | 升/降版动构建链与 devDependencies 策略，属产品决策；裁决前只做只读对账 | U |

## §6 touchSurface / sharedBaselines

- `touchSurface`: `docs/block-400-*.md`、`docs/post-h9-k4-decision-material.md`、`scripts/lib/post-h9-k4-*`、`scripts/post-h9-k4-*`、`test/post-h9-k4-*`、`acceptance/post-h9-2026-11-10/k4/**`、canonical 六件套。
- `sharedBaselines`: `eslint-suppressions.json` / `test/knip-baseline.json` / `test/silent-catch-baseline.json` / `acceptance/block-109/arch-cycles-baseline.json` / `acceptance/block-92/size-baseline.json` 全部零改动。

## §7 验收门禁与证据

`npm run docs:check` / `npm run ui:audit:check` / `npm run test:changed` / `npm run closeout`；证据 `acceptance/post-h9-2026-11-10/k4/` 四字段齐备。
