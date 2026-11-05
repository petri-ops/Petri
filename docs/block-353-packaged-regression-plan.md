---
capability: block-353-packaged-regression
status: completed
goal: 在 rc.6 发布验收之后又落了 20+ 个工作包，本包在打包态复验这些改动：构建 + 空目录启动 + 一次完整任务，产出与 dev 行为的一致性结论或差异清单。
acceptance:
  - 构建产物结构核对表完整；空目录启动四项健康（migration / SPA / 后端 / 运行时探针）。
  - 打包态完成一次完整任务，有事件轨迹与产物证据；复用 BLOCK-348 任务脚本。
  - 差异清单逐条有原因与影响判定；阻断级问题明确标注并阻断言「一致」。
  - 证据落 acceptance/block-353/**，含截图 / 日志指针。
reopen: G1+ / 发布期项（签名、公证、DMG 分发、更新链）；macOS x64 runtime artifact；新增功能域；已取消四项不复活。
---

# BLOCK-353 — packaged 回归（计划）

- 登记状态：**completed（2026-11-05 当日收口）**——报告 docs/block-353-regression-report.md；两处打包阻断缺陷修复 + 四项健康 + T2 真跑一致 + ④ 补建 469ms
- 总纲：`docs/next-phase-program-2026-11-05.md`
- 依据：`docs/Petri-Desktop-Evaluation-Report-2026-11-04.md` §5 P2；`docs/stage4-stable-release-checklist.md`
- 阶段边界：**G0 开发期常态 · 不外推 packaged / Provider / GA**；「packaged」仅指本机未签名打包态验收

---

## §1 立项依据

Stage 4 稳定版本台账的打包态验收停留在 **rc.6（2026-08-16）**：arm64 构建结构、空目录启动、全新用户首用、旧版迁移、更新链均有证据。此后 20+ 个工作包改动了工具面、审批链、前端面板、sidecar 与资源路径，**从未在 asar 打包态复验**。若 asar / sidecar / native module 资源路径坏了，交付会直接断，而现有 14 门门禁全在 dev 口径下跑，看不见。

## §2 范围（逐条）

- 执行 `npm run build:mac-arm64`，核对产物结构：App / Helper / Core 架构、native module、sidecar 二进制、`resources/` 完整性。
- 打包态**空数据目录启动**：migration、SPA、后端健康、R / Python 探针（沿用 Stage 4 出口矩阵口径）。
- 复用 BLOCK-348 的任务脚本，在打包态跑**一次完整任务**（选 T2 数据任务或 T5 文档任务，不依赖网络），记录结果与 dev 对照。
- 核对 346 之后新增的资源路径：前端新面板、静态资源、sidecar 定位、`resources/` 新增项在 asar 内可读。
- 产出差异清单（`docs/block-353-regression-report.md`）：一致项 / 差异项（逐条带原因与影响）/ 阻断级问题单列。

## §3 非范围（越界即停工）

- 不做签名、公证、DMG 分发、更新链（G1+ / 发布期）
- 不补 macOS x64 runtime artifact（Stage 4 已标注「部分支持」，不宣称）
- 不修非阻断的产品差异（另立票）
- 不外推为「可发布」结论（本机未签名打包态验收）

## §4 验收（可度量）

- 构建产物结构核对表完整（逐项 ✅/❌ + 路径）
- 空目录启动四项健康（migration / SPA / 后端 / 运行时探针）
- 打包态完成一次完整任务，有事件轨迹与产物证据
- 差异清单逐条有原因与影响判定；**有未标注阻断项时不得宣称「一致」**
- 证据落 `acceptance/block-353/**`，含截图 / 日志指针

## §5 门禁（机械）

- `test/block353-artifact-check.test.mjs`：产物必需路径存在性（构建后跑）
- `npm run docs:check` / `quality:surface` / `quality:knip:check` / `closeout`
- 新增证据与脚本登记 `test/impact-map.json`
- 若改构建脚本 → `npm run gate:code-size` 同步核对
- 开工前总纲 §6.1、收口 §6.2 检查单

## §6 依赖 · 风险 · 边界

### 6.1 依赖

BLOCK-348（任务脚本）、BLOCK-350（打包态性能采集）。

### 6.2 风险登记

- 构建耗时长 / 需本机签名证书 → 用 Stage 4 已用过的「未签名本地只读挂载」边界
- 本机环境差异导致误判 → 差异清单必须区分「环境」与「产品」
- 打包态可能需要真实 Provider key → 选离线任务，不外推 Provider
- 打包产物体积大 → 证据只留指针与摘要，不入库二进制

### 6.3 touchSurface

`acceptance/block-353/**`、`scripts/block353-*.mjs`、`test/block353-*.test.mjs`、`docs/block-353-*.md`、`test/impact-map.json`

### 6.4 sharedBaselines

`test/impact-map.json`、`test/functional-surface-baseline.json`、`eslint-suppressions.json`；若改构建配置则 `package.json` → P6 源绑定检查

## §7 完成语义（DoD）

构建核对表 + 空目录启动证据 + 一次打包态任务 + 差异清单落盘；无未标注阻断项；总纲 §8 填行；registry → completed；README / roadmap / backlog / AUDIT-LOG 回写；`docs:reconcile` 0 issues；`closeout` 全绿。

**本计划不是开工授权**；状态流转与范围变更按总纲 §2。
