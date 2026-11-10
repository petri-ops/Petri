---
capability: post-h9-k4-decision-material
status: reference
goal: 汇总 K4 的 U 类版本策略裁决与 W5b 结构性重构切片，给出一页决策材料与补腿条件，Agent 不代答、不为「整完」硬闯。
acceptance:
  - typescript 双版本现状/候选/风险/推荐/证据/补腿条件六段齐全
  - W5b 五刀逐件有 sliceRef 与拆前拆后同套绿要求
  - 不改任何 package.json 版本/锁文件，不撤销既有裁决
reopen: 用户裁决版本策略或 W5b 独立切片发令后按候选另立工作包
---

# post-H9 K4 决策材料：版本策略 / W5b 逐刀

> 状态：U 类 `pending_user_ruling` + W5b `deferred`。本材料是决策输入，不是验收证据；
> `evidenceClass: decision-material`，`verdict` 禁用 PASS/verified/completed。
> 生成：BLOCK-400（2026-11-10）。阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 一、现状（实证）

| 项 | 事实 | 证据 |
| --- | --- | --- |
| typescript 双版本 | 根 `package.json:273` `^5.9.3`（dependencies）vs `frontend/package.json:72` `^5.5.4`（devDependencies） | file:line |
| 对账门盲区 | `scripts/post-s7-dependency-parity-gate.mjs:27-35` 只取 `pkg.dependencies`（注释「devDependencies 允许各树独立」），根/前端 typescript 分属两类 → 恰好漏网；该门未挂进 `closeout`（`package.json:177,261`） | file:line |
| uuid / better-sqlite3 | 根与 core 已同版 `^9.0.1` / `^12.11.1`，蓝图「uuid 三树漂移」已过时 | file:line |
| version-parity 门 | 现为 7 个登记点（5 引用 + 2 字面量），蓝图「10 处」是旧快照 | `post-s7-version-parity-gate.mjs:27-38` |
| 五巨型文件 | 1579 / 2089 / 2080 / 1793 / 1605 行，均超 700 预算；`loop-orchestrator.js` 不入 code-size MANIFEST 但由 `post-s7-big-file-ratchet.mjs` + `big-file-anchor.json` 独立锚住，且被契约测试反向钉住 | file:line |
| 12 环 / knip | 12 环全部归簇到已知根因（`cycle-clusters.json:38-48` 明写「归簇≠消亡」）；knip 330 键是上界，`knip.json` workspace 层仍有 `core/**/*.js` 全量 entry，3 处动态 require 仍在 | file:line |
| H10 证据 | 8 份经 `git ls-files` 复核全部 tracked；未映射 120→90 已入仓，剩余 90 条归规则需裁决 | 当前 git 索引 |
| 源码扫描契约 | release-contract 族已由 B-20 换成结构化 JSON 声明解析；其余 3 族 `includes`/行数锚仍在 | file:line |

## 二、候选

| 候选 | 做法 | 后果 |
| --- | --- | --- |
| **D1（推荐）** | 版本：本包只做只读对账把漂移检出并出材料，不改任何 `package.json`；架构债：加只减不增棘轮门与防回退契约，结构性重构全部按 W5b 逐刀挂起 | 零新增依赖、零版本变更、不动构建链；满足「证据上限」，32 条逐件有终态 |
| D2 | 立即把 frontend typescript 升到 `^5.9.3` | 动构建链与 devDependencies 策略，需全量 `quality:types` + 前端构建 + 锁文件重打；可能引入类型红，属产品决策而非机械对账 |
| D3 | 把根 typescript 降到 `^5.5.4` | 同上且倒退主树版本，风险更高 |
| D4 | 把 dependency-parity 门扩到 devDependencies 并判红 | 会立即让 closeout 红，等于用门禁倒逼版本裁决；既有注释明确「devDependencies 允许各树独立」，改门=撤销既有设计裁决 |
| D5 | 在本会话硬拆五个巨型文件 / 消 12 环 / 收敛 knip | 违反「一切片=一会话 + 拆前拆后同套绿」纪律（蓝图 :183 记两次如实挂起）；连续会话会污染基线证据 |

## 三、风险

- 版本统一未跑 `quality:types` 全量与前端构建就宣称可用 → 无证据写 completed，红线禁止。
- 归簇当消亡、棘轮冻结当债清零 → 五类证据冒充，蓝图 §1.4 禁止。
- 为过门放宽 `knip-baseline` / `arch-cycles-baseline` / `code-size` 例外 → 红线禁止；本包全部零改动。

## 四、推荐

**D1**：版本策略出材料等裁决；架构债交付「可机械验证子集」（源码扫描棘轮门 + 插件源防回退 + 三树版本只读对账 + H10 tracked 校准 + 环/键/巨型文件防洗白契约），结构性重构逐件写补腿条件。

## 五、证据（当前）

`acceptance/post-h9-2026-11-10/k4/k4-architecture-truth.json`、`k4-source-scan-ratchet.json`、`k4-version-parity-report.json`、`k4-w5b-slices.json`；`test/post-h9-k4-architecture.test.mjs` 19/19（含 13 条篡改负测）。

## 六、补腿条件

| 项 | 补腿条件 | 归属 |
| --- | --- | --- |
| typescript 双版本统一 | 用户裁决升/降/保持；裁决后改版本 + 重打三份锁文件（需依赖升级评审）+ `quality:types` 0 + 前端构建 + 前后同套绿 | U |
| W5b-1：五巨型文件逐刀拆分 | 一切片=一会话，拆前拆后同套定向测试绿；每刀 code-size 例外只减不增、行数锚刷新、`loop-orchestrator.js` 纳管不靠例外续期 | W5b |
| W5b-2：12 环按簇消亡 | 抽 `runAgentLoop` / 改依赖注入；每消一簇 `--update` 下调基线 + 全量回归 | W5b |
| W5b-3：knip 330 键精确债 | 先处理 3 处动态 require 与全量 entry 语义，再判死导出；不能靠删键计数 | W5b |
| W5b-4：3 族源码扫描契约换行为断言 | 重写测试替身/能力真相（B-20 已示范），不能删 `includes` 字面凑数；棘轮门随后 `--freeze` 下调 | W5b |
| W5b-5：剩余 90 条 unmapped 归规则 | impact-map 归属裁决，禁一次性盲挂；每批需 `nso-w5-impact-coverage` 门绿 | A + U |
| 插件源装配面两处合一 | `loadPlugins(sourcePlan)` 单一装配入口 + 跨表一致性漂移负测；属结构性重构 | W5b |

## 边界声明

本材料覆盖 K4 的 U 类版本策略与 W5b 五刀，**未裁决/未发令前不生效**，不写 verified/completed，不冒充行为测试、机械门禁、CDP 实机、人眼观感或真实任务成功。按蓝图 §5.3，K4 不停线空等，队列推进到 K5。
