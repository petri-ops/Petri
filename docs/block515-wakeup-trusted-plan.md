---
capability: block515-wakeup-trusted
status: active
kind: work-package
canonical: true
truthDomain: block515-wakeup-trusted
entrypoint: docs/README.md
registeredAt: 2026-11-24
owner: main-agent
---

# BLOCK-515 · agent 唤醒 B 档：per-schedule 预授权白名单（plan）

> 发令：owner 经 Orca 转达主人「行的 你来吧不一定要问我的 用最合理的方式推进」三裁决（2026-11-24）第三项：唤醒审批语义裁定 **B（per-schedule 预授权白名单+预算硬顶）** 并开工实现。裁决材料=`acceptance/next-wave-rulings/WAKEUP-APPROVAL-SEMANTICS.md`。
> 代拍附加约束（owner 转达，逐条遵守）：白名单最小只读起步、per-schedule 显式配置；默认无授权=维持 guided；预算硬顶保守值；trusted 授予显式/可审计/可撤回；additive 不改 loop 三档契约。

## 1. 范围（additive，零新依赖，HK-01 红绿先行）

1. **store additive 三列**：`agent_schedules` 增 `auto_mode`（guided|trusted，默认 guided）、`auto_tool_allowlist`（JSON 字符串工具名数组）、`auto_budget_checked`（INTEGER 0/1，记录 trusted 授予时的 goal 预算校验留痕）。旧数据零迁移零行为变化。
2. **校验（fail-closed）**：`auto_mode='trusted'` 必须同时 ①非空白名单 ②白名单每个工具名都在 registry `listTools()` 声明面（未知工具名拒绝）③绑定了 **带预算的 active goal**（预算硬顶=既有 goalGate 80%/100% 机制，保守值=复用已验证的 goal 预算而非新造）；白名单可随时撤回（清空即回 guided 语义）。
3. **runner additive**：trusted schedule 提交时带 `context.automationMode='trusted'` 与 `autoToolAllowlist`（loop 契约三档现成，`loop-contract.js:303`；runner 现提交为默认 guided 逐字不变）。
4. **routes 透传一行**：`/api/ai/agent` 任务参数接收 `autoToolAllowlist`（仅落 params 供审计与执行面读取；不改变缺省行为）。
5. **执行面收窄（fail-closed）**：`agent-tool-interceptor.js` 增 additive 检查——任务 params 带 `autoToolAllowlist` 时，白名单外工具调用直接拒绝并审计（`auto_allowlist_denied`），不进审批队列（trusted 授权范围外=硬边界，比 guided 更严而非更松）。
6. **HK-01**：`test/block515-wakeup-trusted.test.mjs` 先红后绿：store 校验矩阵（无白名单拒绝/未知工具拒绝/无预算 goal 拒绝/撤回回 guided）、runner trusted 提交带档、interceptor 白名单外拒绝+白名单内放行、guided 默认逐字不变。

## 2. 非范围（exclusions）

- 唤醒触发面本身（reminder 到期自动提交=既有 schedule 链已具备，本包只补 trusted 档语义）；UI 勾选面（设置/schedule 面板另点）；DST/跨设备/G1+；loop 三档契约修改；C-43（已核码改判清偿，见 RULING-TABLE 行 1 纠错 `a9ba8f741`）。

## 3. 验收门禁（收口对账）

- block515 红绿证据 + block256/next01/interceptor 邻域回归 + 定向集全绿；收口 `npm run closeout`（存量红如实归属）。
- 证据=acceptance/block515-wakeup-trusted/；完成语义=plan/registry/AUDIT-LOG 同批翻 completed。

G0 开发期常态 · 不外推 packaged/Provider/GA。
