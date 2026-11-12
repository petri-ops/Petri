---
capability: block-426-m0-criteria-calibration
status: completed
goal: 第六轮 M0 判据校准与可信起点，零产品行为变化，为 M1-M7 提供可信判据起点
acceptance:
  - M0-1 至 M0-6 六项各有当次证据，14 门读数可复算
  - 状态对账门与 gap-ledger 只读视图红绿先行负测全绿
  - 零放宽基线、零触碰他方在制 WIP、零 stage 零提交
reopen: 门禁读数或 WIP 归属变化后先重跑 M0 专项门再推进下一阶段
---

# BLOCK-426 · M0 判据校准与可信起点（第六轮 M 波次 · 第一包）

## 任务形态（TASK-FORM-TAXONOMY）

Q1 产出 = 判据/真相校准（结论 + 机械门），Q2 单会话有单一验收边界，Q3 新问题 →
**轻量包 / 治理对账批**（对标 L0=BLOCK-404、K0=BLOCK-396 先例）；独立 plan 文件承载范围与验收。

## 用户裁决来源

用户 2026-11-11「依据蓝图独立完成全部优化任务…按 M0 发令开工，逐阶段推进到 M7，全程不再向用户提问」。
按 `$petri-dev-infra` 预授权连续工作模式视为有效裁决并留痕。串行槽位发令前为空（层 1 active work-package = 0，
层 2 = `G0-LF`）；本包发令后层 1 = 唯一 `BLOCK-426`。

## 范围（M0-1…M0-6）

1. **M0-1**：`quality:lint` 2 errors 的 W 类归属登记（owner 收口，不代改在制文件）；warnings 分域只减棘轮核对既有实现并补植入负测。
2. **M0-2**：`quality:perf` 红轮——先核 `coreSha` 基线绑定与 `packaged_start` 采样口径，再按证据流程处理；禁止直接抬阈值/放宽容差/直接重采基线。
3. **M0-3**：数值口径单源（perf 矛盾结论降级 + registry/impact-map/closeout 门数当次现读取数）。
4. **M0-4**：翻转两份已完成蓝图的 registry status（`planned → completed`），加「front-matter 声明状态 vs 阶段包终态」对账门。
5. **M0-5**：汇总 4 套 gap-ledger 为**只读**剩余工作视图（不搬移原文、逐件保留 owner/终态），并修正 L7 90/93 计数口径。
6. **M0-6**：当次 14 门全量复取样，未取数项如实标注。

## 非范围（exclusions）

- 零产品行为变化：不改 `core/`、`src/`、`frontend/src/` 任何运行时代码；本包只新增 `scripts/` 与 `test/` 治理脚本、证据 JSON、canonical 文档。
- 不外推 G1+（Provider/公证/签名/GA/远程发布/packaged 三轴对齐）；不改 `workspace_exec` 默认放行；不给主循环加步数上限。
- 不重采 perf 基线、不放宽任何基线（`eslint-suppressions` / knip / silent-catch / code-size / arch-cycles / perf / EAR / UI 台账）。
- U/E/V/W 不代答；不触碰 89 M + 68 ?? 在制 WIP 的他方内容；零 stage / 零提交。

## 依赖 / 证据位置 / 验收门

- 前置：M0 无前置阶段；输出供 M1–M7 作为可信判据起点。
- 证据：`acceptance/m-blueprint-2026-11-11/m0/`（readings / WIP owner 表 / gap-ledger 只读视图 / 门负测红绿证据 / closeout 读数）。
- 验收门：`npm run test:changed` + `npm run docs:check` + `npm run ui:audit:check` + `npm run quality:lint:ledger` +
  新建 `gate:m0-criteria`（本包专项门，含 HK-01 红→绿负测） + `npm run closeout`。
- 出口：`closeout` 定向读数如实（W 红归属不冒充通过）、14 门读数可复算、零产品行为变化、零基线放宽。

## 完成语义

`completed` 仅当六项改进点各有当次证据且门禁读数如实登记；
未达证据上限的项标 `done-partial` 并给补腿条件，不得用文档措辞升级运行时结果。

## 判「补丁 vs 重构」

本包命中「同一处第二次叠加修复」信号（perf 结论在两份文档互相矛盾、数字口径此前已有 L0/K0 两套单源生成器）。
按治理 skill：不垫第五层，改为**scoped 收敛**——新增一份 M0 单源读数 JSON + 一个 front-matter 对账门，
既有 `scripts/post-k7-readings-generate.mjs` / `scripts/lib/post-h9-k0-readings.mjs` 零改动（不制造第三套并行真相，
本包读数只记当次门禁读数，与两套历史生成器职责不重叠）。无运行时重构，故 HK-01 豁免条件不适用于读数批，
但**新建机械门**必须红绿先行（先写植入必红负测，再写实现转绿）。

## 环境纪律

- 定向测试默认 `test:changed`，不跑 `test:all:workspace` / 根 `check`。
- 本包无后端/前端运行时改动 ⇒ 不需重启 :3001、不需 9223 离屏实机（实机腿归 M2/M4）。
- 关键门禁一律前台跑；长任务用 `task:run`/`task:wait`，exit 124/125 = unknown。

## 收口笔录（2026-11-11 · BLOCK-426 / COMPLETED，带 W/V 类红归属）

**交付**：M0-1 lint 2 errors W 归属登记 + warnings 分域只减 3/3 植入必红；M0-2 perf 红轮
先核 `coreSha`（`7493447930e3f558` 绑定有效、host 匹配）与 5/5 采样口径，判 V 类 `external-blocked`
（不重采、不抬阈值、不放宽容差），慢样本/抬阈值/coreSha 三组必红负测；M0-3 数字口径单源
`m0-canonical-readings.json`（14 门当次读数，含矛盾结论降级）；M0-4 第五轮蓝图 registry +
front-matter + README 三处状态翻转 + 状态对账门（post-h9 因受保护 WIP 与既有契约断言登记为
W 类 done-partial）；M0-5 4 套 gap-ledger 只读汇总视图 191 件零 in_progress、L7 90↔93 矛盾显式暴露；
M0-6 14 门全量复取样 + 6 项未取数如实标注。

**证据**：`acceptance/m-blueprint-2026-11-11/m0/`（readings / gap-ledger-view / wip-owner-table /
perf-adjudication / closeout-gates / six-dimension-review）。

**门禁实况（不写全绿）**：`closeout` **exit 1**（第 5 门 `test:changed` 拦停，1348 tests /
3 fail，前 4 门 PASS，后续 13 门 fail-fast 未执行）；3 fail = ① `UI-629` 布局 gap 锚（HEAD 的
`gap: 20px` 被在制 WIP 变量化为 `var(--ws-layout-gap)`，W 类）② P6 源绑定（detail 9 文件全为
M 状态在制 WIP，W 类）③ W5a 新测试未挂 rule（本包引入，**已修**，隔离复跑 14/14 绿）。
`quality:lint` / `quality:lint:ledger` / `quality:perf` 独立读数均红且归因 W/V；
`docs:check`(571) / `ui:audit:check` / `test:changed:list` / `gate:m0-criteria` / 11 项 HK-01 负测绿。

**HK-01 红→绿**：首跑 `ERR_MODULE_NOT_FOUND`（1 failed）→ 实现缺陷「缺 owner 被 fallback 兜住」
（1 failed）→ 复合 stage 真实派生根修后 11/11 绿。六维度评审无 P1，P2 一条（post-h9 W 类
done-partial）、Minor 一条（门读数人工录入，M4/M7 扩自动采集）。

**范围守住**：零产品行为变化、零新增依赖、零放宽基线（warnings 2445→2445、perf 493ms/30% 未动、
knip 330、arch-cycles 12、silent-catch 412、code-size 86605 行）、零 stage / 零提交、
零触碰他方在制 WIP（仅 5 个 canonical 文件精确增量或字段翻转）。U/E/V/W 不代答。

**遗留/补腿**：post-h9 状态三处统一翻转（owner 收口 + 用户裁决）；P6 源绑定（干净树 + owner 重采）；
UI-629 测试锚（owner 收口后同步 `--ws-layout-gap`）；`quality:perf` V 类重锚（干净树 + 全量证据）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
