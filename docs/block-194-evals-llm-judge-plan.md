---
capability: evaluation
goal: BLOCK-194 = 评测基线 v2 第六切片·LLM-as-judge real 模式（阶段2 队列头唯一未落的「质量读数」面）。P0 实码勘察定骨架：**仓库已有一套校准过的评判门，本包接它，不另起第二套**。`core/petri-server/helpers/judge-core.js`（BLOCK-119 canonical 单源，ESM 薄壳 `scripts/lib/harness/judge-core.mjs`）已含 fit 五级量表出题 + faithful/goals noul + 三态路由（PASS/RETRY/ESCALATE/observe）+ 邻域 k=3 中位数复核 + fail-open 降级；门控阈值来自 `decision-thresholds.js:108` `'output-judge'` 注册表（fitPass=3 / fitRetry=2.5 / fitReviewBand=0.5，配对语料校准 precision 0.8254/coverage 0.7875，**改键必先重校准**=既有红线）。供给=`decision-api.askDecision`（配置优先级：decision-config 文件 > env `TYPESAFE_*`），judge 模型与被评主体模型（本机 deepseek）**不同源**，天然规避自偏好。本会话已实测该通道可用（收口声明前跑 `output:judge` 得 fit=3.05 PASS 并落 decision_log）。真实缺口不是「没有 judge」，而是**评测套件的质量读数没有承载面**：`evals/suites/real` 只有确定性判据（文件产物/工具调用/终态），能证明「做完了」，不能证明「做得好不好」。
acceptance:
  - P1 读数采集与 fail-closed 门（新 `scripts/lib/evals-judge.mjs`，纯函数 + judge 依赖注入，默认实现走 judge-core 薄壳）：`collectJudgeReading({ task, finalText, judge })` 产出 `{id, verdict, degraded, fit, faithful, goals, model, hintsCount}`——**判词与被判正文只存活在内存**，落报告的是元数据；`judgeGate(readings)` 的判定顺序即防假绿清单：`degraded:true`（judge 调用失败时 judge-core 按 fail-open 返回 `verdict:'PASS'+degraded`）**一律不计绿**、`verdict:'observe'`（无门控读数）计红、`RETRY`/`ESCALATE` 计红、空正文计红（不编造读数）。
  - P2 runner 接线与边界：`--judge` 仅对 `--provider=real` 开放，其余形态 `exit 2`——对脚本化 mock 回合或 BLOCK-193 罐头回放做质量判读=**伪读数**（且会毁掉回放层的零 API 属性）；判读发生在任务收口后、`sanitizeEvalTasksForStorage` 剥 `finalText` 之前；`evals/suites/real/*.json` 增可选 `judge:{request?,reference?,goals?}` 配置（additive，不动 190 catalog 五列与 191 准入 manifest 的派生字段）。
  - P3 棘轮与基线：`evals/judge-baselines/<suite>.json`，`compareJudgeVsBaseline` **只 gate verdict**（基线 PASS 而本次非 PASS=回归），`fit` 数值只记录趋势不参与回归判定——被评判的正文每次真模型生成都不同，用分数差判红必假红（抖动由 judge-core 的邻域 k=3 中位数复核在**单次读数内**消化）；基线写仅 `--update-judge` 显式审计（不破 BLOCK-191 源码门）。
  - 门禁：契约测（离线注入 stub judge，零网络）+ 实机 `--provider=real --judge` 真跑读数与建线 + 报告零正文零密钥复核（`quality:secret`）+ smoke/golden/real/real-replay 四套既有门零回归 + `test:changed --base=<193 收口提交>` + `npm run closeout` 十三门。
  - 完成语义：real 套件在确定性判据（做完了）之外多一路**独立质量读数**（做得好不好），该读数 fail-closed（降级/无门控/低判词一律不绿）、有棘轮（质量滑坡即红）、零人工参与（判词由模型产，门由代码判）。
reopen: judge 读数进 `evals/CATALOG.md` 第五列（BLOCK-190 形态扩展）；judge 与被评主体**同源**时的自偏好对照实验（需第二个本地 judge 供给，属 G1+ provider 矩阵面）；faithful 维度接入（需 reference 锚定语料，real 三任务当前无参考材料）。
status: active
---

# BLOCK-194 — LLM-as-judge real 模式（评测 v2 第六切片）

- 状态：`active`（2026-10-17 用户「继续」=承接上一轮明述「回『继续』我就开 LLM-as-judge real 模式，全程零参与」的发令；当日立项当日收口节奏）

## 1. 立项自检（对标不改魂）

差别形态：ZCode/Codex 类产品的 judge 通常是「云端裁判评云端答卷」；Petri 这里是**答卷产自用户本机的断网可跑主链（deepseek 本地凭据自给，BLOCK-192），裁判是另一路供给**，且裁判阈值有配对语料校准证据、改键必先重校准、读数与判词元数据入库而原文不入库。本地可审计体现在：每个读数都能用一条命令复跑到具体任务与具体阈值键，不靠任何人的人工印象。自检问句「这个能力与 ZCode/Codex 的差别在哪」的答案=**质量读数长在自己的证据链上**（188 组装契约 / 189 出站哨兵 / 191 准入双齐 / 193 录制回放 / 119 校准阈值），不是新挂一个外部评分器。

## 2. 范围（P0 实码核对）

| 面 | 实况（已核） | 处置 |
| --- | --- | --- |
| judge 内核 | `judge-core.js` 出题/解析/路由/邻域复核齐备，ESM 薄壳同源 | 直接调 `judgeOutput`，零新 judge 实现 |
| 阈值 | `decision-thresholds.js:108` 硬注册 fitPass=3/fitRetry=2.5/fitReviewBand=0.5 + 校准证据文件 | 不改键、不换模型（`model:'jev-1.13.0'` 与校准绑定） |
| 供给 | `resolveDecisionConfig`：decision-config 文件 > env `TYPESAFE_*`；无 key → `ok:false` → judge-core fail-open 返回 PASS+degraded | evals 侧把 degraded 判成「未测量」，绝不放绿 |
| 被判文本 | real 模式 `result.finalText` 来自事件流真回复 | 内存判读，报告不留原文（同 192 脱敏纪律） |
| 套件 | real 三任务只有确定性判据 | 增可选 `judge` 配置块（additive） |

## 3. 非范围（红线）

- **不新建 judge**：不出题、不算分、不路由，一律复用 `judge-core`（第二套评分器=第二真相）。
- **不改校准键**：fitPass/fitRetry/fitReviewBand 与 judge 模型名是配对语料校准产物，动它先重校准。
- **不把降级当绿**：`degraded`/`observe` 一律不绿；无 judge 凭据时诚实标未测量并 exit 非零，不静默放行。
- **不在 mock/replay 层判质量**：脚本回合与罐头回放的"质量"没有测量对象。
- **不外存判词原文与被判正文**；不碰 G1+（provider 矩阵/打包/公证）。

## 4. 执行

P1 采集与门（纯函数 + stub 可测）→ P2 runner `--judge` 与套件配置 → P3 棘轮基线 + 实机跑 → 契约测 → P4 closeout + 五件套。

## 5. 并行隔离

触碰面=新 `scripts/lib/evals-judge.mjs` / `scripts/evals-run.mjs`（judge 分支）/ `scripts/evals-gate.mjs`（`--judge` 口径）/ `evals/suites/real/*.json`（增 `judge` 字段）/ 新 `evals/judge-baselines/` / 新 `test/block194-*.test.mjs` / impact-map / 五件套台账。**不触碰** `core/petri-server/helpers/judge-core.js`、`decision-thresholds.js`、`decision-api.js`（只读复用）。真模型与真 judge 调用只在 P3 发生，零 dev 栈依赖、零人眼。
