# BLOCK-454 · 通用能力窄口 + DeepSeek adapter（plan · planned）

> 发令：用户 2026-11-16「按照你的建议来」——采纳「不做 DeepSeek 全家桶，做通用能力窄口 + DeepSeek 作为第一个 adapter」方向；用户先前疑虑「只是使用 deepseek 全家桶是不是太依赖了」= 本包的立项动机。
> 形态：BLOCK 完整工作包（多工作面 / 跨会话 / 有架构裁决：窄口定义、adapter 边界、非 token 计量口径）。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。本包是通用能力面扩展，非发布资格。

## 动机与产品形态自检

用户想让 Petri「更简单灵活好用」地把 DeepSeek 新端点能力用起来。直接做「DeepSeek 全家桶」= 把本地主权换成厂商依赖，丢掉 Petri 的魂。本包按反方向落地：

- **通用窄口是产品资产，DeepSeek 只是填进槽位的第一个 adapter**（如同 `deepseek` 现在是 LLM 注册表的默认实现，不是身份）。
- 立项自检「与 ZCode/Codex 的差别形态在哪」：每类能力都是**可插拔、可审计、可本地替换**的 adapter——搜索来源标签（已有 `web-search-provider.js` 传统）、OCR 产物走 artifact 留痕、每笔非 token 请求走 `cost.requests`/`cost.bytes` 审计。不是套壳调一家云 API。

## 范围（按端点分三层，分阶段串行）

### P0 — 契约核实（只读，产出结论不写产品代码）
- 逐页核实 DeepSeek 官方文档中**搜索 / OCR / Responses / Anthropic Messages / vision** 各端点的真实请求形态与鉴权；上一轮核实只有 OCR 逐页确认过，其余 URL 曾猜错回落首页——**不按未核实形状写代码**。
- 核实安装版 `C:\Users\Admin\Documents\Petri-Local\ai-settings.json` 的 vision/embedding 角色实际绑定，定位 `vision_failed: no_api_key` 的真实成因（dev dataDir 里 vision 绑 deepseek 且 key 可用，安装版可能不同）。
- 产物：`docs/block-454-endpoint-contract-findings.md`（或本 plan 加映节），逐端点标注 VERIFIED / UNVERIFIED + 文档深链。

### P1 — vision 修通（零厂商绑定，最小改动）
- 若 P0 确认是绑定配置问题：修正安装版/dev 的 vision 角色绑定口径 + 必要的设置页指引；架构层已有 family 归一（`model-gateway.js` 的 `OPENAI_FAMILY_PROVIDERS` + `convertVisionBodyForProvider` / `normalizeVisionResultForProvider`），不新造管道。
- 验收：`vision_failed: no_api_key` 在 key 可用的 deepseek profile 上不再出现；识图走 `image_url` 协议的契约测试绿。

### P2 — 搜索 adapter（窄口已留）
- 现有 `core/petri-server/helpers/web-search-provider.js`：`SEARCH_PROVIDERS = ['searxng']`、`search(query, options)` 窄口、来源标签、`cost.requests`/`cost.bytes`。按注释「加 Brave/Tavily/厂商 API 只加一个 adapter」加 `deepseek-search` adapter。
- **SearXNG 保持默认/本地主权首选**；新 adapter 是可选渠道，不替换。工具层与来源标签零改动（除必要的 provider 选项枚举）。
- 验收：adapter 契约测试（范围钳位/来源标签/未配置诚实报 `web_search_not_configured`/成本计量）；真实端点调用按 P0 契约，若无 key 则降级为契约级证据 + 诚实标注。

### P3 — OCR 通用窄口 + adapter（新能力维度）
- 新建独立 `ocr(file, options)` 窄口 subsystem（**不塞进 `registerProvider` 的 chat/embedding/both capabilities**——OCR 是工具语义）。补 knowledge 文档解析里扫描件 PDF「无文本层」的既有空白（当前零实现，仅 `knowledge-parsers.js:17` 一行注释）。
- 第一个 adapter 可并行留本地 OCR（离线可用）与 DeepSeek OCR（按 P0 契约）两条路；默认优先本地，云 adapter 可选。产物走 artifact 留痕，符合证据自证。
- 验收：窄口契约测试 + 扫描件 PDF 的 knowledge 解析集成测试；成本按 `cost.requests`/页计量（沿用非 token 计量传统，不进 token 预算）。

## 非范围（exclusions）

- **ASR / TTS / Responses API**：零实现且无明确消费方，缺的是需求不是实现；不在本包通用化。
- 不做「DeepSeek 全家桶」单一厂商绑定；不新增厂商专有硬编码到核心。
- 不动 LLM provider 注册表的 capabilities 语义（`chat|embedding|both` 封闭）；视觉是独立 vision provider，OCR 是独立工具窄口。
- 不动 token 预算模型；非 token 成本只记 `cost.requests`/`cost.bytes`。
- 不碰 UI-699 之外的设置页视觉重构、换标批资产、在制 WIP；不改 provider 默认槽位（deepseek 仍是默认 chat provider）。
- 不碰签名/公证/GA/Provider 矩阵等 G1+ 资格面。

## 依赖与前置

- P0 未 VERIFIED 的端点契约，对应 P1-P3 阶段不得开写（契约先行是硬门）。
- 计费口径沿用 `web-search-provider.js` 的 `cost.requests`/`cost.bytes` 传统，零新增计费框架依赖。
- HK-01 红绿先行适用于所有新行为契约（adapter 接入、OCR 窄口）；纯契约核实（P0）产出是结论，豁免红绿。
- 环境：dev 栈 CDP 9223 离屏（禁 `PETRI_TEST_ONSCREEN`）；后端代码变更须重启后端；验证投入与改动规模匹配——静态文案/CSS 类改动不上 CDP 深探（UI-699 教训）。

## 验收门禁（预先声明，逐阶段对账）

| 门禁 | 预期 |
| --- | --- |
| P0 契约文档 | 每端点标注 VERIFIED/UNVERIFIED + 官方文档深链；未核实项不进实现 |
| P1 vision | 契约测试绿 + `no_api_key` 成因消除或如实标注环境边界 |
| P2 搜索 | adapter 契约测试（钳位/来源/诚实报未配置/成本）绿；SearXNG 默认不变 |
| P3 OCR | 窄口契约 + knowledge 扫描件集成测试绿；artifact 留痕在案 |
| 通用 | HK-01 红→绿证据；定向测试 + quality:types/lint/secret/arch PASS；docs:check / ui:audit:check PASS |
| 实机（仅必要面） | P1 识图、P3 OCR 的实机腿按无人化阶梯选择；无 key/无扫描件样本如实降级，不伪造 |

## 完成语义

P0-P3 逐阶段验收门禁对账、每阶段 acceptance 证据落盘、canonical 六件套回写（plan/roadmap/handoff/AUDIT-LOG/UI 台账若涉及/docs:check）后才标 completed。阶段 `deferred` 必须用户显式裁决并回写状态头，禁半拆无主。push 到 origin/main 后收口。

G0 开发期常态 · 不外推 packaged/Provider/GA。
