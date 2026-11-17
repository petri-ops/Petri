# BLOCK-455 — 模型级能力声明 + API Endpoint 能力面简化

- 状态：completed（P1–P5 收口 2026-11-17；UI-706 台账 in_progress 待观感 pending_human_eye）
- 立项：2026-11-17
- 形态：BLOCK 主轨（后端契约重构为核心）+ UI 台账条目 UI-706
- 用户裁决（2026-11-17）：「行！按照你的建议安排，最好是修完 三、一个更深的语义问题……要彻底修 安排上，工作量大也修」
  = 采纳评估 B 方案（主表 8 列 + 能力自动推断 + 详情折叠）**并**彻底修复「能力声明在渠道级、模型可换」的语义漂移。
  「选择器显示」不删除（未选 C 档），移入行详情。

## 1. 问题

1. **语义漂移（根治对象）**：`profile.capabilities` 声明在渠道级，但同一渠道的「默认模型」可换、
   模型发现会展开多个模型——gpt-4o（有视觉）与纯文本模型共用一组勾选，能力位与真实请求模型脱节。
   消费点全部按渠道级判定：thinking 参数门（model-gateway.js:267）、vision 内联（vision-inline.js:121）、
   embedding 可用性（embedding-availability.js:19）、识图放行（attachments.ts）、角色绑定诊断（model-profile.js:285）。
2. **UI 过载**：主表 11 列（UI-703 刚为宽表头打完 2400px 豁免战役），其中「思考勾选 + 默认思考下拉」
   两列语义可合并；「选择器显示」小众；能力位全靠用户手勾（`/v1/models` 不返回能力元数据，但模型名可启发式推断）。

## 2. 设计决策

- **D1 能力解析单源**：`resolveModelCapabilities(profile, model)` =
  `profile.modelCapabilities[model]`（显式覆写）> `profile.capabilities`（渠道默认，兜底）。
  后端单源在 `core/shared-backend/llm-providers/model-profile.js`；前端镜像薄实现于
  `frontend/src/lib/model-capabilities.ts`（同规则，测试双向锁）。
- **D2 存储**：profile 新增 additive 字段 `modelCapabilities: Record<string, string[]>`，
  只存显式条目（用户编辑或推断预填）；无条目 = 渠道默认 → **旧数据行为逐字不变，零迁移**。
  `normalizeModelProfile` 校验能力位合法性（未知位丢弃）；schemaVersion 维持 1。
- **D3 名称推断**：`inferModelCapabilities(modelName)` 启发式单源（后端 model-profile.js）：
  视觉=`vl|vision|4o|gpt-4o|claude|gemini|qvq|omni`；思考=`reasoner|r1|o1|o3|o4|thinking|qwq|deepseek-v3\.[1-9]`
  之外的保守集合（宁缺勿滥，推断只预填可纠）；向量=`embed|bge|m3|gte-`。
  推断在「测试连接」成功拿到模型列表时由前端预填进 `modelCapabilities`，**零回归规则**：
  ①不覆盖已有显式条目；②向量系模型名（推断仅 embedding）写 `['embedding']`；
  ③其余仅在推断增益超出渠道声明时写「渠道∪推断」并集——不静默移除用户已声明的渠道能力；
  无增益不物化条目（渠道兜底=用户声明）。结果在 UI 可见可编辑。推断不是运行时隐式行为——运行时只读显式存储（D1）。
- **D4 角色绑定模型级化**：vision/embedding 绑定值支持 `profileId::encodeURIComponent(model)`
  （与前端 `modelChoiceId` 同形，model-provider-options.ts:50）；裸 profileId = 该渠道 `profile.model`（向后兼容）。
  `resolveModelProfile` 解析绑定 → 能力校验/诊断按解析出的模型能力；gateway vision/embed 用绑定模型发请求。
- **D5 thinking 门跟实际 attempt 模型**：`thinkingParamsFor` 的 capabilities 入参改为
  `resolveModelCapabilities(profile, attemptModel)`（attemptModel = modelOverride 或 profile.model）。
  BLOCK-200 映射冻结语义不动，只换门控输入源。
- **D6 UI 主表 8 列**：协议/供应商/Base URL/Key/默认模型/上下文/连通性/删除 + 行首展开钮。
  行详情（展开区）：当前默认模型的「视觉」「向量」勾选 + 「思考」合并单下拉
  （不支持 / 支持·不覆盖 / 关闭 / 标准 / 高；不支持=无 reasoning 位，其余=有位+默认档）
  + 「选择器显示」勾选 + 已发现模型能力列表（逐模型可编辑，写 modelCapabilities）。
  **P4 实施细化（2026-11-17）**：①能力表首行=「渠道默认（兜底）」写渠道级 capabilities——
  保留对未发现/未单列模型的声明能力，功能面零损失；②默认模型不进逐模型表（其能力位由
  控件行编辑，避免同一位两处视图）；③主表「默认模型」选择同步写 profile.model（修「换了
  默认模型但实际请求模型不动」的既有漂移，属本包语义根治范围）；④删除渠道按解析出的
  渠道 id 清理 `::` 对值绑定；⑤未声明 legacy 档案的思考下拉按旧宽松语义显示「支持·不覆盖」。
- **D7 角色绑定 UI**：识图/向量下拉候选 = 声明该能力的 (渠道, 模型) 对；值用 D4 格式。
- **D8 前端 choice 展开**：`useAiSettings` 逐模型展开时 capabilities = resolveModelCapabilities(profile, model)；
  auto-model / attachments / ModelMenu / SimpleChat 已消费 preset.capabilities，展开即模型级，消费端少改。

## 3. Patch vs Refactor 判定（治理要求）

信号命中：能力概念需要第二变体（模型级），渠道级声明与实际模型漂移属结构性缺陷 → **scoped refactor**：
单一 `resolveModelCapabilities` 吸收所有判定点，不做逐调用方补丁。用户已裁决「彻底修」。
行为基线（拆前拆后同套绿，BLOCK-92 先例）：`test/model-profile.test.mjs`、`test/model-gateway.test.mjs`、
`test/block200-thinking-baseline.test.mjs`、`test/block224-model-profile-normalize.test.mjs`、
`test/ui638-*.test.mjs`、`test/block150-*.test.mjs`、`test/block155-chat-vision-inline.test.mjs`。

## 4. 阶段与验收门禁

| 阶段 | 范围 | 门禁 |
|---|---|---|
| P1 内核契约 | model-profile.js：resolveModelCapabilities / inferModelCapabilities / modelCapabilities normalize / 绑定 `::` 解析 / validate+resolve 模型级化 | 新契约 test/block455-model-capabilities.test.mjs **HK-01 先红后绿**；§3 基线拆前绿 |
| P2 后端消费面 | model-gateway（thinking 门/vision/embed）、ai-settings.js（vision_configured 按绑定模型；迁移兼容）、embedding-availability、vision-inline、suggestions | 邻域测试全绿（block150/155/163/ui638/agent-vision/model-gateway/block200） |
| P3 前端数据面 | useAiSettings 展开模型级 capabilities + ChatModelPreset.modelCapabilities 类型 + useEndpointProfilesEditor 推断预填 + auto-model 补能力逻辑 | 前端定向测试（useAiSettings/auto-model/model-provider-options/model-catalog） |
| P4 UI | 8 列主表 + 行详情 + 思考合并下拉 + 角色绑定对选择器 + CSS（petri-css-theme 纪律）+ UI-703 契约更新 + UI-706 新契约 | 组件契约先红后绿；theme-token-contract 绿；ui:audit:check 绿 |
| P5 收口 | closeout 全门 + dev 栈离屏实机腿 + 台账回写 | closeout 绿（PATH 前置 Git Bash/GNU tar）；实机断言在册 acceptance/block-455/；docs:check 绿 |

完成语义：P1-P5 门禁逐项有当前证据；UI 台账 UI-706 实现完成=in_progress，实机证据充分才 verified，
观感项 pending_human_eye 不代签。

## 5. 红线 / 非范围

- 零新增依赖；不动 BLOCK-200 thinking 映射冻结语义；旧数据零行为变化（D2 兜底）。
- 「选择器显示」功能保留（移详情），不撤销 BLOCK-224 语义。
- 零触碰：🟡 迁移幂等广播文件面（src/migrations/、core/petri-server/db.js）、untracked 用户资产、他方 WIP。
- 非范围：能力自动探测的真实 API 探针（付费副作用，P5-a 纪律）、渠道协议层思考参数形状声明（BLOCK-81 D2 遗留候选）、G1+ 一切。
- 环境纪律：dev 栈 fnm Node 24 + remote-debugging-port；后端变更须重启；closeout 前 PATH 前置
  `D:\Program Files\Git\bin` 与 `D:\Program Files\Git\usr\bin`（AUDIT-LOG 🟡待环境）。

## 6. 证据位置

- 契约/邻域测试输出与实机截图：`acceptance/block-455/`
- UI 台账：`docs/ui-productization-audit.md` UI-706 条目
- 收口笔录：本文件 §7 + AUDIT-LOG 处理记录

## 7. 收口笔录（2026-11-17）

- **P1/P2 内核+后端契约**：`test/block455-model-capabilities.test.mjs` + `test/block455-gateway-model-binding.test.mjs`
  21/21（HK-01 先红后绿）；拆前基线邻域 79 项 77 pass / 2 skipped（agent-vision live 既有跳过）/ 0 fail
  （model-profile / model-gateway / block200 / block224 / ui638 / block150 / block155）。
  证据=`acceptance/block-455/p1-p2-node-contracts.txt`、`baseline-neighborhood-node.txt`。
- **P3/P4 前端契约**：8 文件 59/59（EndpointMainTable 5 / EndpointRowDetail 5 / ModelSelectorControls 8 /
  VisionRoleBinding 6 / EmbeddingRoleBinding 5 + UI-703 密度 5 + 宽表头豁免 2 + 数据面邻域）；
  theme-token-contract 19/19；quality:types 0 红。证据=`acceptance/block-455/p3-p4-frontend-contracts.txt`。
- **P5 实机腿**：`block455-live` 18/18 allPass（隔离后端 :3399 + stub 模型端点 :3398 + tmp userData/DB 备份，
  用户主栈零触碰）：宽 2400 九轨道单行对齐（spread 13px、min-width 1100 共享）、详情控件行（选择器显示 +
  思考合并五档 + 视觉/向量）、逐模型能力表（渠道默认兜底行在场、默认模型不进表、bge-m3 名称推断预填
  `['embedding']` 实机验证）、角色绑定 `渠道::模型` 对候选与值、保存 roundtrip（能力编辑+预填+对值持久化）、
  窄 800 两行式 9/9 标签无横滚且详情存活。离屏截图诚实降级（compositor -32000），误导性部分渲染 PNG 已删。
  证据=`acceptance/block-455/live-run.txt`、`block455-live-win32.json`。
- **UI-703 回归**：`ui342-endpoint-grid` 7/7 allPass（标准测试实例 + 用户真实档案；截图
  `acceptance/block-81/ui342-endpoint-grid-win32.png`，Sep-20 历史原件保留不覆盖）。
  证据=`acceptance/block-455/ui342-regression.txt`、`acceptance/block-81/ui342-endpoint-grid-live-win32.json`。
- **基础设施根修（缺陷类第二现→机械门）**：dev-verify `lib.screenshotPng` 默认 30s 超时
  （CDP 无限等待挂死类第二现抓真）+ ui342 G6 诚实降级断言；`test/dev-verify.test.mjs` 5/5。
- **影响面**：impact-map 新规则 `block455-ui706-evidence`（证据目录），`test:changed:list` unknown=[]。
- **closeout 读数（终局）**：`npm run closeout` exit 1，唯一红 = docs:check `DOCUMENT_MISSING`
  post-h9（D5 换机漂移，处置权在用户，登记不修）；fail-fast 未跑的门逐门单跑补齐：
  hygiene / ui:audit:check / gate:code-size / gate:arch-cycles / quality:secret / quality:arch /
  quality:lint / quality:types / quality:knip:check 全绿；test:changed 1078 项 1056 pass / 11 fail / 11 skip，
  11 fail 全归既有 HEAD 债（下条），失败集与改动前跑逐字一致。证据=`acceptance/block-455/closeout.txt`、
  `closeout-remaining-gates.txt`。
- **既有红归属（非本包引入、不代修）**：① BLOCK-454 P6 工具面基线未重打（117 vs 115：
  agent-tool-registry ×2 / block157-skill-visibility / tool-activity-labels）；② P6 config 族 ocr/speech
  导出信封与落点总账未同步（block201-config-transfer / block203-landing-registry）；③ block203-agent-rules
  Windows EPERM teardown 存量债；④ post-h9 DOCUMENT_MISSING（docs-governance ×2 + docs:check 门）；
  ⑤ W5a 他包四测试文件未挂规则（agent-task-resume-route-disambiguation / block454-p6-speech /
  m2-db-task-events-unique / ui421-manage-unlock-button）；⑥ test-affected reader：acceptance/ui-421 与
  ui-703-wide-header 的 evidence.json 未登记。处置归属各 owning 包 / 用户裁决。
- **收口过程本包清偿**：lint 10 error（本包 4 文件）修零；knip flow entry 登记（block455-live.cjs，
  ui695 先例）；code-size 基线重打登记（desktop.css +76 行/+1733 字节 = P4 详情样式、
  DesktopSettingsPanel.tsx +1 行；electron.d.ts +4 行属既有 HEAD 增量顺带登记）；EOL 漂移 6 文件归一；
  BLOCK-332 triage 证据随台账刷新（债 34→35 = 上限压线，UI-706 观感边如实判 blocked，同 D8 口径）。
- **实机腿复跑**：收口清偿后源码 digest 变化，block455-live 18/18 与 ui342 7/7 均按终局 digest 复跑绿
  （证据文件为复跑产物）；跑完 9223/3399/3398 全清，用户主栈零触碰。
- **取号对账**：UI-705 已被 origin/main UpdatePill 形态迭代 verified 条目占用 → 本包未推送侧让号改 UI-706；
  origin/main 领先 2 提交（UpdatePill 批）未合并，同步合并待用户裁决。
- **诚实边界**：UI-706 观感 pending_human_eye 不代签，台账 in_progress；离屏截图诚实降级不冒充视觉绿。
  G0 开发期常态 · 不外推 packaged/Provider/GA。
- **串行槽位**：空出。