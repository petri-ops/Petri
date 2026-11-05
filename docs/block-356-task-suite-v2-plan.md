---
capability: block-356-task-suite-v2
status: planned
goal: 升级 348 通用任务套件：修正 T3 过窄判据、补 headless 浏览器执行链、把 T7 纳入回归，使 8 任务套件可在无 GUI 环境完整复跑。
acceptance:
  - T3 判据改为内容等价物 / 双语关键词，T3 使命达成与机械判定一致。
  - headless 浏览器链可用或明确降级原因；T4 不再因「环境不可得」直接跳过而无替代证据。
  - T7 纳入回归套件；判据表重新冻结并留指纹；closeout 16 门绿。
reopen: G1+ 项；真实 Provider 矩阵；新增功能域；C-46 / G1 / O-1。
---

# BLOCK-356 — 通用任务套件 v2

- 批次总纲：`docs/next-batch-program-2026-11-05.md`；依据任务卡 B-1
- 阶段：**G0 开发期常态 · 不外推 packaged / Provider / GA**

## §1 立项依据

348 报告 §3 登记：T3 用「英文原句逐字在场」当判据过窄（机械红但使命实质达成）；P2 短板=浏览器执行链在 headless/后端态不可用（`core/petri-server/helpers/browser-connector.js` 依赖桌面 BrowserPanel webview 事件桥，无桥时 25s `transport_timeout`，且环回/私网被 web-fetch-policy 拒）；T7 因 C-45 缺陷阻断，355 修复后需纳入回归。

## §2 范围

- `acceptance/block-348/tasks.json`：T3 判据改「内容等价物 / 双语关键词 / 引用可核验」，写进冻结表并留新指纹。
- `scripts/block348-task-runner.mjs`：T7 纳入 `--all` 回归；`--tag` 隔离保留。
- headless 浏览器链：为 `browser-connector` 增加无 webview 桥时的**诚实降级路径**（明确返回 `headless_unavailable` + 可操作提示，而非 25s 超时后 `transport_timeout`）；若可实现轻量传输则接上，否则如实登记。
- 复跑 8 任务（带冻结 env），产出 `docs/block-356-suite-v2-report.md` + 证据 `acceptance/block-356/**`。

## §3 非范围

- 不重写 runner 架构、不引外部评测服务
- 不改 355 的裁剪修复、不碰 C-46 / C-47
- 不为了通过而放宽判据（T3 改的是**表述准确性**，不是降低门槛；需留新旧对照）
- 不新增工具域

## §4 验收

- 8 任务复跑有结果记录；T3 机械判定与使命判定一致
- T4 有明确结局（可用 / 诚实降级 + 原因），不再无声跳过
- T7 进入 `--all` 且结果可复算
- 判据表新指纹 + 新旧对照留痕（禁止事后调口径的审计证据）
- `closeout` 16 门绿

## §5 门禁

`node --test test/block356-suite-v2.test.mjs`（任务定义完整性、判据表不可变）、`quality:surface`、`quality:types`、`quality:lint`、`docs:check`、`closeout`；新文件登记 impact-map。

## §6 风险

- 全链复跑需 real provider → 环境不可得时以静态判据校验 + 已有轨迹为主证据，如实登记
- headless 浏览器链若涉安全策略（环回/私网拒绝）不得绕过，只能降级
- 判据改动易被误读为「放水」→ 必须留新旧对照与理由

## §7 DoD

任务定义 v2 + runner 更新 + 复跑结果 + 报告落盘；台账回写；registry → completed；总纲 §5 填行；显式路径提交。
