---
capability: block-324-reason-taxonomy
status: active
goal: 统一结构化原因码 taxonomy（借鉴 dsh-superagent REASONS 封闭表）：封闭原因码注册表（code→{category,template}）+ 渲染器，第一批归并治理/审批族（判定序六层 deny/allow 原因 + 放权坡道审计），源码扫描锁「新增场景必须注册」；落点既有载体（拦截器信封/task_events），不建第二台账。
acceptance:
  - 注册表 `core/petri-server/helpers/reason-codes.js`：封闭 REASONS 表（category 封闭集 + {placeholder} 模板）+ renderReason/isRegisteredReason/listReasonCodes + GET /api/ai/reason-codes。
  - 机械锁：源码扫描测试（agent-tool-policy deny/allow 首参字面量 ⊆ 注册表；拦截器 permission.auto_allowed 的 reasonCode ∈ 注册表）——新增未注册场景即红。
  - 接线（加性零行为变更）：permission.auto_allowed 事件 payload 增 reasonCode/reasonText；既有 message/messageKey 契约不动。
  - 契约测试 test/block324-reason-taxonomy.test.mjs（渲染/未注册回退/源码扫描锁/事件接线）+ closeout 十一门 + 台账回写。
reopen: 决策原语域（decision_log reason 自由文本语义不同不强行归并）/其他业务域错误码（texture_source_hash_mismatch 等）渐进注册/前端渲染消费面。
---

# BLOCK-324-REASON-TAXONOMY — 统一结构化原因码 taxonomy 计划

- 立项裁决：用户 2026-11-01「开整」（承接同日建议：dsh-superagent 借鉴余项第一包；Jev 队列序首选候选）
- 前置：BLOCK-323 放权坡道（observe→allow）已全绿收官——本包把治理面散落的原因表达收敛成可审计的封闭集
- 唯一真相域：本文件（block-324-reason-taxonomy）

## 1. 定位（立项自检问句）

ZCode/Codex 的拒绝/放行原因是散落字符串，无统一词表、无渲染契约；Petri 收敛为封闭注册表 + 模板渲染 + 源码扫描机械锁——「可信与透明即能力」的词表层落地。与 dsh 的差别：dsh 的 REASONS 服务工单域决策（面板本地化渲染），Petri v1 服务治理审计面（信封/事件/REST 词表出口），不建第二台账、不改既有 message 契约。

## 2. 设计决策

1. **封闭集 + 注册即扩**：REASONS 用 `Object.freeze` 封闭；新场景=先注册再用（源码扫描机械锁背书）。
2. **加性接线零行为变更**：既有 deny 信封的 `reason`/`error`/`message`/`messageKey` 字段全部不动；新增的只有注册表本身、auto-allow 事件的 reasonCode/reasonText、REST 词表出口。
3. **decision_log 不归并**：其 `reason` 是 AI 决策自由文本（120 字），与确定性原因码语义不同，强并即失真——reopen 判档。
4. **模板是审计渲染契约，不是 UI 文案替换**：v1 不替换既有 message 文本（避免信封文案漂移），registry 模板供事件/未来消费面渲染。

## 3. 范围

- 新增 `core/petri-server/helpers/reason-codes.js`：REASONS（第一批=判定序六层 deny/allow 原因 + preflight 族 + 放权坡道 rule_auto_allow）+ renderReason/isRegisteredReason/listReasonCodes。
- `routes/ai-settings-api.js`：GET /api/ai/reason-codes（词表出口）。
- `agent-tool-interceptor.js`：permission.auto_allowed payload 加 reasonCode/reasonText（加性）。
- 契约测试：渲染/回退/源码扫描锁/事件接线。

## 4. 非范围（exclusions）

- 不改任何既有信封字段语义/文案；不动 decision_log；不归并 model3d/结果面等业务域错误码（渐进注册，reopen）；不做前端渲染 UI；G1+ 不外推。

## 5. 验收门禁

1. 契约测试红绿（注册表/渲染/扫描锁/接线）。
2. test:changed 全绿 + closeout 十一门。
3. 台账回写（handoff/backlog/AUDIT-LOG/DOC-REGISTRY）。

## 6. 完成语义

验收 1–3 全绿 → completed；实机腿豁免（纯后端词表层，REST 出口经契约测试 + closeout 覆盖，无 UI 面）。
