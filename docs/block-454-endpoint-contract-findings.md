# BLOCK-454 P0 · DeepSeek 全家桶端点契约核实（findings）

> 核实日期：2026-11-16。来源：DeepSeek API 官方文档（api-docs.deepseek.com，中文站），逐页抓取。
> 性质：P0 只读产物——**结论不是功能实现**；每项标注 VERIFIED（官方文档明确给出）并附深链。
> 关键背景：2026-11-13 DeepSeek 发布「全家桶应用 API」，在 Messages / Responses / Chat Completions 三个对话接口内开启参数即可获得 App 同款能力；Search/Fetch/OCR/ASR/TTS 另可作为**独立接口**调用。这解释了用户近期看到的能力面。

## 0. 模型与协议基线（VERIFIED）

- 当前对话模型：`deepseek-flash`（即 `DeepSeek-V4.1-Flash-1017`，2026-10-17 升级，调用方式与价格不变）；另有 `deepseek-v4-pro`。旧名 `deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 弃用。
- 三个对话协议端点（同一能力面、不同格式）：
  | 协议 | 端点 | 鉴权 |
  |---|---|---|
  | Chat Completions（OpenAI 兼容） | `POST https://api.deepseek.com/chat/completions` | `Authorization: Bearer <key>` |
  | Responses（原生） | `POST https://api.deepseek.com/responses` | `Authorization: Bearer <key>` |
  | Messages（Anthropic 兼容） | `POST https://api.deepseek.com/anthropic/v1/messages` | `x-api-key: <key>` |
- 思考参数按协议不同：Chat/Messages 用 `thinking: {type:"enabled"}`；Responses 用 `reasoning: {effort:"high"}`（另有 low/max 三档，V4 起）。
- 深链：[首次调用](https://api-docs.deepseek.com/zh-cn/) · [更新日志](https://api-docs.deepseek.com/zh-cn/updates) · [构建 Chatbot](https://api-docs.deepseek.com/zh-cn/guides/build_a_chatbot)

## 1. 对话内联能力（在三个对话接口内开启参数）

| 能力 | 触发参数（VERIFIED） | 响应形态 | 官方文档 |
|---|---|---|---|
| **联网搜索** | `tools:[{type:"deepseek_web_search"}]`（Messages 写法另带 `name`）；非思考模式自动搜网页/图片并附引用 | `server_tool_use` + `web_search_tool_result` + 正文 `citations` | [/guides/web_tools#web-search](https://api-docs.deepseek.com/zh-cn/guides/web_tools#web-search) |
| **深度思考搜索** | 思考参数 + `deepseek_web_search`（+ `deepseek_read_url`）；非独立工具，是"思考+联网"组合 | `thinking` + 搜索/抓取块 + 带引用正文 | [/guides/web_tools#search-while-thinking](https://api-docs.deepseek.com/zh-cn/guides/web_tools#search-while-thinking) |
| **阅读链接** | `tools:[{type:"deepseek_read_url"}]`（Messages 写法另带 `name`） | `server_tool_use` + `web_fetch_tool_result` | [/guides/web_tools#read-links](https://api-docs.deepseek.com/zh-cn/guides/web_tools#read-links) |
| **文件输入** | 两步：先 `POST https://api.deepseek.com/files`（multipart，`purpose` 必填且须在 `file` 之前）得 `id`，再在对话 `content` 用 `{type:"file",file_id}`（Chat）/ `{type:"input_file",file_id}`（Responses）/ `{type:"document",source:{type:"file",file_id}}`（Messages，需 header `anthropic-beta: files-api-2025-04-14`） | 解析后拼入上下文；原始文件与解析结果不支持下载 | [/guides/document_parsing](https://api-docs.deepseek.com/zh-cn/guides/document_parsing) |
| **视觉理解** | 对话 `content` 块数组传图：`{type:"image_url",image_url:{url,detail}}`（url 支持 base64 data URL / 公网 http(s) / `file_id`）；`detail` ∈ low/high/original/auto；Responses 用 `input_image`，Messages 用 `image` 块 | 图片按尺寸换算 token（单图上限 1024） | [/guides/vision](https://api-docs.deepseek.com/zh-cn/guides/vision) |
| **模型内容安全** | `safety_check:{level:"high"|"low"}`（low=默认，等价不传；其他值 400） | 拒答按协议区分：Messages `stop_reason:"refusal"` / Responses `status:"incomplete"+incomplete_details.reason:"content_filter"` / Chat `finish_reason:"content_filter"` + 空 content | [/guides/safety](https://api-docs.deepseek.com/zh-cn/guides/safety) |
| **会话标题** | `title:{enabled:true}`（官方示例中出现） | 服务端生成会话标题 | [/guides/build_a_chatbot](https://api-docs.deepseek.com/zh-cn/guides/build_a_chatbot) |

> 注意：开启内联联网/阅读/安全 high/title 时，服务端会**忽略**一批采样参数（temperature/top_p/seed/n 等，按协议不同），`max_tokens` 仍生效但限制的是单步输出而非整轮——Petri 接入时须在参数映射层如实处理。

## 2. 独立工具接口（REST，非对话内联）

| 能力 | 端点（VERIFIED） | 请求 | 关键参数 / 限制 | 官方文档 |
|---|---|---|---|---|
| **Search 搜索** | `POST https://api.deepseek.com/v1/tools/search` | JSON；Bearer 鉴权 | `query`(1-128 字符,必填) / `count`(1-50,默认10) / `need_content`(默认false) / `localization` / `ori_question`；响应 `results[]` 含 `rerank_score`/`url`/`snippet`/`summary`/`content`/`site_name`/`authority` | [/guides/search](https://api-docs.deepseek.com/zh-cn/guides/search) |
| **Fetch 抓取** | 与 Search 同指南页 `/guides/web_tools`（独立 Fetch 端点详情本轮未逐页确认 → 标 UNVERIFIED） | — | — | [/guides/web_tools](https://api-docs.deepseek.com/zh-cn/guides/web_tools) |
| **OCR 文档识别** | `POST https://api.deepseek.com/v1/tools/ocr` | multipart/form-data；Bearer | `file` + `purpose`(text_recognition / rich_layout_recognition)，均必填；PDF/DOC/DOCX/PPT/PPTX/图片；≤100MiB/1000页；响应 `pages[].text` + `<｜ref｜>/<｜box｜>` 版面标记（坐标 0-1000） | [/guides/ocr](https://api-docs.deepseek.com/zh-cn/guides/ocr) |
| **ASR 语音识别** | `POST https://api.deepseek.com/v1/tools/asr` | multipart/form-data；Bearer | `file`（16bit PCM WAV 或 Ogg Opus）；≤8MiB/120秒；19 种语言自动识别；响应 `text` + `duration_ms`；50 并发 | [/guides/asr](https://api-docs.deepseek.com/zh-cn/guides/asr) |
| **TTS 语音合成** | `POST https://api.deepseek.com/v1/tools/tts`（整段）/ `wss://api.deepseek.com/v1/tools/tts`（流式） | JSON 或 WebSocket；Bearer | `text`(≤10000计费字符) / `voice_id`(stella 女/tide 男) / `format`(wav/pcm；WS 另 opus) / `filter_markdown`；10 种语言自动识别；无语速调节/无法中断续传 | [/guides/tts](https://api-docs.deepseek.com/zh-cn/guides/tts) |

## 3. Petri 现状对照（哪些已在体内、哪些是缺口）

| 全家桶能力 | Petri 现状 | 融入形态 |
|---|---|---|
| Chat Completions | **已在体内**：`deepseek` 是默认 chat provider，`deepseek-flash` 当前在用 | 零工作；本会话即证据 |
| 思考 / reasoning | **已在体内**：`thinking-level` 映射 + `reasoning_delta` 续命（BLOCK-338/365） | 零工作 |
| Vision（Chat 内联图片） | **架构已在体内**：`model-gateway` 的 OPENAI_FAMILY 归一 + `image_url` 转换 + vision 角色绑定；实测有 `no_api_key` 绑定问题 | P1 修绑定（非新管道） |
| Anthropic Messages 协议 | **adapter 已在体内**：`anthropic.js` 支持 `options.baseUrl` 指向 `/anthropic` | 配置态即可，零代码 |
| Responses API | **缺口**：全仓 `/responses` 0 命中；但官方已原生支持 | 若要做=新增协议 adapter（窄口已现成） |
| 联网搜索（内联 + 独立 Search） | **部分**：`web_search` 工具走 SearXNG 窄口；无 DeepSeek adapter | P2：加 `deepseek-search` adapter；内联 `deepseek_web_search` 属协议层另议 |
| 阅读链接 / Fetch | 独立 `web_fetch` 工具已在（与搜索解耦）；DeepSeek `deepseek_read_url` 内联未接 | 可复用现有 web_fetch 窄口；内联属协议层 |
| 文件输入（Files API） | **缺口**：knowledge 解析有文本层 PDF/Office 路径，但无 Files API + file_id 引用链 | 归入 P3 文档解析增强 |
| OCR | **真缺口**：全仓零实现（仅 knowledge-parsers.js 一行注释） | P3：通用 `ocr()` 窄口 + DeepSeek OCR adapter（本地优先留路） |
| ASR / TTS | **真缺口**：零实现、无明确消费方 | 暂缓（缺需求，不是缺实现）；本清单登记备查 |
| 模型内容安全 safety_check | **部分**：Petri 有自己的审批/治理链（更丰富），无上游风控参数 | 可选开关，不替换本地治理（否则丢魂） |
| 会话标题 title | **已在体内**：`conversation_title` 走模型生成 | 零工作 |

## 4. 结论

- 「全家桶」= 3 个对话协议 × 7 项对话内联能力 + 5 个独立工具接口（Search/Fetch/OCR/ASR/TTS），共约 12 类能力面；Petri 已覆盖其中约 6 类（chat/思考/vision架构/Anthropic adapter/搜索窄口/标题）。
- 真正缺口按价值排序：OCR（P3，有 knowledge 场景）> Responses 协议（可选）> 文件输入链（归 P3）> ASR/TTS（无消费方，暂缓）。
- **P0 硬门达成项**：上表标 VERIFIED + 深链的能力，允许进入对应实现阶段；Fetch 独立端点细节与 Responses 完整请求形态标 UNVERIFIED，开写前需补抓。
- 全部融入不等于全部立刻做——按"通用窄口 + adapter"形态分批，DeepSeek 只作第一个 adapter，SearXNG/本地 OCR 等本地主权路径保持可选。
