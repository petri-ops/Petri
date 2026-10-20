---
capability: qdomain-p2ui-actions
goal: Q-DOMAIN P2-UI — 核心 act 工具去生信/FigCode 化，建立 pack uiActions 的动态发现、执行、前端 host 分发与 ack 闭环；旧单细胞/FigCode 动作与标签从核心移除。
acceptance:
  - 核心 `act` 只保留领域中性动作（rename_project/dataset/analysis、update_analysis_params、open_tool、ui_action）；无 switch_result_tab/focus_cluster/highlight_gene/select_cells/filter_table/label_cells/merge_datasets/open_replot/upload_data_hint/open_figcode_plot/update_figcode_editor，也无 single-cell/FigCode 页面标签。
  - 已安装 pack 的 `provides.uiActions` 在模型可见的 act 描述中出现；pack 缺失/停用 → 动作消失，调用返回 unknown_ui_action（fail-closed）。
  - `ui_action` 执行只接受 pack view surface 的动作；前端 host 打开目标 surface → iframe 收到 action → 回传结果 → POST act-ack；超时/缺失 honest 失败，不静默当成功。
  - 前端不再保留 sc*/figcode 遗留转义字段；过期/重放 action 不重复分发。
  - 定向测试 + 9223 实机腿 + closeout 十三门 PASS。
reopen: P2b 生信结果面落地后补 pack 的真实 single-cell actions；Q8 插件安装/信任面；动作级 undo；非 pack 的全局 UI action。
status: completed
---

# BLOCK-217 · Q-DOMAIN P2-UI：act 去域 + pack UI actions host

> 用户裁决：2026-10-20「行！ 按照你的建议来」=按 Q5 → **P2-UI actions** → P2b → Q6 → P3 → P4 推进。
> 前置：BLOCK-216 Q5 host（surface 注册表/pack `uiActions` 投影/`petri-pack://` iframe 桥）已 completed。

## 0. P0 实码勘察（2026-10-20）

| 面 | 现状 | 结论 |
| --- | --- | --- |
| `act` 工具 | `tool-defs/browser.js:101-215` 16 个 type；其中 12 个是单细胞/FigCode UI 动作 | 静态 enum 必须收成核心 5 + `ui_action` |
| 动作实现 | `act-tools.js:182-200` 单细胞 dispatcher + `plan-ui-tools.js` 全部 act 实现；`act-tool-core.js` 细胞筛选/页面推断 | 旧页面已退役（`App.tsx:34`），动作是死代码；删除 |
| 页面标签 | `act-tools.js:70-92` single-cell/figcode 页面需求与标签 | 核心领域泄漏，删除 |
| 前端遗留 | `copilotClient/types.ts:64-82` `actType` + `sc*`/figcode 字段；`parse.ts` 解析；除自身测试外零消费者 | 删除 sc*/figcode；保留通用 act 字段 |
| pack 贡献 | `pack-contributions.js` 已投影 uiActions；Q5 registry/PackSurfaceFrame 已有事件常量 | 缺动态 schema、执行校验、host 分发与 ack |
| ack 链 | `act-tools.js` `_registerActAck` 800ms；`/api/ai/act-ack/:token` 已存在；前端无通用消费者 | 复用，UI action 用 5s TTL |
| 事件投影 | `tool-events.js:114-145` 把 sc*/figcode 字段塞进 tool_result | 改为通用 `uiAction` + `ackExpiresAt` |

## 1. 切片

### P1 — 核心 act 去域 + 动态契约

- `act` 核心动作：`rename_project`、`rename_dataset`、`rename_analysis`、`update_analysis_params`、`open_tool`、`ui_action`。
- `act-tools.js`：删除页面需求/标签/单细胞 dispatcher；新增 `ui_action` 校验（已安装 pack 的 action + view surface）与 5s ack；审计保留。
- `plan-ui-tools.js`：只保留 `tool_plan`；删除 12 个 act 实现；`act-tool-core.js` 删除。
- `tool-defs/browser.js`：重写 act schema/描述；只保留通用属性 + `actionId`/`payload`。
- `registry.getProviderToolDefs()`：动态把已安装 pack 的 uiActions 追加到 act 描述（不新增工具、不改工具计数）。
- `tool-events.js`：删除 sc*/figcode 映射；新增 `uiAction`、`ackExpiresAt`。
- `agent-runner.js` / `tool-defs/session.js`：删除 FigCode/switch_result_tab 提示示例。
- 域中性 baseline 按改善下调；相关旧测试改为新契约。

### P2 — 前端 host 分发闭环

- `events.ts`：新增 `uiActionRequest`（payload: actionId/surfaceId/packId/ackToken/ackExpiresAt/payload）。
- `agentTaskStream.ts`：仅对未过期的 `tool_result`（act + uiAction + ackToken）派发 `uiActionRequest`；重放/过期忽略。
- `useUiActionHost`：校验 action → 打开/激活目标 pack surface → 派发窗口 action（requestId）→ 等 iframe 结果（4.5s）→ POST `/api/ai/act-ack/:token`；未知 action/超时都 ack 失败。
- `PackSurfaceFrame`：ready 前排队 action；postMessage 带 requestId；result 原样带回 requestId。
- `copilotClient/types.ts`/`parse.ts`：删除 sc*/figcode 遗留字段，新增 uiAction/ackExpiresAt。

### P3 — pack 契约与证据

- 测试 fixture pack 提供 view + uiAction；验证 pack 在位/缺失/停用三态。
- 生信 pack 的旧单细胞动作**不硬塞描述**：真实动作随 P2b 的 pack 结果面/UI 一起提供；本包只删核、通契约。
- 9223 实机：fixture pack 安装 → 打开 pack view → 从页面派发 `uiActionRequest`（与 stream 同一事件）→ iframe 显示收到 action → 截图；后端 ack 链由隔离测试覆盖。

## 2. 非范围

- 不实现 P2b 生信 Result Studio 结果面/单细胞 UI。
- 不新增 agent 工具（pack 动作走 `act(ui_action)`，不建 `ui_actions_list`）。
- 不做动作级 undo、非 pack 全局 action、Q8 安装信任/OAuth。
- 不把动作 payload 写日志/持久化原文；不做第二套 ack 通道。
- 不加依赖；不改审批四档/accessMode。

## 3. 验收与证据

| 项 | 判据 |
| --- | --- |
| 核心去域 | 全仓 grep 无 12 个旧 act id / single-cell/figcode 页面标签 / sc* 前端字段（测试夹具除外） |
| 动态 schema | pack 在位 → act 描述含 action id/label；缺失/停用 → 不含 |
| 执行 | 合法 action → uiAction+ackToken；未知/无 surface/非 view → fail-closed；ack 成功/超时/错误三态 |
| 前端 | 未过期 tool_result → 一次 dispatch；过期/重复不 dispatch；host ack 成功/失败可见 |
| 实机 | 9223 fixture pack：view 打开、action 到达 iframe、截图；证据 `acceptance/block-217/` |
| 回归 | block151 act enum / registry / tool-activity / copilotClient 邻域全绿；closeout 十三门 |

拆前基线：`test/block151-act-enum-description.test.mjs`、`test/agent-tool-registry.test.mjs`、`test/act-tool-core.test.mjs`、前端 `copilotClient.test.ts`；改前冻结，改后按新契约更新并复跑。

## 4. 风险

- **模型可发现性**：pack actions 不在 enum，靠动态描述；描述必须短、只列已安装动作，避免 prompt 膨胀。未知 action 返回可用清单（有界）。
- **重放**：tool_result 会持久化，靠 `ackExpiresAt` 拒绝过期重放；不在历史消息渲染时分发。
- **ack 超时**：iframe 首次加载可能 >5s；超时如实失败，不把动作当成功；后续可调 TTL。
- **动作安全**：payload 只进 pack iframe、不落库；pack 视图仍受 Q5 独立 origin/CSP 约束。
- **旧测试**：act-tool-core 删除需同步 impact-map/registry 引用，不保留化石测试。

## 5. 完成语义

completed 需：核心去域 grep 证明、动态 schema/执行/前端 host 测试、9223 fixture 实机腿、canonical 回写、closeout 十三门。生信真实动作与 P2b 结果面一起 reopen，不在本包伪造成“已可用”。

## 6. 收口（2026-10-20）

**结论：BLOCK-217 P2-UI completed。** closeout 十三门 PASS；9223 live **8/8**。

### 6.1 交付

- **核心 act 去域**：`act` 只保留 `rename_project` / `rename_dataset` / `rename_analysis` / `update_analysis_params` / `open_tool` / `ui_action`；删除 12 个单细胞/FigCode 动作、页面标签、`act-tool-core` 筛选/页面推断、前端 `sc*`/figcode 遗留字段；`agent-runner`/`system-prompt`/`verify_state` 的旧动作示例移除。
- **pack uiActions 动态契约**：已安装/启用 pack 的 action 追加到 act 描述（不新增工具/不改 enum）；执行时校验 action → pack view surface（fail-closed）；payload ≤8KB；5s ack TTL；结果投影 `uiAction`/`ackExpiresAt`。
- **前端 host 闭环**：未过期 `act(ui_action)` tool_result → `uiActionRequest` → `useUiActionHost` 打开 pack surface → PackSurfaceFrame 排队/带 requestId 投递 → iframe 回传 → POST `act-ack`；未知/超时如实失败。
- **公共 id 单源**：pack-contributions 返回 `publicId`；前后端不再各自拼 action/surface id。
- **生信 pack 边界**：旧单细胞动作是死代码，直接删除；真实动作随 P2b pack 结果面提供，本包不伪造 pack UI stub。

### 6.2 验证

- 后端 `test/block217-act-ui-actions.test.mjs` **9/9**（enum/动态描述/停用/未知/缺失 surface/合法 ack/payload 上限/旧动作拒绝/tool_result 投影）。
- 旧契约 `test/block151-act-enum-description.test.mjs` **5/5**；`agent-tool-registry` 邻域全绿；domain-neutrality 基线下调 **15 处**。
- 前端 host/stream/parse **8/8**；`test:changed` 前端 **213/213**；`quality:types` 0、`quality:lint` 0 errors、`quality:arch`/`quality:knip:check` PASS。
- 9223 live `block217-p2ui-actions` **8/8**：fixture pack action 在菜单出现 → `uiActionRequest` 自动打开 pack view → iframe 收到 action 并回传 → host 标记 `data-last-action-ok=true`；证据 `acceptance/block-217/`。
- **closeout 十三门 PASS**。

### 6.3 边界与下一步

- live 使用合成 ackToken（不伪造后端成功）；act→ack 成功链由隔离测试覆盖。真实单细胞动作未提供，属 P2b。
- 下一步：**Q-DOMAIN P2b Result Studio resultSurface**（使用 Q5 `resultSurfaceHost`；pack 结果面就位后补真实 actions）→ Q6 → P3 → P4。Q1/Q2b 可穿插。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
