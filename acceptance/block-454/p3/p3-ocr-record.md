# BLOCK-454 P3 · OCR 通用窄口 + adapter + knowledge 接入 · 记录（2026-11-17）

> 波次：W3（e2e-execution-plan §3 W3 任务卡）。D1 预置裁决：**本地 OCR 不引依赖**——'local' 槽位留接口，选择即诚实报 `ocr_provider_not_implemented`。

## 1. 交付物

### 通用窄口（工具语义，不进 registerProvider capabilities）
- 新模块 `core/petri-server/helpers/ocr-provider.js`：`ocrDocument({buffer, filename, config})`
  - `OCR_PROVIDERS = ['deepseek', 'local']`；`OCR_PURPOSES = ['text_recognition', 'rich_layout_recognition']`（findings §2 白名单）。
  - 请求契约：`POST https://api.deepseek.com/v1/tools/ocr` + Bearer + multipart（purpose + file，blob 类型按扩展名提示）。
  - 响应归一：`pages[].text` 逐页保留（index 从 1）+ 拼接 text + 版面标记探针 `layoutMarkers`（`<｜ref｜>/<｜box｜>`）。
  - 有界：上传体 ≤100MiB（findings 契约）、响应 ≤32MB（1000 页文本量级）、purpose 白名单外诚实拒。
  - 成本计量：`cost.requests`（文件级请求数）+ `cost.pages`（识别页数——按页审计口径）+ `cost.bytes`。
  - 诚实失败：`ocr_access_disabled`（默认关）/ `ocr_not_configured`（无渠道或无 key，带配置指引）/ `ocr_provider_not_implemented`（local）/ `ocr_purpose_invalid` / `ocr_too_large` / `ocr_timeout` / `ocr_http_error`（401/403 不可重试=配置面）/ `ocr_bad_response`。
  - key 不在本层存取：`getApiKeyFn` 注入（默认凭据族 'deepseek'，与对话共用）。

### 授权面（config family 'ocr'，与 web-search 同构）
- 新模块 `core/petri-server/helpers/ocr-config.js`（`file:ocr-config.json`；**默认关** enabled=false——云调用=付费副作用，P5-a 知情权）。
- shared-config 注册 `ocr` family + 4 键（enabled/provider/purpose/timeoutMs），键 `ui:'none'` + drift 门 NO_UI_FAMILIES 登记（理由：v1 只做窄口+knowledge 接线，授权 UI 属后续设置面批次）。
- HTTP 写面：`GET/PUT /api/ocr-access`（runtime-config.js，与 web-access 同文件同拒绝形状 400+diagnostics）。
- config-transfer 族集合补 `ocr`（BLOCK-201 双向钉）；冻结基线 19 族/108 键 → **20 族/112 键**（上调理由留痕于测试内注释）。

### knowledge 扫描件接入（`core/petri-server/helpers/knowledge-ingest.js`）
- 摄取管道新环节：PDF 文本提取为空（无文本层=扫描件）→ `attemptOcrParse`（ocr-config 现读开关 → ocr-provider adapter → 产物落 **`ocr.json` artifact** 于 docDir：provider/purpose/pageCount/pages[]/cost 全量留痕，X1 审计）→ OCR 文本作为解析文本进分块/嵌入（note=`ocr:deepseek:pages=N`）。
- OCR 未启用 → 文档诚实 failed，错误带成因（扫描件/无文本层）+ 可行动指引（ocr.json 置 enabled+provider，或换含文本层原件）——绝不静默空索引。
- OCR adapter 失败 → failed 带 ocr 错误码；artifact 写失败非致命（日志留痕，不影响主链）。

## 2. HK-01 红→绿

- 红：`test/block454-p3-ocr.test.mjs` 先行（模块缺失 1 红 → 实现 A 系 10/10、B 系经两处**测试自身 bug 修正**后全绿——①`createDocument` 是 async，测试漏 await 拿到 Promise；②嵌入通道与 OCR 正交，测试注入 embed 桩。实现侧零返工）。
- 绿：**13/13**（A 窄口契约 10 + B knowledge 集成 3，含真实 pdfjs 解析的无文本层 PDF 构造）。
- 邻域回归：knowledge 3 件套 + config 治理 4 件套 + W2 契约 **86/86**；全轮 109/109。

## 3. 门禁

quality:secret PASS / quality:arch PASS（R1-R5）/ quality:types PASS。零新依赖（multipart 用 Node 24 内建 FormData/Blob）。

## 4. external-blocked 清单

- 真端点 OCR 实机腿：与 W2 同因（D2 同款诚实原则——无独立验证授权 + 付费副作用 P5-a），契约级证据覆盖（multipart 请求形态/响应归一/错误映射全量 mock）。用户配置 key + `ocr.enabled=true` 后上传扫描件即可真跑。

## 5. R1 机制显化对照（设计宪法）

- 本波把「knowledge 摄取对扫描件只会诚实失败（不可感）」升级为「失败即指路（ocr-config 开关在哪、需要什么 key）+ 开启后零手工转录自动入库（用户可感）」；OCR 成本/产物全量 artifact 留痕（证据自证）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
