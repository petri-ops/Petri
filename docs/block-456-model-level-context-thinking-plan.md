---
id: BLOCK-456
title: 上下文窗口与思考默认档模型级化 + 模型行悬停配置（UI-707）
status: completed
phase: P4
kind: plan
truthDomain: block-456-model-preferences-context-thinking
entrypoint: docs/README.md
---

# BLOCK-456 — 上下文窗口与思考默认档模型级化 + 模型行悬停配置

- 状态：completed（2026-11-17 P1-P4 收口：HK-01 红 11/15→绿 15/15 + 跨源矩阵 + 后端邻域 57/57 + 前端契约 72/72 + P3 前端 UI 13 文件 117/117 + theme-token 19/19 + types 0；P4 block456-live 19/19 + block455-live 复跑 18/18 + closeout 门禁，证据 acceptance/block-456/；UI-707 台账 in_progress 观感 pending_human_eye 不代签）
- P3 落地形态：ModelMenu 行渲染统一为 ModelRow（行体=选择按钮 + hover/focus-within 展开 sc-model-row-config 抽屉，禁行不展开）；左 quick 块删除；useContextWindowQuickPick → useModelQuickConfig（按 presetId 部分 POST，sync v2 no-op 防落写）；设置页主表 8→7 列（上下文列退役，min-width 1100→1000）+ contextWindowDrafts 死状态清理；ContextBudgetBar 窗口未知提示改指模型菜单悬停入口。
- 用户裁决原话：「上下文和思考强度应该跟着具体的模型走吧？ 当鼠标悬停在具体的模型名上的时候再出现才合适。 与此同时API Endpoint的上下文设置也就没有意义了。 你看着怎么优化一下？」（2026-11-17，附 composer 模型菜单截图）
- 串行槽位：BLOCK-456（BLOCK-455 已 completed 让出）；台账锚点 **UI-707**。

## 1. 现状与问题（立项勘察实锤）

1. **上下文滑杆写渠道级**：composer ModelMenu 左面板 quick 块（`ModelMenu.tsx:289-320`）经
   `useContextWindowQuickPick` 写 `preset.contextWindow`；choice preset 由渠道档案展开
   （`useAiSettings.ts:181-191` `...profile`），故滑杆语义=整渠道窗口，与「跟模型走」直觉不符。
2. **快捷写盘静默丢写（P1 漂移，本包修）**：`ai-settings-api.js:17-38 syncPresetContextWindow`
   以裸 id 建 map，但快捷面送的是 choice id（`profileId::encodeURIComponent(model)`，
   `model-provider-options.ts:52`）→ `windowById.get(profile.id)` 恒 miss → model_profiles 与
   兼容快照均不更新，notice 却报「已保存」。UI-696 先例的同步桥在模型展开态失效。
3. **思考档会话级、不跟模型**：`thinkingLevel.ts` localStorage 会话键；切模型带入
   `preset.defaultThinkingLevel`（渠道级字段，`SimpleChat.tsx:513-515`）；**auto 模式发送不读
   模型默认档**（`useChatStream.ts:355` 直送会话档）。橙色警告仍渠道级措辞
   （`ModelMenu.tsx:304`「该渠道未声明思考能力」），BLOCK-455 后能力门已模型级
   （`model-gateway.js:264-271`），UI 措辞漂移。
4. **设置页双入口冗余**：主表「上下文」列（`DesktopSettingsPanel.tsx:265`）+ 行展
   ContextWindowScale（:390-396）与 composer 滑杆同写渠道级字段；用户裁决退役。

## 2. 设计（单源 + 零迁移 fallback，BLOCK-455 D1 同模式）

- 新档案字段 `modelPreferences?: Record<model, { contextWindow?: number; thinkingLevel?: 'off'|'standard'|'high' }>`。
- 后端单源 `core/shared-backend/llm-providers/model-profile.js`：
  `resolveModelContextWindow(profile, model)` = modelPreferences[model].contextWindow > profile.contextWindow > undefined；
  `resolveModelThinkingDefault(profile, model)` = modelPreferences[model].thinkingLevel > profile.defaultThinkingLevel > undefined。
  normalizeProfile 消毒（正整数 round / 已知三档 / 未知键丢弃）。旧档案零行为变化。
- 前端镜像 `frontend/src/lib/model-preferences.ts`（薄镜像，跨源矩阵契约测锁定，改规则两侧同改）。
- **思考档生效序（用户裁决「跟模型走」）**：发送档 = 会话显式覆写（localStorage 键在场）>
  发送模型的模型级默认 > 会话当前值。Ctrl+T / composer brain 菜单 = 写会话显式覆写（留痕）；
  切模型**不再**写会话档（BLOCK-224 旧语义由本裁决取代）；悬停滑杆写模型级默认。
- **上下文消费面**：`agent-runner.js:650-655` presetCtx 与 `ai-chat.js:301-307` ctxWindow 改读
  resolveModelContextWindow(profile, modelName)；choice preset 携带模型级解析值。
- **sync 桥修复**：syncPresetContextWindow 用 parseModelBinding 解 choice id → 写
  `profile.modelPreferences[model].contextWindow`（权威）+ 兼容快照按 choice id 回写；
  裸 id（legacy 快照）仍写渠道级 fallback 字段，双形态兼容。
- **UI**：ModelMenu 左面板 quick 块整块删除；右栏模型行 hover / focus-within 展开内联
  compact 双滑杆（复用 ModelPreferenceControls，stopPropagation 不触发切换）+ 模型级警告
  「该模型未声明思考能力，档位不会发送上游」；行 meta 已示上下文/默认思考（presetMeta）。
  设置页主表上下文列删除（8→7 列）+ 行展滑杆删除 + contextWindowDrafts 清理；
  渠道级 contextWindow/defaultThinkingLevel 保留为只读 fallback（无 UI 入口）。

## 3. 非范围（exclusions）

- 不动迁移面（src/migrations/、core/petri-server/db.js）——零迁移 fallback 设计。
- 不动 BLOCK-200 思考能力门（attempt model 门控不变）、不动 thinkingParamsFor 协议映射。
- 不动 auto 解析序（auto-model.ts）、不动角色绑定对语义。
- 不做 hover 之外的新入口（设置页不再加模型级偏好编辑面；悬停即唯一编辑入口，键盘 focus 等价）。
- G1+ 不外推。

## 4. 阶段与验收门禁

| 阶段 | 范围 | 门禁 |
| --- | --- | --- |
| P1 | 后端单源 + normalize + sync 桥修复 + 前端镜像 | HK-01 红→绿 block456-model-preferences.test.mjs + 跨源矩阵；邻域 block455 契约 21/21 不回归 |
| P2 | 消费面接线 + 发送档生效序 | 定向 Node/前端测绿；useChatStream 发送档三态契约；types 0 |
| P3 | ModelMenu 悬停 + 设置页退役 + css | 组件测 + theme-token-contract 19/19 + types 0 + 主表 7 列契约 |
| P4 | 收口 | closeout 全门 + block456-live 离屏实机腿（悬停展开/写盘 roundtrip/自动发送档跟模型/设置页无上下文列/legacy fallback）+ UI-707 台账回写（观感 pending_human_eye 不代签） |

证据位置：`acceptance/block-456/`。完成语义：P1-P4 门禁逐项有当前证据 + canonical 回写 + docs:check
（post-h9 既有红 D5 除外，登记不修）。

## 5. 红线

- 用户 9222 主窗 / :3001 后端零触碰；实机腿走隔离 9223 + :3399 + stub，跑完即 kill；禁 PETRI_TEST_ONSCREEN。
- 🟡 迁移面 / untracked 用户资产 / 他包 WIP 零触碰；提交只按具体文件暂存。
- origin 同步已于 BLOCK-455 收口后经用户裁决 rebase 完成；本包不再涉同步裁决。

## 6. 收口记录（2026-11-17，P4）

- **实机腿**：`block456-live` 19/19 allPass（隔离后端 :3399 + stub :3398 + tmp 数据目录/DB 备份快照；用户 :3001/9222 零触碰，跑完杀 9223/后端/stub + 删临时目录 + 删探针项目）。覆盖：设置页 8 列无「上下文」/8 轨道 minWidth 1000、quick 块退役、行抽屉 focus-within 展开（合成 mouseMoved 不触发 :hover，键盘等价路径）、值跟模型走（mini 64000 覆写 / gpt-4o 128000 legacy fallback）、mini 未声明 reasoning 思考禁+原因、模型级写盘回环（200000+high 落 modelPreferences，渠道 fallback 不污染、mini fallback 不物化）、发送档 UI 实发请求体四连证（模型默认 high / 渠道兜底 standard / 显式 off 优先 / auto 跟解析模型 high）。
- **诚实边界**：stub 无真实模型（chat/completions 404），发送档证据=UI 实发 /ai/agent 请求体层（fetch recorder），后端消费面由 test/block456-model-preferences.test.mjs 契约层覆盖；离屏截图 compositor -32000 诚实降级；测试页级 Page.setBypassCSP（生产 CSP connect-src 只放行 :3000/:3001，csp-config.js；零生产代码改动，仅 9223 测试页）。首跑抓真两枚：快照库首项目渲染层不可访问→改 REST 建临时探针项目；发送体 wire 契约=渠道 id + modelName（非 choice id）→断言按实际契约修正。
- **邻域结算**：block455-live W1/W2/N1 断言随 8 轨道/1000px 升级并复跑 18/18（acceptance/block-456/p4-block455-live-rerun.txt）；ui695-331-modelcfg-time-live / ui696-model-preferences 断言升级为抽屉/退役契约（attach 调用方栈，本轮未跑如实标注）；EndpointEditorDensity UI-703 契约升级为上下文表头退役（归因注释在册）；ContextBudgetBar 提示改指悬停入口。
- **门禁**：closeout 聚合门（结果见 AUDIT-LOG 收口条目；post-h9 既有 DOCUMENT_MISSING D5 红按用户处置权登记不修）。knip.json 双 entry 列表登记 block456-live.cjs。
- **台账**：UI-707 in_progress（观感 pending_human_eye 不代签，待用户实机过目悬停抽屉形态）。G0 开发期常态 · 不外推 packaged/Provider/GA。
- **收口后 lint 棘轮清偿（同日追加）**：production warnings 1501→1483——18 处 security/detect-object-injection 根因修（own-enumerable 查找替代动态下标，前后端镜像同改；模型名来自远端 /models，旧写法可命中原型键，语义等价且更安全）。归因工具 p4-lint-attribution.mjs（eslint --stdin 新旧对跑 + added-line 交集，8f1aeb1e 入库）knip 双 entry 登记。留账 2 处不修：DSP:159（并发会话 UI-708 活跃面零触碰）+ ui-421 exhaustive-deps（origin 批行为敏感）。基线 1489/417/539 不动（--update 无既有基线下调路径，e2e 终局先例=实测低于基线即绿）。尺寸锚重打留因：SimpleChat 1958→1957（收口时基线早于末次 import removal 的补正）/ DSP 622→625（归因 UI-708 0b39ffba 合法增量代重锚）。清偿编辑后实机腿两连 17/19 → patch 备份三段 bisect（HEAD→前端 4→+后端 2→全量）逐段 19/19，八文件全部无罪，判瞬态环境波动；终态 digest 两连绿（full-restore + confirm）+ Node 45/45 + 前端 58/58 复跑一致。证据=p4-lint-settlement.txt + p4-live-bisect-*.txt / p4-live-full-restore.txt / p4-live-confirm.txt。