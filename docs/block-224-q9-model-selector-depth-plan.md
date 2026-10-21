---
capability: q9-model-selector
goal: Q9 续项（D1/D2）——把模型选择器从「能切换」升级为「状态可解释、模型可治理」：发现失败/缺密钥/已隐藏逐行可见，模型行带上下文与默认思考档，隐藏模型不进选择器；切换模型可按配置带入默认思考档。
acceptance:
  - 后端 profile 归一保留 `visible`（默认 true）与 `defaultThinkingLevel`（off/standard/high，可选），未知值丢弃不炸。
  - `useAiSettings` 暴露目录状态：加载中、逐 profile 发现失败原因、凭据状态；发现失败不再静默回退。
  - 模型菜单（抽为独立组件）：不可用行禁用并给出原因（未配置密钥 / 模型列表加载失败）；隐藏模型不出现；行内显示上下文窗口与默认思考档；加载中/零可用模型有空态。
  - 设置页模型行新增 `ModelSelectorControls`（选择器可见 / 默认思考档），主面板行数不增。
  - 纯函数测试 ≥6 条（可用性分类/隐藏过滤/目录摘要/默认档归一）；邻域前端测试全绿；`theme-token-contract` + `quality:types` 绿；closeout 十三门 PASS。
  - 9223 离屏实机腿：模型菜单打开后的状态行/空态截图（真实 profile 若存在则带上下文行）。
reopen: D4 Auto（按任务/附件自动选模型，需任务分类契约）、低峰折扣（无云端账号体系，不复刻）、Workspace 权限限制（本地单用户无此概念）、模型级用量/价格展示、发现结果缓存 TTL。
status: completed
---

# BLOCK-224 · Q9 续项（垂直切片）：模型选择器深度（D1 + D2）

> 用户裁决：2026-10-21「先推送，Q9 余项和 Q-DOMAIN P4 data model 按顺序做完」。
> 母纲：`docs/qoder-essence-absorption-plan.md` §6-Q9（D1 模型选择器状态 / D2 每模型思考·上下文·可见性 / D4 自动选模型）。

## 1. P0 实码勘察（2026-10-21，只读实测）

| 面 | 现状证据 | 结论 |
| --- | --- | --- |
| 模型目录来源 | `useAiSettings.refreshFromBridge` 经 `bridge.listModels(profile,'')` 为每个 profile 展开模型；catch 分支**静默回退**到 `profile.model` | 失败不可见（D1 缺口） |
| 凭据状态 | 后端 `normalizeAiSettings` 已产出 `credential_status`（逐 provider 布尔），前端快照未消费 | 缺密钥模型仍可被选中（D1 缺口） |
| 可见性 | `ChatModelPreset` 无 `visible`；菜单列出全部 | 无法治理（D2 缺口） |
| 上下文/思考 | `contextWindow` 已有编辑面；思考只有会话级三档（`thinkingLevel.ts`），无每模型默认档 | D2 只有一半 |
| 菜单渲染 | 内联在 `SimpleChat.tsx`（两段 supplier/model），无加载/错误/禁用态；文件在 code-size 棘轮 2142 行 | 需抽组件，不能在原文件里长 |
| 设置行 | 模型行内联在 `DesktopSettingsPanel.tsx`（670 行棘轮）；已有默认模型/上下文/思考/视觉四控 | 再加两控必超棘轮 → 抽 `ModelEndpointRow` |

## 2. 范围

1. **后端归一**（`core/shared-backend/llm-providers/model-profile.js`）：保留 `visible`（布尔，默认 true）与 `defaultThinkingLevel`（off/standard/high）；非法值丢弃。
2. **前端目录模型**（新 `components/copilot/modelCatalog.ts`，纯函数）：
   - `modelAvailability(preset, { credentialStatus, discoveryErrors })` → `ready | hidden | missing_credential | discovery_failed`；
   - `buildModelGroups(presets, options)` → 过滤隐藏、逐行带 availability/reason/context/effort；
   - `catalogSummary(state)` → 加载中 / 失败渠道数 / 零可用提示。
3. **useAiSettings**：消费 `credential_status`，记录逐 profile 发现失败（不再静默），暴露 `catalog` 快照（含 loading）。
4. **模型菜单抽组件** `components/copilot/SimpleChat/ModelMenu.tsx`：供应商/模型两段；禁用行 + 原因；上下文/默认思考元信息；加载/零可用空态；选中后回调 `onSelect(preset)`（SimpleChat 负责应用默认思考档）。
5. **设置页**：新控件抽 `DesktopSettingsPanel/sections/ModelSelectorControls.tsx`（可见 + 默认思考两控，1 行挂载）；`DesktopSettingsPanel.tsx` 行数不增（棘轮只减不增）。
6. **测试**：`modelCatalog.test.ts`（≥6）、菜单组件测试（禁用/隐藏/空态）、设置行测试（两控写回）、现有 SimpleChat 测试回归。

## 3. 非范围（reopen）

D4 Auto（任务/附件自动选模，需求侧先定分类契约）；低峰折扣（无云端账号）；Workspace 权限（本地单用户）；价格/用量行；模型发现缓存 TTL；模型目录的手工增删（沿用 profile 编辑器与发现按钮）。

## 4. 红线

- 默认行为零变化：`visible` 缺省 true、`defaultThinkingLevel` 缺省不设（不覆盖用户当前档位）。
- 发现失败只降可见性、不改可用模型集合（回退行仍可用但标黄）。
- 密钥值永不下发渲染进程（只消费 `credential_status` 布尔）。
- `SimpleChat.tsx` 与 `DesktopSettingsPanel.tsx` 行数只减不增（抽组件净下降；不抬 code-size 基线）。
- 隐藏模型只影响选择器，不影响已绑定/正在使用的模型解析。

## 5. 验收门禁

- `node --test test/block224-*.test.mjs`（后端归一 + 目录纯函数若跨层）。
- `npm run test:files --prefix frontend -- src/components/copilot/modelCatalog.test.ts src/components/copilot/SimpleChat/ModelMenu.test.tsx src/components/desktop/DesktopSettingsPanel/ModelEndpointRow.test.tsx src/components/copilot/SimpleChat.test.tsx`
- `npm run test:changed` + `theme-token-contract` + `quality:types` + `gate:code-size`。
- 9223 离屏实机腿：`acceptance/block-224/`（菜单状态截图 + DOM 断言）。
- `npm run closeout` 十三门 PASS + canonical 回写 + UI-537。

## 6. 完成语义

`completed` 需：归一/目录/菜单/设置四件 + 测试 + 实机腿 + closeout。**明确声明**：D4 Auto 仍 open（下一刀）；本包只解决「状态可见 + 每模型治理」。

## 7. 收口（2026-10-21）

**结论：BLOCK-224 Q9 续项（D1+D2）completed。**

### 7.1 交付

- 后端 `normalizeModelProfile` 保留 `visible`（缺省不写键=true）与 `defaultThinkingLevel`（off/standard/high，非法丢弃）。
- `useAiSettings` 消费 `credential_status`、逐 profile 记录 `listModels` 失败（不再静默），快照新增 `catalog { loading, discoveryErrors, credentialStatus }`。
- 纯函数 `lib/model-catalog.ts`：可用性分类（ready/missing_credential/discovery_failed）、隐藏过滤、分组首选、目录摘要、上下文格式化。
- 模型菜单抽 `SimpleChat/ModelMenu.tsx`：加载/降级/空态行；缺密钥禁用并示因；发现失败标黄但可选；行内上下文 + 默认思考档。
- 设置页 `ModelSelectorControls`：选择器可见 + 默认思考两控（挂在渠道卡片网格）；`DesktopSettingsPanel.tsx` 保持 670 行、`SimpleChat.tsx` 降到 2136 行（棘轮不增）。
- 选中模型时若配置 `defaultThinkingLevel`，经 `applyThinkingLevel` 带入会话档位（未配置不覆盖）。

### 7.2 验证

- 前端 **31/31**：`model-catalog` 8 + `ModelMenu` 3 + `useModelAccessMenus` 2 + `ModelSelectorControls` 2 + `useAiSettings` 16。
- 后端 **3/3**：`block224-model-profile-normalize`（visible 缺省/false、thinking 三档/非法、既有字段不变）。
- 9223 离屏实机腿 **9/9**：`/api/ai/settings` 有 6 profiles + credential_status 且无 Key 明文；菜单打开并落定（状态「1 个渠道的模型列表加载失败（已回退到默认模型）」，2 行带「1M 上下文」）；亮/暗截图；设置页 4 组可见/默认思考控件。
- `theme-token-contract` 17/17；`quality:types` 0；`gate:code-size` PASS（总行数 23491）。
- closeout：lint 首轮抓 4 处测试类型断言（已修）；第二轮 `test:changed` 遇 `block70-mobile-gateway` Windows 临时目录 `ENOTEMPTY` 抖动（隔离复跑 11/11 + 窄复跑 `test:changed` PASS，其余门禁同树全绿）；lint 0 error、arch/secret/knip 全绿。

### 7.3 边界（reopen）

- D4 Auto（按任务/附件自动选模）仍 open：需先定任务分类契约与解析时机（发送前 vs 每轮）；本包只做状态与治理。
- 低峰折扣/Workspace 权限/价格用量不复刻；发现结果缓存 TTL 未做。
- 隐藏模型只影响选择器；已绑定/正在使用的解析不受影响（按设计）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
