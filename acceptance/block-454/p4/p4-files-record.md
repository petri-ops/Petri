# BLOCK-454 P4 · Files API + 对话文件块协议归一 + 归属校验 · 记录（2026-11-17）

> 波次：W4（e2e-execution-plan §3 W4 任务卡）。**契约补抓**：官方 document_parsing 文档已抓取并核实（findings 补记 VERIFIED）——purpose 三值（text_recognition/rich_layout_recognition/user_data）、purpose 须在 file 之前（400 强约束）、响应 id/object/bytes/created_at/filename/purpose、100MiB(413)/1000 页/120s(408,504)/并发 15(429)/每请求引用 ≤20 文档/文字合计 ≤8MiB、file_id 可复用（解析一次性计费）。

## 1. 交付物

### Files API 窄口（`core/petri-server/helpers/files-provider.js`）
- `uploadFile({buffer, filename, purpose, ...})`：POST `https://api.deepseek.com/files` + Bearer + multipart（**purpose 先于 file**，FormData 保序落实官方 400 强约束）；响应归一 `{fileId, object, bytes, createdAt, filename, purpose, cost:{requests,bytes}}`。
- 诚实失败全链：`files_not_configured`（无 key 指引）/`files_purpose_invalid`/`files_too_large`（100MiB）/`files_http_error`（413→上限提示、429→并发提示、408/504→时限提示、401/403→不可重试配置面）/`files_bad_response`（缺 id 字段不静默成功）。
- **显式动作**（P5-a 付费知情）：解析类 purpose 按页一次性计费；knowledge 摄取管道**不**自动上传云端，只有显式调用才发生。
- 协议归一（纯函数）：`fileContentBlockForProtocol(fileId, protocol)`——Chat `{type:"file",file_id}` / Responses `{type:"input_file",file_id}` / Messages `{type:"document",source:{type:"file",file_id}}`；未知协议诚实抛。`bodyHasFileReference(body)` 探针 + `FILES_BETA_HEADER='files-api-2025-04-14'`。

### file_id 归属注册表（`core/petri-server/helpers/files-registry.js`，BLOCK-196 教训落点）
- `<dataDir>/files-registry.json`（0600，tmp+rename 原子写）：fileId → {docId, conversationId, purpose, filename, bytes, sha256, createdAt}。
- `assertFileUsable(fileId, {conversationId?, docId?})` **fail-closed 三态不空转**：未知/外来 id → `file_id_unowned`；注册表损坏/不可读 → `files_registry_unreadable`（「查不了」≠「放行」）；归属不匹配 → `file_id_doc_mismatch`/`file_id_session_mismatch`。

### 协议接线（`protocol-conversion.js` + `anthropic.js`）
- `openAIContentToAnthropic`：Chat 形 file 块 → Messages document 块（官方契约形状）。
- `anthropic.js` chat/chatStream：body 含 file 引用块 → 请求自动带 `anthropic-beta: files-api-2025-04-14`（显式传入值优先不覆盖）；无 file 块不多带头（对照断言）。

### knowledge 对接（`knowledge-ingest.js`）
- `uploadKnowledgeDocumentForChat(docId, {purpose, protocol, ...})`：读 doc 原件 → uploadFile → 注册表 docId 归属登记 → 返回 `{fileId, contentBlock}`（下游按协议取块）。doc 缺失/原件丢失诚实拒；uploadFn 可注入。

## 2. HK-01 红→绿

- 红：`test/block454-p4-files.test.mjs` 先行（模块缺失红）→ 实现后 **12/12**（A 上传契约 5 + B 协议归一 2 + C 归属校验 3 + D knowledge/anthropic 集成 2）；一轮测试断言修正（429 文案关键词「同时上传数」对齐实现，实现零返工）。
- 邻域回归：anthropic 2 件套 + knowledge + W3 OCR **74/74**。

## 3. 门禁

quality:types PASS / quality:secret PASS / quality:arch PASS。零新依赖。

## 4. external-blocked 清单

- **一轮真实文档问答实机腿**：同 W2/W3（D2 同款诚实原则）——无独立验证授权 + Files API 解析计费为付费外部副作用（P5-a），契约级证据覆盖（multipart 形态/协议块形状/beta header/归属 fail-closed 全量 mock）。用户配置 key 后 `uploadKnowledgeDocumentForChat` → `contentBlock` 即可真跑。

## 5. R1 机制显化对照

- file_id「只能引用本机上传的文件 + 归属 fail-closed」是 Petri 差别形态：外来 id 拒绝并留痕（审计自证），不像通用壳直接透传任意 file_id。

G0 开发期常态 · 不外推 packaged/Provider/GA。
