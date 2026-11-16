# BLOCK-454 P2 · deepseek-search adapter · 实现与证据记录（2026-11-17）

> 波次：W2（e2e-execution-plan §3 W2 任务卡）。D2 预置裁决：**无真端点实机腿**——契约级证据 + external-blocked 标注。

## 1. 实现范围

- `core/petri-server/helpers/web-search-provider.js`：窄口加第二个 adapter `deepseek-search`
  - `SEARCH_PROVIDERS = ['searxng', 'deepseek']`；provider='deepseek' 分支 `searchDeepseek()`。
  - 请求契约（findings §2 VERIFIED）：`POST https://api.deepseek.com/v1/tools/search` + `Authorization: Bearer <key>` + body `{query, count, need_content:false}`。
  - 结果归一到既有 search 结果形状（title/url/snippet/source=主机名）；deepseek 特有 `rerank_score`/`authority` 保留（排序依据可审计，P3-a）。
  - 有界：count 窄口钳位 1-20（请求体同步）、snippet 400 钳位、响应 512KB 上限、域名黑白名单过滤同 searxng。
  - 诚实失败：key 未配置 → `web_search_not_configured`（指引 AI 设置填 key 或改选 SearXNG，绝不空数组冒充 P3-b）；query>128 → `web_query_too_long`（渠道上限）；401/403 → 不可重试 http_error（配置面）；0 结果 → ok=true + 诚实 note。
  - 成本计量：`cost.requests`/`cost.bytes`/`cost.results` 逐请求入账（X1 审计）。
  - key 来源：`getApiKeyFn` 注入（默认懒 require ai-settings → credential store 'deepseek'，与对话共用凭据）——web-search-config「不存凭据」边界不变。
- `core/petri-server/helpers/web-search-config.js`：snapshot `capabilities.search` 支持 deepseek（enabled + provider=deepseek + key 现读在位）；`deepseek-search-key-missing` 诊断项。
- `core/packages/shared-config/config-schema.js`：`webSearch.provider` 枚举扩 `deepseek`。
- **SearXNG 保持默认**（P3-c 本地主权）：provider=searxng 路径零改动（契约 9 钉住）。

## 2. HK-01 红→绿

- 红：`test/block454-p2-deepseek-search.test.mjs` 先行——9 红（deepseek 契约 0-8 全红）+ 1 绿（契约 9 searxng 默认不变）。
- 绿：实现后 **10/10**（见 hk01-red-green.txt）；一轮测试断言修正：`truncated` 语义按窄口既有定义（上游行数 > 输出条数，含坏行丢弃）断言 true，非实现缺陷。
- 邻域回归：block247 web-policy/tools + block199/201 config 面 **53/53 全绿**（neighborhood-regression.txt）。

## 3. 门禁

- quality:secret PASS / quality:arch PASS（R1-R5 无违规）/ config schema 邻域 36/36。
- 无新依赖（零 package.json 变更）。

## 4. external-blocked 清单（D2）

- **真端点实机腿**：按 D2 预置裁决不做——无独立验证的 DeepSeek Search key 授权 + 真实调用属付费外部副作用（P5-a）。契约级证据=上节请求/响应形态测试（mock fetch 全量契约覆盖：端点/Bearer/body/钳位/归一/成本/错误映射）。用户配置 key 后工具层即可真跑（`provider=deepseek` 即时生效）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
