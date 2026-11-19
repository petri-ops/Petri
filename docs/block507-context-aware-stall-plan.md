---
capability: block507-context-aware-stall
status: completed
phase: CLOSED
goal: 大上下文韧性票 1——①上下文感知看门狗首包预算 + ②停滞恢复强化（用户 2026-11-19 发令「彻底解决，能开整吗；长下文免不了，后面可能还会有 1m 上下文的量；被折磨多次」）：①首包预算 = base(env 默认 90s) + floor(预估 token/3000)×1s，封顶 600s，1M 量级 prefill 不再被固定 90s 误杀；②零可见交付输出的 stream_stalled 最多重试 2 次（总尝试 3 次）退避 2s/5s（options.stallRetryDelaysMs 可注入），deepseek 前缀缓存使重试成本最小化——直接回应实际痛点（生成开始后中途停摆）。
acceptance:
  - HK-01 红（①估算/缩放函数缺席 4 红 + ②恢复循环缺位 2 红）→ 绿（①5/5+BLOCK-338 10/10 零回归；②3/3+既有 W1 重试测试 4/4 零回归）
  - ②恢复强化：llm-client 零可见输出 stall 重试 1→最多 2 次（总尝试 3）退避 2s/5s（stallRetryDelaysMs 可注入）；重放安全判据不变（emittedOutput!==true）；全重试仍 stall 如实返回
  - 估算契约：CJK≈1 token/字符、其它≈1/4；messages+tools 计入（16k 工具定义拉长 prefill 的 BLOCK-338 实测形态）；粗粒度仅用于阈值缩放非计费口径
  - env 语义不破坏：PETRI_STREAM_STALL_FIRST_MS/IDLE_MS 仍生效，FIRST 变为 base 预算（非硬上限），封顶 600s 恒生效
  - 网关接线：requestBody 预估→阈值缩放→stall 错误 details 携带 estimatedTokens/firstTokenScaled（可观测）
  - 邻域零回归（model-gateway 19/19 + reason-taxonomy）+ closeout 定向 + 六件套 + commit/push
  - 零新依赖 / 观感零代签 / 不碰 G1+；阈值常数保守下限，待真实 1M 数据再校准（同 BLOCK-338 45→90s 先例）
reopen: 真实 1M 数据到手后校准常数；渠道/模型差异需要 per-channel profile 时另票
supersedes: 无（BLOCK-506 研究的落地票；票 2=读→摘要委托子 agent 化另票待设计）
---

# BLOCK-507 · 大上下文韧性票 1：上下文感知看门狗首包预算

日期：2026-11-19 · 用户裁决原文：「被这个问题折磨多次…想彻底解决…长下文免不了，后面可能还会有 1m 上下文的量」· 前置：[BLOCK-506 对标研究](./block506-large-context-benchmark-research-2026-11-19.md)（四件套已在册，缺口=固定阈值对超大 prefill 的误杀窗口）

## 0. 一句话

把看门狗首包预算从固定 90s 改为「base + 按请求体预估 token 线性缩放（封顶 600s）」：小请求零变化，1M 量级 prefill 获得数分钟级首包预算不再误杀；idle 段 60s 保持不变（生成开始后中途静默仍是死亡信号）。

## 1. 设计（含常数依据与诚实边界）

- **预估**：CJK≈1 token/字符、其它≈1/4；messages+tools 计入（BLOCK-338 注释在案的 16k 工具定义形态）。粗粒度、非计费口径。
- **缩放**：每满 3000 预估 token 加 1s（≈假设服务端 prefill 吞吐保守 3000 token/s+排队余量）；1M→+334s≈7 分钟预算；封顶 600s。
- **不缩放**：idle 段 60s 恒定——生成开始后 token 连续，中途 60s 静默在直连/代理任何形态下都是死亡信号（本次核实根因即此形态）。
- **诚实边界**：3000 token/s 与 600s 封顶是保守下限，未经真实 1M 实测——常数校准 reopen 条款在案（同 BLOCK-338 45→90s 校准先例）；看门狗治「误杀」，不治 provider 真停摆（那靠重试/拆分/换渠道，见 BLOCK-506）。

## 2. 实现面

- `stream-stall-watchdog.js`：+estimateRequestTokens / +resolveRequestStallThresholds（纯函数，可注入时钟不受影响）；既有 resolveStallThresholds 零改动。
- `model-gateway.js`：看门狗创建改用 per-request 阈值；stall 错误 details 增 estimatedTokens/firstTokenScaled。
- `test/block507-context-aware-stall.test.mjs`：五测（估算/小请求不缩放/缩放+封顶/env base 语义/既有零回归）。

## 3. 非范围

- 票 2=读→摘要委托子 agent 化（对标 Z2 Explore；sideTask/A7 形态待查后设计）另票。
- 渠道 fallback 策略（P1'）另案裁决；1M 窗口渠道选型归用户配置（contextWindow 来自渠道，压缩公式自适应）。
- 零新依赖 / 观感零代签 / 不碰 G1+ / 他方 WIP 零触碰。

## 4. 验收判据

- HK-01 红 4（函数缺席）→ 绿 5/5 + BLOCK-338 全量 10/10 零回归 + model-gateway 19/19；
- closeout 定向绿；证据=acceptance/block507-context-aware-stall/；
- G0 开发期常态 · 不外推 packaged/Provider/GA。
