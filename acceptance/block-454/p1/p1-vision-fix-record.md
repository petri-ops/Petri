# BLOCK-454 P1 · vision 修通 · 绑定核实与修复记录（2026-11-17）

> 波次：W1（e2e-execution-plan §3 W1 任务卡）。性质：绑定口径修复 + 契约测试，未新造管道。

## 1. 成因定位（vision_failed: no_api_key）

### 链路事实（代码核实）
- `vision_failed` 出口：`core/petri-server/agent-tools/vision-tools.js:153`（`callVision` 失败包装）。
- `no_api_key` 来源：provider 层——`deepseek.js`（requiresApiKey 通道 + 空 key）、`dashscope-vision.js:44`（DashScope key 未配置）；`openai-compatible/ollama/lmstudio/vllm` 注册时 `requiresApiKey: false` 不产此错（`llm-providers/index.js:82-89`）。
- vision 角色解析：`model-gateway.js vision()` → `resolveModelProfile('vision')` → capability 门（`profile.capabilities.includes('vision')`）→ `getCredential(credentialRef)`。

### 实测对比（本机；密钥脱敏，见 binding-resolution-probe.json）
| 维度 | Mac 安装版（~/Documents/Petri-Local） | dev 版（.petri-dev-user-data/data） |
|---|---|---|
| vision 绑定 | `deepseek-chat`（openai-compatible / deepseek-flash） | 同左 |
| vision key 可解析 | ✅ | ✅ |
| chat 档案 capabilities | `[chat,streaming,tools,vision]` | `[chat,streaming,tools,vision,embedding]` |
| chat 档案 roles | 缺 `vision`（旧版写盘，仅展示元数据，不影响解析） | 含 `vision` |
| embedding 绑定 | `dashscope-embedding`（**key 不可解析**——既有 finding，embedding-availability 已有诚实降级，非本卡缺陷面） | `ollama-embedding` |

- **Mac 安装版当前 vision 绑定已健康**（UI-638 迁移曾生效改绑）。
- **Windows 安装版 ai-settings.json（`C:\Users\Admin\Documents\Petri-Local`）本机不可达 → 该文件腿 external-blocked**；机制定位以代码 + Mac 双配置证据推进（e2e-plan §4 契约级证据原则）。

### 根因（机制级）
UI-638 迁移（ai-settings.js `normalizeAiSettings`，用户裁决 2026-10-30「识图默认走 DeepSeek 软件写定」）存在盲区：

- 迁移条件 = `vision 绑 dashscope-vision + dashscope 无 key + chat 档案 capabilities 含 vision`。
- **旧安装版**的 `model_profiles` 由 UI-638 之前的版本写盘，chat 档案 capabilities 缺 `vision` 声明 → 迁移静默跳过 → vision 永远绑在无 key 的 dashscope-vision → `vision_failed: no_api_key`（尽管 DeepSeek key 在位且 deepseek-flash 原生多模态）。
- 该缺口被既有测试 `ui638-vision-default.test.mjs` 第 3 测试钉为「正确行为」，实为缺陷钉。

## 2. 修复（HK-01 红→绿）

- **红**：重写该测试断言 deepseek 多模态形态必须迁移 → 实测 `运行时绑定=dashscope-vision` 断言失败（红证据 hk01-red-green.txt）。
- **实现**（`core/petri-server/helpers/ai-settings.js`，复用 `model-gateway` 的 `OPENAI_FAMILY_PROVIDERS`，不新造管道）：
  1. 迁移第二判据：chat 档案 provider ∈ OPENAI_FAMILY ∧ model 前缀 `deepseek`（V4.1 起原生多模态，findings §0）→ 视为识图可用。
  2. 改绑同时把 `vision` capability 补进档案（运行时 + **落盘同批**，防「binding 先落盘后条件不再命中、capability 永不补齐」漂移 → capability mismatch）。
  3. 真文本模型（非 deepseek 形态）保持不迁移（显式配置真相优先，新增测试钉住）。
- **绿**：ui638-vision-default 4/4；邻域回归 57 测试 55 过 0 红 2 skip（平台条件跳过，neighborhood-regression.txt）。

## 3. image_url 契约测试

既有覆盖已核实并纳入本轮回归：`test/block150-vision-rebind.test.mjs`（openai 系通道 `{type:'image'}` → `{type:'image_url',image_url:{url}}` 转换 + dashscope 原生直传 + capability 门拒绝）、`test/block155-chat-vision-inline.test.mjs`（chat 内联链 image_url）。本卡新增的是迁移口径契约（上节），不重复造 image_url 测试。

## 4. external-blocked 清单

- Windows 安装版 ai-settings.json 文件腿（跨机不可达）：机制已由代码 + Mac 证据定位，修复覆盖同一机制。

## 5. 既有 finding 登记（非本卡修复面）

- Mac 安装版 `embedding → dashscope-embedding` 且 DashScope key 未配置：embedding 角色不可用属既有诚实降级路径（`ui638-embedding-availability` 契约），用户配置 DashScope key 或改绑本地 embedding 即可，非缺陷。

G0 开发期常态 · 不外推 packaged/Provider/GA。
