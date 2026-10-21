---
capability: q9-auto-model
goal: Q9 D4——「自动」档：按任务与附件在每轮发送前解析具体模型（有图片走识图绑定/视觉能力；否则走 Agent 绑定/工具能力；缺失则回落当前模型），开关持久化，选择器与 composer 显示当前解析结果。
acceptance:
  - `userPrefs.autoModel`（默认 false）注册；`/api/user/prefs` 读写。
  - 纯函数 `lib/auto-model.ts`：候选只取可选行（跳过缺密钥）、优先角色绑定、再能力位、再当前/首个；返回 preset + reason。
  - 发送、重新生成、队列自动发送三条路径都在调用时解析（不是全局替换 active 模型）。
  - 模型菜单新增「自动（按任务选择）」开关行 + 解析预览；开启时 composer 模型钮显示「自动」。
  - 测试 ≥6（解析优先级/缺密钥跳过/无候选回落/附图选择）、类型/主题门禁、9223 实机腿（开关+菜单状态截图）。
reopen: 按任务复杂度分级（小模型/大模型）、成本/时延权重、自动模式下的显式覆盖确认、解析结果落盘审计、多模态以外的能力路由（embedding/summary 独立链路）。
status: completed
---

# BLOCK-225 · Q9 续项（垂直切片）：D4 自动选模型

> 用户裁决：2026-10-21「Q9 余项和 Q-DOMAIN P4 data model 按顺序做完」。
> 母纲：`docs/qoder-essence-absorption-plan.md` §6-Q9 D4「自动选模型（Auto 档）」。

## 1. P0 实码勘察（2026-10-21）

| 面 | 现状 | 结论 |
| --- | --- | --- |
| 模型选择 | `useChatStream` 发送/重生成/队列统一用 `activeModel`（profile+model） | 无按任务解析层 |
| 角色绑定 | `ai_settings.model_role_bindings`（chat/agent/vision/...）由后端归一，前端只用 chat | Auto 可直接复用 agent/vision 绑定 |
| 附件 | SimpleChat `imageRefsRef` 持有本轮图片引用 | 可判定「有图 → 视觉优先」 |
| 可用性 | BLOCK-224 `model-catalog` 已有 ready/missing/discovery 分类 | Auto 候选只取可选行 |
| 偏好 | `user-prefs` 族支持布尔合并写 | 新增 `autoModel` 即可持久化 |

## 2. 范围

1. `userPrefs.autoModel`（默认 false，注册表 91→92 键）。
2. `lib/auto-model.ts`：`resolveAutoPreset({ presets, catalog, roleBindings, hasImages, fallbackId })` → `{ preset, reason }`；优先级=精确角色绑定 > 能力位（vision/tools）> 当前/首个可选。
3. `useAiSettings` 暴露 `roleBindings`（来自 `model_role_bindings`）。
4. `useAutoModelPreference`：读 `/api/user/prefs`、写回、失败可见。
5. `useChatStream` 三条路径在调用时解析并记录 `modelPresetId/modelName`；解析失败回落当前模型。
6. 模型菜单「自动（按任务选择）」开关 + 预览；composer 模型钮在自动档显示「自动」。
7. 测试 + 9223 实机腿 + closeout。

## 3. 非范围（reopen）

按复杂度分级、成本/时延权重、显式覆盖确认、解析审计落盘、非对话能力路由。

## 4. 红线

- 自动档只改**本轮的模型选择**，不写回 `active_chat_model_id`（关掉自动即回到原选择）。
- 候选必须通过 BLOCK-224 可用性门（不选缺密钥/隐藏模型）。
- 解析结果必须可见（菜单预览 + composer 标签），不静默换模。
- 默认关闭=零行为变化。

## 5. 验收门禁

- `node --test test/block225-*.test.mjs`（偏好键基线并入 block201）。
- `npm run test:files --prefix frontend -- src/lib/auto-model.test.ts src/components/copilot/SimpleChat/ModelMenu.test.tsx src/hooks/useAutoModelPreference.test.ts`
- `test:changed` + `theme-token-contract` + `quality:types` + `gate:code-size`。
- 9223 离屏实机腿 `acceptance/block-225/`；`npm run closeout` 十三门 PASS。

## 6. 完成语义

`completed` 需：偏好/解析/发送路径/菜单/测试/实机腿/closeout。**明确声明**：本包只做「按任务/附件」的确定性路由，不做成本模型或学习型 Auto。

## 7. 收口（2026-10-21）

**结论：BLOCK-225 Q9 D4 Auto completed。**

### 7.1 交付

- `userPrefs.autoModel`（默认 false，注册表 91→92 键）；`useAutoModelPreference` 读 `/api/user/prefs`、写回失败可见。
- `lib/auto-model.ts`：确定性解析（有图：vision 绑定 > vision 能力；无图：agent 绑定 > tools 能力；再回落当前/首个），候选必须过 BLOCK-224 可用性门；返回 `{preset, reason, role}` + 预览文案。
- `useAiSettings` 暴露 `roleBindings`（来自 `model_role_bindings`）。
- `useChatStream` 在发送与子代理启动时解析本轮模型（不写回 active 绑定）；队列/重生成复用同一 send 路径。
- 菜单「自动（按任务选择）」开关 + 解析预览；composer 模型钮显示「自动」并带预览 title；`ModelChip` 从 SimpleChat 抽出（SimpleChat 保持 2142 行，棘轮未抬）。

### 7.2 验证

- 前端 **33/33**：auto-model 5 + useAutoModelPreference 2 + ModelMenu 4 + SimpleChat 6 + useAiSettings 16。
- 配置基线 **4/4**（92 键）；`quality:types` 0；`theme-token-contract` 17/17；`gate:code-size` PASS。
- 9223 离屏实机腿 **8/8**：默认关闭 → 开启后菜单显示「开启 · deepseek-flash（Agent 角色绑定）」、composer 显示「自动」→ 偏好落盘 true → 关闭恢复具体模型、偏好 false；亮/暗截图。
- `npm run closeout` 十三门 PASS（收口时执行）。

### 7.3 边界（reopen）

- 只做确定性路由：不做按复杂度分级/成本/时延权重、不做学习型 Auto、不做解析审计落盘、不做自动档下的显式覆盖确认。
- 自动档只影响本轮请求，不改变 `active_chat_model_id`；关掉即回到手动选择。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
