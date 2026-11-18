---
capability: block466-w11-p3-streaming-first-slice
status: completed
kind: work-package
truthDomain: block466-w11-p3-streaming-first-slice
entrypoint: docs/README.md
goal: W11 P3 流式首切片（R2）——spec 增量编译 + 渐进渲染最小闭环：流式消息中的 ::compose 指令在 spec 完整前渲染稳定占位（不泄漏原始 JSON/不闪烁），spec 完整且合法后升级为受控渲染；复用 agentTaskStream 事件契约与既有 projectGenUiReferences pending 语义，零新增依赖；守 BLOCK-154 行 memo 边界与断线续传兼容
acceptance:
  - HK-01 红绿先行：流式投影契约测试先红（实现前）后绿——partial spec 不闪烁/首屏占位/合法升级/invalid 降级/围栏豁免/断线续传兼容（同累积 content 投影一致）
  - BLOCK-154 memo 边界契约绿（SimpleChatMessageRow.test.tsx 既有断言不回归；流式开关为稳定 prop）
  - 断线续传兼容断言在册（投影为 content 纯函数，与 afterSeq 重连历史无关）
  - gen-ui compose 邻域全绿（spec/references/templates/state/compose-card-jump）+ theme-token 19/19 + ui:audit:check
  - 零新增产品依赖；观感面 pending_human_eye 不代签（UI-709 保持 in_progress，登记流式切片增量）
  - closeout 定向门禁 + impact-map 登记 + 六件套回写
---

# BLOCK-466 · W11 P3 流式首切片（completed / P3-LAUNCH→CLOSED）

> **发令**：用户 2026-11-18「梳理剩余工作+不用人参与的提示词」预置裁决 R2 = W11 P3 流式首切片（五步串行 S2）。
> **从属**：`docs/gen-ui-data-plane-evaluation-2026-11-17.md` §9 P3（spec 增量编译 + 渐进渲染，复用 agentTaskStream 事件契约扩展；流式性能契约守 BLOCK-154 边界 + 断线续传兼容）+ `docs/petri-master-charter.md`。
> **存量对账**：agentTaskStream 事件契约（seq/afterSeq/done/reconnect，BLOCK-151/457）已完整，无需改传输层；真正增量=`::compose` 流式投影——`SimpleChatMessageRow.tsx:269` 现仅在 `!streaming && !pending` 时走 GenUiMessageContent，流式期原始 `::compose{...}` JSON 逐 delta 泄漏（闪烁），`projectGenUiReferences(text,false)` 已有 pending 占位语义但未在流式期启用。

## 1. 范围（scope）

1. **A · 流式投影纯函数**：在 `references.ts` 增 `projectStreamingCompose(text)`——薄封装 `projectGenUiReferences(text, false)` 并语义命名/导出，明确"流式期 compose 只出稳定占位不出原始 JSON"的契约；valid spec 不在流式期抢渲染（待 completed 升级，防半截 spec 闪烁）。
2. **B · 消息行流式接线**：`SimpleChatMessageRow.tsx` 流式 assistant 消息且 content 含 compose 指令前缀时，走 GenUiMessageContent(streaming)（内部用 A 的纯函数出占位），其余流式消息原样走 CopilotMarkdown（零行为变化）。开关为稳定派生 prop，不破坏 BLOCK-154 行 memo 身份不变量。
3. **C · 契约测试（HK-01 红绿）**：`references-streaming.test.ts`（前端 vitest）——partial/合法/invalid/围栏/防闪烁/断线续传兼容逐条；BLOCK-154 既有 memo 测试 + compose 邻域全绿。
4. **D · 证据**：`acceptance/block466-w11-p3-streaming/`，HK-01 红绿输出 + 邻域读数 + 断线续传兼容断言说明；观感增量如实登记 UI-709 in_progress（不代签）。

## 2. 非范围（exclusions）

- 改 agentTaskStream/SSE 事件契约（seq/afterSeq/done/reconnect 已完整，本包只复用不改）；
- 流式期实时渲染"半截 spec 的局部卡片"（评估 R4 性能边界 + 防闪烁——首片只做稳定占位，完整后才渲染，local-card 渐进=v2 候选）；
- ::visualize HTML 沙箱流（双形态并存，本包只动 ::compose）；后端产出契约；新增依赖；观感代签；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：`npm run test:files --prefix frontend -- references-streaming.test.ts` 先红后绿。
- **G2 邻域**：compose 全套 + references + SimpleChatMessageRow.memo + theme-token 19/19 全绿。
- **G3 治理**：docs/ui-audit/closeout 定向 + impact-map 登记 + 六件套。
- **实机腿**：9223 离屏尽力跑（流式 compose 占位→完成后渲染 DOM 断言）；不可行或栈未就绪→external-blocked 如实判档（观感不代签）。

## 4. 完成语义

G1–G3 全绿或明确 external-blocked + 六件套回写 + 证据落盘。观感面（占位/卡片视觉）pending_human_eye 不代签，UI-709 保持 in_progress。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 收口记录（2026-11-18）

G1 红→绿 8/8（HK-01）+ 组件 4/4；G2 邻域 115/15files + memo 3/3 + theme-token 19/19 + types 0；G3 docs/ui-audit/closeout 见 AUDIT-LOG。实机腿 external-blocked（backend :3001 未运行 + 无确定性 ::compose 流发生器 + 无合成注入 path），按 R2/无人化阶梯 L2 如实判档，不伪造 allPass。证据=acceptance/block466-w11-p3-streaming/。观感 UI-709 保持 in_progress 不代签。

G0 开发期常态 · 不外推 packaged/Provider/GA。
