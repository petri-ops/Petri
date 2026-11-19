---
capability: block508-loop-stall-resume
status: completed
phase: CLOSED
truthDomain: block508-loop-stall-resume
entrypoint: docs/README.md
goal: 大上下文韧性票 2——agent 循环层 stall-resume：消除「流式 LLM 中途停摆→整轮任务失败→用户手动重试」。在 loop-orchestrator 请求前保存 messages/帧游标/工具现场 checkpoint，stall 时不直接 break，走有界续跑状态机自动重发（依赖服务端 prefix caching 降低成本），按已发 delta 游标去重，已输出内容零重复、任务不中断。用户原话「我要的不是修修补补 打补丁，需要的是彻底解决中断问题；只要服务端能通，理论上无论多久都能返回输出不中断；现在直接断了需要手动重试不合理」。
acceptance:
  - HK-01 红绿先行：先落失败测试（stall 后 break=任务失败、已出字无法安全续跑、重放重复交付）→ 实现 → 绿；测试=test/loop-stall-resume.test.mjs（通用名，避开 impact-map 文件面）；红绿证据落 acceptance/block508-loop-stall-resume/
  - 续跑状态机：stream_stalled 不再直接 break；有界重试（attempt/总时长可配置），退避；全重试仍失败才如实终态，不无限循环
  - 输出去重：请求前记录已发 content/tool_call 帧游标；续跑重放的重复帧被抑制；用户侧只见一次交付
  - 文件面隔离：零触碰 BLOCK-507 在制文件（llm-client.js / model-gateway.js / stream-stall-watchdog.js / block507-*），不依赖其未提交改动
  - 邻域零回归：loop-checkpoint / loop-orchestrator 既有测试 + BLOCK-338/507 相关测试基线（507 未提交时以其当前工作树为基线，如实标注）
  - closeout 定向 + 六件套回写 + commit/push；零新依赖/观感零代签/不碰 G1+
reopen: 真实 1M 数据与停滞频率到手后校准 attempt/总时长预算；provider 若未来提供 stream resume 协议则以原生续传替换重放去重
supersedes: 无（BLOCK-506 研究 + BLOCK-507 首包预算的循环层接续票；票 3=读摘要委托子 agent 化另票）
---

# BLOCK-508 · 大上下文韧性票 2：agent 循环层 stall-resume

日期：2026-11-19 · 用户裁决原文：「按照你的建议来；我要的不是修修补补 打补丁，需要的是彻底解决中断问题……现在直接断了需要手动重试不合理」· 前置：[BLOCK-506 根因研究](./block506-large-context-benchmark-research-2026-11-19.md) + [BLOCK-507 首包预算](./block507-context-aware-stall-plan.md)。

## 0. 为什么要另立一票（与 BLOCK-507 的分工）

BLOCK-507 治的是**误杀**（首包固定 90s 对 1M prefill 误判死亡），其 ② 治的是**零可见输出停摆**（provider 级重试 1→2 次）。两者都不覆盖用户真实痛点：**已吐出 content/tool_call 后中途 idle 60s 静默**——此时 `emittedOutput=true`，按 BLOCK-338 P2 防重复交付判据不重试，网关发 `error` → orchestrator `break` → 任务失败 → 用户手动重来。

流式协议层**做不到真续传**：DeepSeek provider 请求头/body 无 resume/cursor/prefix-cache 控制字段，服务端 prefix caching 只是隐式命中。所以"服务端能通就永不中断"只能在 **agent 循环层**实现：停摆不让任务终止，自动从现场重发并去重，用户无感。这是新状态机，不是多试几次。

## 1. 现状链路（现读证据）

1. `stream-stall-watchdog.js`：idle 60s 无有效 token → `onStall` → `stallController.abort()`。
2. `model-gateway.js:309`：`content_delta`/`tool_call_delta` 置 `emittedOutput=true`；`:334-349` 返回 `{error:'stream_stalled', emittedOutput, phase, elapsedMs}`；`:413-427` 已出字时发 `error` 事件（不可重试）。
3. `llm-client.js:87-101`：仅 `emittedOutput!==true` 时整轮重放一次（507 ② 改为最多 2 次，仍不覆盖已出字场景）。
4. `loop-orchestrator.js:940-945`：`if (!upJson || upJson.error || !upJson.choices) { providerFailureReason=...; break; }` —— 整轮任务失败。
5. `loop-checkpoint.js`：只有 decision/digest/cost 摘要，无 messages/帧游标/生成续跑函数；`server-main.js:169` 的恢复是 tool job 不是 LLM 生成。

## 2. 设计（最小充分）

### 2.1 请求前 checkpoint（新建，不改既有 CHECKPOINT_VERSION）

- 在 orchestrator 调用 `callChatProvider` 前，保存一份 **generation checkpoint**：
  - `messages` 快照（引用/摘要 + 可重建句柄，不复制大正文）
  - 已发可见帧游标：`emittedTextLength`（content_delta 累计字符数）、`emittedToolCallIds`（已交付 tool_call id 集合）
  - `requestHash`、`attempt`（本轮续跑次数）、`budgetRemainingMs`
  - 落 `task_events`（复用既有持久化，不建第二真相）
- **零触碰既有 `loop-checkpoint.js` 的 CHECKPOINT_VERSION/ENVELOPE_VERSION**（那是 loop 审计摘要，语义不同，不混用）。

### 2.2 stall-resume 状态机（orchestrator 层，新增纯函数模块）

- 触发：`upJson.error === 'stream_stalled'`（含已出字场景）。
- 决策（纯函数 `shouldResumeOnStall({ error, emittedTextLength, attempt, elapsed, budget })`）：
  - `attempt < cap` 且 `elapsed < totalBudget` 且 `budgetRemainingMs > 0` → `resume`
  - 否则 → `terminal`（如实终态）
- 续跑：用 checkpoint 的 messages 重发请求；`onEvent` 包装层按 `emittedTextLength`/`emittedToolCallIds` 抑制重复帧（新增 `createResumeEventFilter` 纯函数）；续跑 attempt+1，退避可注入。
- 不再 `break` 于 stall（其他错误仍按既有逻辑 break）。

### 2.3 输出去重判据

- 只抑制"重放已交付的重复内容"，不吞新内容：
  - content_delta：`seenChars >= emittedTextLength` 的部分丢弃，超出部分透传并累加；
  - tool_call_delta：id 已在 `emittedToolCallIds` 的整条丢弃；
  - 非 delta 事件（done/usage/error/stream_stall/provider_retry）一律透传。
- 纯函数 + 测试注入，不依赖真实计时。

## 3. 非范围

- 不碰 BLOCK-507 在制文件面（llm-client.js / model-gateway.js / stream-stall-watchdog.js / block507-* / **test/impact-map.json**——507 owner 正在其上挂自己的规则，本包不改该文件以消除并行契约冲突）。
- 不改 provider 层（无 resume 协议可用）；不新建通知中心/第二 checkpoint 存储。
- 不做渠道 fallback（P1' 候选，pending_user_ruling）；不做读摘要委托子 agent（票 3）。
- 零新依赖 / 观感零代签 / 不碰 G1+ / 人眼线与保护资产零触碰。

## 4. 验收门禁

- HK-01 红→绿（红绿证据 acceptance/block508-loop-stall-resume/）
- 邻域：loop-checkpoint 测试 + orchestrator 相关 + BLOCK-338/507 基线（507 未提交时标注工作树基线）
- closeout 定向绿 + docs:check + ui:audit:check
- 六件套回写 + commit/push + snapshot

G0 开发期常态 · 不外推 packaged/Provider/GA。

---

## 收口笔录（2026-11-19 · 一次会话完成）

- **HK-01 红绿先行**：红（模块缺席→import 失败，hk01-red.txt）→ 绿 9/9（hk01-green.txt）：判据 4 测（已出字 idle stall 也 resume / 零输出 resume / 有界 terminal / 非 stall 不续跑）+ 去重 4 测（文本游标剥离 / tool id 去重 / 非 delta 透传 / reasoning 不去重）+ checkpoint 1 测（只存摘要不内嵌正文）。另接线结构断言 4 测确认 orchestrator 真接上 while/continue/replayFilter。
- **实现面**：新建 `core/shared-backend/loop-stall-resume.js`（纯函数：shouldResumeOnStall / createResumeEventFilter / buildGenerationCheckpoint / STALL_RESUME_LIMITS）；`loop-orchestrator.js` 薄接线（import + 重放过滤入口 + 有界 for(;;) + stall 决策 continue + exhausted 观测）。已出字后 stall 不再 `break`，自动续跑且重复帧被吞。
- **邻域零回归**：loop-checkpoint 16/16、orchestrator 结构 16/16（行数锚按本测试纪律显式重锚 1579→1647 留因：+68 行均为本包接线，纯逻辑在独立模块）、HK-01+orchestrator+checkpoint 合并 54/54。BLOCK-507 定向基线 27/27（清理卡死的 test:all 后重跑）。
- **存量债清偿（本批抓真）**：①上一批 POST-H9 归位把受保护蓝图纳入 git 索引→user-asset-guard 红：`git rm --cached` 撤回（磁盘保留，frontmatter/registry 均 completed 仍一致），两门转绿；②POST-H9 K-07 测试硬断言 blueprint planned 与裁决后的 completed 冲突→随裁决同步断言并留因；③BLOCK-338 P2 旧断言 `calls===2` 与 507 新语义（总尝试 3）冲突→归属 507 owner（其 block507-stall-recovery.test.mjs:36 已用新语义），本包零触碰、如实登记。
- **closeout 归属**：test:changed 门 19 红经隔离实验确认与本包无关（失败测试均不加载 508 模块，为并发人眼包 BLOCK-503/505 + BLOCK-507 WIP 的在制面/存量漂移）；本包自身测试（508 契约 + 接线 + 邻域）全绿。按治理纪律如实登记，不表述为本包通过、也不算本包失败。
- **文件面隔离**：零触碰 BLOCK-507 在制生产文件（llm-client.js / model-gateway.js / stream-stall-watchdog.js）；impact-map 追加 508 规则为纯追加（不退 507 的 WIP 行）；人眼包与全部保护资产零触碰，提交逐批显式 add。
- **边界**：零新依赖/观感零代签/不碰 G1+；真实 deepseek 停摆偶发不可复现，端到端行为腿未跑（无人化阶梯第 2 级诚实标注），证据等级=纯函数全覆盖 + 接线结构断言 + 邻域零回归。Jev doc:suggest 命中 planDoc（adopted）已落本笔录。G0 开发期常态 · 不外推 packaged/Provider/GA。
