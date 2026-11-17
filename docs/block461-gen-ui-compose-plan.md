---
capability: block461-gen-ui-compose
status: active
goal: W11 Gen UI 数据面形态演进首包（BLOCK-461）——`::compose` JSON spec 受控渲染 MVP（P0 探针→P1 内核→P2 数据面）：catalog 最小集经既有 ResultNode 插座渲染、手写校验器 fail-closed、directive parser 接线、$state 绑定复用 get-data 通道、widgetState 持久化复用既有通道；零新依赖、HTML 沙箱形态并存不退役
acceptance:
  - HK-01 红绿先行：spec 校验器 + catalog 分派 + parser 接线契约测试先红后绿
  - 无效 spec fail-closed 降级占位 + 降级留痕（不冒充渲染成功）
  - ResultNode 插座通电：spec 叶子（Metric/Table/Chart）经既有 ResultCardRenderer 渲染（零第二渲染真相）
  - $state 绑定走 gen-ui:get-data 既有通道；viewer 态走 gen-ui widget-state 既有通道
  - 既有 ::visualize 链零回归（双形态并存非替代）；closeout 定向门全绿
---

# BLOCK-461 · W11 Gen UI 数据面首包 `::compose`（active / P0-LAUNCH）

> **发令**：用户 2026-11-18 端到端预授权批量裁决——B-8「W11 发令 = 发令开工」+ B-6「W11 路径 = A（零依赖自实现）」+ B-7「W11 首包 = P0-P2」。
> **从属**：`docs/gen-ui-data-plane-evaluation-2026-11-17.md` §9（P0-P2 任务卡）+ `docs/next-work-blueprint-2026-11-16.md` W11 行 + master charter。评估 §8 边界继承：双形态并存非替代、不重写 artifact-plane-direction、不动 RS 资格线。

## 0. 形态设计（评估 §6 路径 A 落地）

- **指令**：`::compose{...}`（JSON payload，走既有通用 `::指令{...}` parser 形态；严格双冒号、未闭合前缀沿流式防闪烁契约）。
- **spec**：扁平树 JSON（`{ version, root, nodes: { [id]: { kind, parent?, props } } }`）——扁平化是审计单元（逐节点可寻址/可 diff），非嵌套文档。
- **渲染**：叶子数据组件（Metric/Table/Chart）映射既有 `ResultNode`（text/table/chart/image）经 `ResultCardRenderer` 渲染=**插座通电零第二渲染真相**；Card 为纯布局容器。
- **数据**：props 值可引用 `$state.<path>`（P2）→ 既有 `gen-ui:get-data` 通道（BLOCK-174 CP-11 artifact/job 只读绑定）取数；viewer 态（选中/滚动）走既有 gen-ui widget-state 通道（内存 + REST 持久化）。
- **降级**：validateSpec 失败 → invalid 占位 + console 留痕（与 ::visualize invalid 段同款），不冒充渲染成功。

## 1. 范围

- **P0 探针（S）**：`frontend/src/components/copilot/gen-ui/compose/` 新目录——`spec.ts`（类型 + validateComposeSpec fail-closed：未知 kind/悬空引用/环/深度超限/props 越界）、`catalog.tsx`（Card/Metric/Table/Chart 4 组件最小集，叶子经 ResultCardRenderer）、`ComposeCard.tsx`（渲染入口）；契约测试红绿。
- **P1 内核（S/M）**：`assistantDirectiveParser` 增 `compose` 指令名（parser 本体零改动，消费侧 references.ts 增名）；`GenUiMessageContent` 分派位增 compose 片段 → ComposeCard（invalid → 降级占位）；防注入沿 parser 既有契约（key=value/JSON 严格形态）。
- **P2 数据面（M）**：`$state` 绑定解析（`resolveStatePath`）→ `gen-ui:get-data` 通道取数（job/artifact 只读）；`visible` 条件（`"$state.x"` 真值求值）；ComposeCard 的 viewer 态接 widget-state 通道（scopeKey 沿 GenUiCard 同款）。
- **P5 收口随包走**：定向测试 + closeout + 证据落 acceptance/block461/。

## 2. 非范围（exclusions）

- P3 流式增量编译 / P4 模板与领域扩展点（可选拆包，不在本包）；
- `::visualize` HTML 沙箱链任何改动（双形态并存，QODER 窄桥继续依赖它）；
- 新 npm 依赖（路径 A 红线）；Result Studio 资格线；内核（agent-runner/registry）；
- catalog 组件的样式新写面（沿用 ResultCardRenderer 既有样式与主题 token；新增 CSS 仅限必要布局，走 CSS Modules + theme token 契约门）。

## 3. 验收门禁与证据

- **G1 红绿**：`compose.spec.test.tsx`（校验器 fail-closed 矩阵）+ `compose.catalog.test.tsx`（4 组件渲染/降级）+ `compose.directive.test.ts`（::compose 解析/防闪烁）先红后绿。
- **G2 零回归**：既有 gen-ui 邻域测试全绿（references/GenUiMessageContent/SimpleChat 相关）。
- **G3 P2 数据面**：$state 解析 + visible 求值 + widgetState 读写契约测试；实机腿（9223 离屏）真实 job 数据卡 CP-11 同款判据（跑完即 kill；stack 不可用→external-blocked 如实降级）。
- **G4 治理**：closeout 定向门 + impact-map 登记 + theme token 门（涉 CSS 时）。

## 4. 完成语义

- completed = G1–G4 全绿或明确 external-blocked + 六件套回写。观感项（若有）：不代签，pending_human_eye 如实登记。

G0 开发期常态 · 不外推 packaged/Provider/GA。
