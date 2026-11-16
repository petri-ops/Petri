# BLOCK-454 · 通用能力窄口 + DeepSeek adapter（plan · **completed** 2026-11-17 / P1-P5 全收口，P6 暂缓不阻塞）

> 发令：用户 2026-11-16「按照你的建议来」「计划还是要详细些」「deepseek 全家桶支持的功能是不是比较齐全，能全方位列举吗，我想都融入到 petri 中来」；立项动机=用户疑虑「只用 deepseek 全家桶是不是太依赖了」。
> 形态：BLOCK 完整工作包（多工作面 / 跨会话 / 有架构裁决：窄口定义、adapter 边界、非 token 计量口径）。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。本包是通用能力面扩展，非发布资格。

## 动机与产品形态自检

用户想把 DeepSeek 全家桶能力「全方位融入 Petri」。直接做「DeepSeek 全家桶」= 把本地主权换成厂商依赖。本包按反方向落地：

- **通用窄口是产品资产，DeepSeek 只是填进槽位的第一个 adapter**（如同 `deepseek` 是 LLM 默认实现，不是身份）。
- 立项自检「与 ZCode/Codex 的差别形态在哪」：每类能力都是**可插拔、可审计、可本地替换**的 adapter——搜索来源标签（`web-search-provider.js` 传统）、OCR 产物走 artifact 留痕、每笔非 token 请求走 `cost.requests`/`cost.bytes` 审计。不是套壳调一家云 API。
- **「都融入」的诚实口径**：全家桶 12 类能力中 Petri 已覆盖约 6 类；P0 全清单见 `docs/block-454-endpoint-contract-findings.md`。「融入」= 补齐缺口 + 让已有通道可换 DeepSeek adapter，不是把官方每个参数都搬进来。

## 全家桶能力全清单（P0 已核实，摘要）

详见 `docs/block-454-endpoint-contract-findings.md`（每项 VERIFIED + 官方深链）。摘要：

- **3 个对话协议**：Chat Completions（OpenAI 兼容）/ Responses（原生）/ Messages（Anthropic 兼容）。
- **7 项对话内联能力**：联网搜索 `deepseek_web_search`、深度思考搜索、阅读链接 `deepseek_read_url`、文件输入（Files API + `file_id`）、视觉理解（`image_url`/`file_id`）、模型内容安全 `safety_check`、会话标题 `title`。
- **5 个独立工具接口**：Search `/v1/tools/search`、Fetch（细节待补）、OCR `/v1/tools/ocr`、ASR `/v1/tools/asr`、TTS `/v1/tools/tts`。
- **模型**：`deepseek-flash`（V4.1 Flash）为主，`deepseek-v4-pro` 为强档；思考按协议用 `thinking` / `reasoning` 参数。

## 范围（按能力全清单分层，分阶段串行）

### P0 — 端点契约核实（**已完成 2026-11-16**）
- 产物：`docs/block-454-endpoint-contract-findings.md`，逐能力 VERIFIED + 官方深链 + Petri 落点判断。
- 遗留 UNVERIFIED：Fetch 独立端点细节、Responses 完整请求形态——对应阶段开写前补抓。

### P1 — vision 修通（零厂商绑定，小）——**已完成 2026-11-17（e2e 波次 W1）**
- 定位并修复 `vision_failed: no_api_key`：根因=UI-638 迁移盲区（旧安装版档案 capabilities 缺 vision 声明 → 迁移跳过 → vision 永绑无 key 的 dashscope-vision）。修复=迁移补第二判据（chat ∈ OPENAI_FAMILY ∧ deepseek 模型）+ capability 同批落盘；复用 `model-gateway.js` 的 `OPENAI_FAMILY_PROVIDERS` 归一，不新造管道。
- HK-01 红→绿：ui638-vision-default 4/4；邻域回归 57 项 0 红。证据：`acceptance/block-454/p1/`（绑定探针 + 红绿记录 + 修复记录）。external-blocked：Windows 安装版文件腿（跨机不可达）。
- 验收：有 key 的 deepseek profile 上识图不再 no_api_key（迁移后 vision 绑定可解析 + capability 门通过）；`image_url` 契约测试绿（block150 既有覆盖 + 本卡迁移契约）。

### P2 — 搜索 adapter（中）——**已完成 2026-11-17（e2e 波次 W2）**
- `web-search-provider.js` 窄口加 `deepseek-search` adapter（POST `/v1/tools/search` + Bearer，body `{query,count,need_content:false}`；响应归一到既有形状，rerank_score/authority 保留）；SearXNG 保持默认/本地主权首选（契约 9 钉住）。key 走凭据族（credential store 'deepseek'，与对话共用），web-search-config 不存凭据边界不变；schema provider 枚举扩 `deepseek`，snapshot capabilities.search 支持双渠道 + key-missing 诊断。
- HK-01 红→绿：block454-p2 契约 10/10（钳位/来源标签/未配置诚实报/成本计量/query 128 上限/401 不可重试）；邻域 53/53。secret/arch PASS，零新依赖。
- external-blocked（D2 预置）：真端点实机腿不做（无独立授权 key + 付费副作用），契约级证据覆盖。证据：`acceptance/block-454/p2/`。

### P3 — OCR 通用窄口 + adapter（大）——**已完成 2026-11-17（e2e 波次 W3）**
- 通用窄口 `ocr-provider.js`（工具语义，未进 registerProvider capabilities）：DeepSeek OCR adapter（POST `/v1/tools/ocr` multipart file+purpose，pages[].text 归一 + 版面标记探针 + cost.requests/pages/bytes 计量）；**local 槽位留接口**（D1 预置：不引依赖，选择即诚实报 not_implemented）。授权面=config family 'ocr'（默认关，P5-a 付费知情）+ `/api/ocr-access` REST 写面 + config-transfer 族登记；冻结基线 20 族/112 键。
- knowledge 扫描件接入：无文本层 PDF → attemptOcrParse（默认关）→ OCR 文本进分块/嵌入 + `ocr.json` artifact 全量留痕（provider/pages/cost）；未启用诚实 failed 指路，绝不静默空索引。
- HK-01 红→绿 13/13；邻域 86/86；secret/arch/types PASS，零新依赖。external-blocked：真端点腿（同 W2/D2 诚实原则）。证据：`acceptance/block-454/p3/`。

### P4 — 文件输入链增强（中，可并入 P3 收尾）——**已完成 2026-11-17（e2e 波次 W4）**
- Files API 窄口 `files-provider.js`（POST `/files`，purpose 三值 VERIFIED 补抓官方文档 + purpose 先于 file 400 强约束落实）；协议归一 `fileContentBlockForProtocol`（Chat file / Responses input_file / Messages document）+ `anthropic.js` 自动带 `anthropic-beta: files-api-2025-04-14`（含 file 块才带，对照钉住）；knowledge 对接 `uploadKnowledgeDocumentForChat`（显式动作不自动上传，P5-a）。
- file_id 归属注册表 `files-registry.js`（fail-closed 三态：未知 id/注册表损坏/归属不匹配——BLOCK-196 教训：校验不空转）。
- HK-01 红→绿 12/12；邻域 74/74；types/secret/arch PASS 零新依赖。external-blocked：真实文档问答实机腿（同 D2 诚实原则）。证据：`acceptance/block-454/p4/`。

### P5 — Responses / Anthropic 协议 adapter（中，可选）——**已完成 2026-11-17（e2e 波次 W5，D3 预置=做）**
- UNVERIFIED「Responses 完整请求形态」先补抓官方 create-response 页 VERIFIED（findings 文首补记）再实现：`responses.js` adapter（provider 'deepseek-responses'/protocol 'responses'，OpenAI-compat 面零改动）；max_output_tokens 参数名逐字；tools function 展平 + 内联工具透传；**safety_check/title 仅参数级透传不替换本地治理**。四投影不丢（thinking/tool_use/citations/refusal）；SSE 无 [DONE] 流式 + 终帧 flush（测试抓真缺陷当场修）。Anthropic Messages 属配置态零代码（W4 已补 files beta header）。
- thinking 映射扩 'responses'（off→reasoning.effort=none / high→max；standard 不发参），BLOCK-200 冻结面复验绿；HK-01 红→绿 9/9；邻域 61/61；external-blocked 实机腿（同前）。证据：`acceptance/block-454/p5/`。

### P6 — ASR / TTS——**已完成 2026-11-17（e2e 补充波次；用户裁决「剩下没做的一次性搞完」= 需求场景到位，覆盖原 D7 暂缓）**
- 语音窄口 `asr-provider.js`（POST /v1/tools/asr multipart，**魔数格式守卫**仅 16bit PCM WAV/Ogg Opus，≤8MiB/120s）+ `tts-provider.js`（POST /v1/tools/tts JSON，voice stella|tide/format wav|pcm 白名单，text ≤10000 计费字符）；WS 流式留接口不实现不冒充。诚实失败全链 + 成本计量（requests/bytes/chars）。
- config 族 'speech'（默认关 P5-a）+ `/api/speech-access` REST 写面 + config-transfer 登记；冻结基线 21 族/117 键。
- agent 消费面：`transcribe_audio`（工作区音频→文本，语音输入）/ `speak_text`（文本→音频落 .petri/audio/ 幂等，朗读）——registry 契约 + tool-metadata + tool-defs 三面在场；UI 能力渠道第三槽位（R1 显化）。
- HK-01 红→绿 11/11；邻域 56/56；types/secret/arch PASS 零新依赖。external-blocked：真机云调用腿（同 D2）。证据：`acceptance/block-454/p6/`。

## 非范围（exclusions）

- 不做「DeepSeek 全家桶」单一厂商绑定；不新增厂商专有硬编码到核心。
- 不动 LLM provider 注册表的 capabilities 语义（`chat|embedding|both` 封闭）；视觉是独立 vision provider，OCR 是独立工具窄口。
- 不动 token 预算模型；非 token 成本只记 `cost.requests`/`cost.bytes`。
- 不碰 UI-699 之外的设置页视觉重构、换标批资产、在制 WIP；不改 provider 默认槽位。
- safety_check 不替换本地审批/治理链；P6 未发令不启动。
- 不碰签名/公证/GA/Provider 矩阵等 G1+ 资格面。

## 依赖与前置 / 工作量预估

| 阶段 | 体量（估） | 依赖 / 决策点 |
|---|---|---|
| P0 | 已完成 | — |
| P1 | 小（0.5 会话） | 安装版 dataDir 绑定核实 |
| P2 | 中（1-2 会话） | 用户是否有 DeepSeek 搜索 key（无则只交契约证据） |
| P3 | 大（2-4 会话） | **本地 OCR 引擎须用户裁决**（新依赖，默认 no）；扫描件样本 |
| P4 | 中（1-2 会话） | 可并入 P3 收尾；真实文档样本 |
| P5 | 中（1-2 会话，可选） | 是否要 Responses 协议（用户裁决） |
| P6 | 暂缓 | 需求场景裁决 |

- HK-01 红绿先行适用于所有新行为契约（adapter/OCR/文件链）；P0 产出是结论，豁免红绿。
- 环境：dev 栈 CDP 9223 离屏（禁 `PETRI_TEST_ONSCREEN`）；后端变更须重启；验证投入与改动规模匹配——静态改动不上 CDP 深探（UI-699 教训）。

## 验收门禁（预先声明，逐阶段对账）

| 门禁 | 预期 |
| --- | --- |
| P0 | 已达成：全清单 VERIFIED + 深链，UNVERIFIED 项显式登记 |
| P1-P5 各阶段 | 对应契约测试绿；无 key/无样本如实 external-blocked，不伪造实机证据 |
| 通用 | HK-01 红→绿；定向测试 + quality:types/lint/secret/arch PASS；docs:check / ui:audit:check PASS |
| 实机 | 改动面需要时按无人化阶梯选择；观感/人眼项不代签 |

## 完成语义

P1-P5 逐阶段门禁对账、`deferred` 阶段经用户显式裁决、每阶段 acceptance 证据落盘、canonical 六件套回写后才标 completed。P6 未发令保持暂缓、不阻塞整体完成语义。push 到 origin/main 后收口。

G0 开发期常态 · 不外推 packaged/Provider/GA。
