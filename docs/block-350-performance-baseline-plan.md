---
capability: block-350-performance-baseline
status: planned
goal: 为冷启动、长会话、大项目、打包态启动建立四条可复跑性能基线并接入 closeout 棘轮；本包只测量建基线，不做性能优化。
acceptance:
  - 4 条基线均可复跑，数值落盘且带采样次数与容差。
  - quality:perf 入 closeout 且红绿双样本负测通过（抬高基线 / 劣化指标均能判红，恢复后判绿）。
  - 每条场景有波动源说明，容差设定有依据；不改被测产品代码。
reopen: G1+ 项（APM / 云监控 / 跨机可比性）；性能优化本身另立票；新增功能域；已取消四项不复活。
---

# BLOCK-350 — 性能基线四条（计划）

- 登记状态：**planned（2026-11-05 立项，逐包发令开工）**
- 总纲：`docs/next-phase-program-2026-11-05.md`
- 依据：`docs/Petri-Desktop-Evaluation-Report-2026-11-04.md` §3.3（性能 2.5/5，七维度最弱）
- 阶段边界：**G0 开发期常态 · 不外推 packaged / Provider / GA**

---

## §1 立项依据

现有门禁全是**正确性**门，**没有任何性能退化门**。Stage 4 稳定版本台账只做过打包态「健康」冒烟（migration / SPA / R / Python 健康），无数值基线。UI-656（长会话 DOM 成本棘轮）、UI-389（500+ 文件夹具）长期挂起。评估报告把性能列为最弱维度，主因是「没有度量」而非「已证实慢」。

## §2 范围（逐条）

- 定义四条场景与指标：
  - ① **冷启动**（dev 后端 + 前端首屏）：TTFS / 首帧耗时
  - ② **长会话**（1000+ 消息）：滚动帧率 / 内存 / 输入延迟
  - ③ **大项目**（500+ 文件）：树加载 / 检索 / 结果面打开耗时
  - ④ **打包态启动**（未签名本地挂载）：首屏 + 一次任务可用
- 每场景写采集脚本（`scripts/block350-perf-*.mjs`），本机多轮采样取中位数，明确容差与判红条件。
- 基线数值落 `test/perf-baseline.json`：`generatedAt / sha / 场景 / 指标 / 中位数 / 容差 / 采样次数 / 环境说明`。
- 新增 `quality:perf` 门并接入 closeout。**先评估 `package.json` 改动对 Result Studio P6 源绑定的影响**，必要时同批重打证据（BLOCK-346 教训）。
- 产出基线报告（`docs/block-350-perf-report.md`）：四场景数值 + 采集方法 + 环境说明 + 已知波动源。

## §3 非范围（越界即停工）

- **不做性能优化**（本包只建基线；优化按报告结论另立票）
- 不做 profiling 深度分析 / 火焰图归因
- 不引第三方 APM / 云监控（G1+）
- 不宣称跨机器、跨 CI 可比性（本机 dev 口径，不外推）

## §4 验收（可度量）

- 4 条基线均可复跑（命令写进计划），数值落盘且带采样次数与容差
- `quality:perf` 入 closeout，**红绿双样本负测通过**：人为抬高基线 / 人为劣化指标均判红，恢复后判绿
- 每条场景有「波动源」说明，容差设定有依据（不得随意放宽）
- 不改被测产品代码；若必须插桩，插桩点写进计划并说明零行为影响
- `closeout` 门数 14 → 15

## §5 门禁（机械）

- `npm run quality:perf` 新门 + `npm run closeout` 复验
- 负测契约 `test/block350-perf-gate.test.mjs`
- `test/impact-map.json` 登记 `scripts/block350-*` 与 `test/perf-baseline.json`
- `package.json` 改动 → 检查 P6 源绑定
- `docs:check` / `quality:surface` / `quality:knip:check` / `quality:types` / `quality:lint`
- 开工前总纲 §6.1、收口 §6.2 检查单

## §6 依赖 · 风险 · 边界

### 6.1 依赖

BLOCK-348（复用其任务脚本与种子工作区作长任务 / 大项目场景）；BLOCK-353 复用本包打包态采集。

### 6.2 风险登记

- 性能指标波动大 → 多轮采样取中位数 + 明确容差；只防数量级退化，不追求绝对值精确
- CI / 他机环境差异 → 只在 dev 本机口径成立，报告写明不外推
- `package.json` 属 P6 源绑定集合 → 需同批重打证据
- 新门若反复误报会拖累后续包 → 容差与波动源说明必须写死，禁止事后调门

### 6.3 touchSurface

`scripts/block350-*.mjs`、`test/perf-baseline.json`、`test/block350-*.test.mjs`、`docs/block-350-*.md`、`package.json`、`test/impact-map.json`

### 6.4 sharedBaselines

`test/impact-map.json`、`test/functional-surface-baseline.json`、Result Studio P6 证据（`package.json` 变化时）、`eslint-suppressions.json`

## §7 完成语义（DoD）

四条基线 + 报告 + 新门 + 负测落盘；`closeout` 15 门绿；P6 影响已处置；总纲 §8 填行；registry → completed；README / roadmap / backlog / AUDIT-LOG 回写；`docs:reconcile` 0 issues。

**本计划不是开工授权**；状态流转与范围变更按总纲 §2。
