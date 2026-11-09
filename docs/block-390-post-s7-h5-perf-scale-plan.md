---
capability: block-390-post-s7-h5-perf-scale
status: completed
goal: 让性能证据从「门禁毫秒读数」升级为「可机器复算的证据资产」，并把必须 CDP 实机才能取数的判据（五段分解、DOM 节点数、帧率、自然长任务）逐项挂起，不拿毫秒绿冒充用户观感。
acceptance:
  - quality:perf 支持 PETRI_PERF_EVIDENCE 落机器可读证据（sourceCommit / platform / command / generatedAt / 每轮 rows / verdict）
  - 负测（植入慢样本必红）在改动后仍 10/10 绿
  - 三矩阵同源链：quality:surface 自动串能力地图生成器（H0 已接），人工漏跑不再可能
  - 五段分解 / DOM 节点上限门 / 帧率 / 请求体五类占比 / 自然长任务：逐项写清为何需实机与取数步骤
reopen: dev 栈（9223）可用；或 packaged 采样授权可得
---

# BLOCK-390 · post-S7 H5 性能与规模化（证据面）

> 发令：用户 2026-11-09 预授权连续工作。上游 §4 H5（B-22 / B-23 / B-09 / B-33）。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 交付

| 项 | 缺口 | 交付 |
| --- | --- | --- |
| 性能证据机器可读 | B-22 | `block350-perf-gate.mjs` 支持 `PETRI_PERF_EVIDENCE=<path>`：产出 JSON 含 `sourceCommit` / `platform` / `command` / `generatedAt` / `samples` / `samplesGreen` / `verdict` / 每轮 rows。默认不写盘（避免每次 closeout 在干净树制造无意义 diff） |
| 当次证据 | B-22 | `acceptance/post-s7-2026-11-09/h5/perf-evidence.json`：5/5 全绿，`sourceCommit=e517c326`，`darwin-arm64` |
| 负测保持 | B-22 | `test/block350-perf-gate.test.mjs` 10/10（植入慢样本必红的既有契约未被削弱） |
| 三矩阵同源（最小切片） | B-23 | H0 已把 `quality:surface` 串上 `block357-capability-map.mjs`（单一出口）；本包复核该链在干净树上确定性一致 |

## 2. 挂起项与取数步骤

| 项 | 缺口 | 为什么需实机 | 取数步骤 |
| --- | --- | --- | --- |
| 冷启动五段分解入门禁 | B-22 | require / 迁移 / 后端 health / SPA 200 / CDP 页面 五段里后三段必须有活进程与 CDP target | ①`dev-verify` 起栈 ②`block101-startup-timeline-live.cjs` 扩到五段 ③dev-infra「三面齐 + 编排器 stdout 指纹」写进断言 ④连续 5 次取最差轮 |
| DOM 节点上限门 | B-09/B-22 | 现只有 `block95-a2-frame-live.cjs`（<20000，独立脚本非门），节点数来自真实会话 | ①造 ≥400 条会话 ②`document.querySelectorAll('.sc-messages *').length` ③接成 closeout 门并补负测（植 2 万节点必红） |
| 滚动帧率读数 | B-22 | `requestAnimationFrame` 间隔只有在真实合成器里才有意义（happy-dom 无帧） | 滚动 2 屏 × 3 轮取 P50/P95；与节点数同批落盘 |
| 请求体五类占比 | B-22 | 需要真实请求（工具定义 / 系统提示 / 消息 / 工具结果 / 输出预留） | 从 `llm-transcripts` 与 `token_budget` 同源抽取；不允许「显示一套、请求一套」 |
| T7 自然长任务（去 `windowOverride`） | B-34 | 需要真实窗口 + 真实长上下文 | H7 与 8 任务套件同批 |
| 165 个零消费通道 / 2 个 storage key 逐件销号 | B-33 | 需要判断「是不是真没有用户入口」 | 按矩阵 P3 清单逐件：接线 / 删 / retain-with-reason（h5 台账） |

## 3. 证据

| 门 | 读数 |
| --- | --- |
| `npm run quality:perf` | PASS（连续 5 次采样全绿；最大 545/21/12/463 ms） |
| `acceptance/post-s7-2026-11-09/h5/perf-evidence.json` | verdict=pass，samplesGreen=5/5 |
| `test/block350-perf-gate.test.mjs` | 10/10 |
| `test/block357-shelf-and-map.test.mjs` | 8/8（同源链） |
| `npm run closeout` | 17 门全绿 |

## 4. 完成语义

`completed`（证据面）。五段分解 / DOM 门 / 帧率 / 请求体占比 / 自然长任务 = 需实机取数，逐项挂起且不冒充。

G0 开发期常态 · 不外推 packaged/Provider/GA。
