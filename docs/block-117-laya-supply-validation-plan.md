# BLOCK-117-LAYA-SUPPLY-VALIDATION 计划：本地 Laya 决策供给接入验证（校准+阈值重定）

**Plan ID**：`BLOCK-117-LAYA-SUPPLY-VALIDATION`
**状态**：`completed（2026-09-22 当日立项当日收口：P0 线兼容契约 2/2 + P1 三接点校准裁决 0/3 可采纳（证据落 acceptance/block-117/）+ P2 实机 flow block117-layasupply-live 7/7（本地 Laya 真跑落账 56ms、配置零残留）+ 契约回归 block116 12/12 全绿。抓真=适配器 1 候选 choice 契约缺口（jev.py 包装器 2-255 严于生产 validateQuestions n≥1，已修）+ 原 harness 防伪预检/落盘路径的输出重定向 env + flow 配置路径须对齐后端数据面（data/ vs .biof3-dev-user-data/data）。裁决=三接点维持 Jev 供给、注册表零改动；Laya 不可采纳的约束是 confidence 语义差异而非 argmax 质量（marker-celltype 采纳精度 100%/覆盖 0.79）——门控语义改换属契约变更留候选池）`
**立项日期**：2026-09-22
**责任轨道**：BLOCK（替代决策供给的线兼容证明 / 接点级校准裁决 / 实机接入验证）
**上游文档**：`docs/block-116-decision-platform-plan.md` §P5（本地 Laya 同类供给支持已交付）· 决策内化弧 §W2 候选池

## 0. 立项来源与用户裁决留痕

- 恢复提示词排队候选（2026-09-22）：「本地 Laya 装好后的接入验证（校准+阈值重定，用户已表态要做）」。
- 本会话用户裁决原话：**「直接开」**（2026-09-22，主 Agent 提示"按流程登记后直接开"后）。
- 背景：本地 Laya（convaiinnovations/laya 0.3.5，421M ModernBERT 决策模型）已在用户机器完成安装与 Jev 契约 CLI 封装（`laya_decide`，仓库外 `D:\1.WorkDir\laya-test`）；前期 n=2 对照实测显示 Laya 概率分布显著平坦于 Jev（0.42–0.64 vs 0.88–1.0），且存在自信错判案例——**阈值不可平移，必须逐接点重校准**是本包出发点而非预设结论。

## 1. 范围与非范围

### 1.1 范围

| 阶段 | 内容 | 核心落点 |
| --- | --- | --- |
| P0 | 线兼容层 + 契约证明 | `laya_decide serve` 增 `POST /v1/systemone` 别名路由（仓库外适配层，Gewu 侧零改动）；真实 Laya 响应捕获为 fixtures；`test/block117-laya-supply.test.mjs` 用 `decision-api.js` 现行 `validateAnswers` 校验 fixtures 全通过（choice 需 confidence / noul 仅需 noul 值 / score 需 Σ级号×概率±0.05）；红线测试：七接点 Jev 注册表条目零漂移 |
| P1 | 接点级校准裁决 | `scripts/block117-p0-calibrate.mjs`：对三个启用接点（intent-route / tool-route / marker-celltype）复用既有语料（acceptance/block-112/113/111）+ 单源请求组装器 + 原 P0 门限判据，`askDecision` overrides 指向本地供给（零 API 费用），扫 θ 曲线，证据落 `acceptance/block-117/`；每接点产出三值裁决：可采纳（附建议 θ）/ 不可采纳（附最优曲线与差距量）/ 语料不适用 |
| P2 | 实机接入验证 + 裁决写回 | dev 栈 + 设置页「决策模型接口」切本地端点 → 真实触发至少一个接点 → decision_log 记账 model/answers 为 Laya（decision_log 台账既有面）→ summary 端点可见；裁决写回：若存在可采纳接点，按最小 schema 扩展 decision-thresholds.js（per-model 阈值映射）+ 契约测试同步；若全不可采纳，注册表零改动（红线=无证据不改阈值）并如实落裁决证据 |

### 1.2 非范围（exclusions）

- gates 形态接点（topic-shift / knowledge-guard）不在本期校准范围（题型语义不同，留后续按需另立）。
- failure-triage / test-suggest 两接点（管线含确定性前置层，Laya 替换语义不同）留后续。
- 阈值运行时热调（W2 候选池原样保留，与本包无关）。
- 不改变任何接点的默认供给与判定行为——生产供给仍为配置文件所指；本包交付的是「可切换+证据」而非默认切换。
- laya_decide 工具本身的功能演进（仓库外独立工具，仅按需加路由别名）。
- 0 npm 新依赖；不改 decision-api.js 客户端契约（D-B provider 可替换性既有设计）。

## 2. 设计要点

- **线兼容位置**：`decision-api.js` 打 `POST {baseUrl}/v1/systemone`，响应校验（choice 概率键完备+和≈1±0.02+argmax+confidence 有限 / noul 仅 P(yes) / score=Σ级号×概率±0.05）与 Laya system_one 的 answer schema 同构（本会话 demo 实测）。适配=serve 端路由别名，Gewu 客户端零改动——D-B provider 可替换性设计的首次真实行使。
- **校准即裁决**：复用各接点原 P0 门限判据（如 intent-route：chitchatPrecision@θ≥0.95、taskFalseAdoption=0、chitchatRecall≥0.60、overall≥0.85）作为 Laya 采纳判据——门限不因模型而放松，达标才可采纳；不可采纳即如实落证据，不硬凑 θ。
- **供给优先级不改**：resolveDecisionConfig 的 overrides > 文件 > env 既有契约；校准 harness 走 overrides（测试通道），实机验证走配置文件（UI 通道），生产默认供给零变化。
- **安全边界**：本地供给端点仅绑定 127.0.0.1、无鉴权——实机验证后须将配置切回或如实记录残留状态；settings UI 的 key 字段在本地供给下填非空占位串（resolveDecisionConfig 要求 apiKey 非空）。

## 3. 验收门禁清单

- P0：契约测试全绿（fixtures 过 validateAnswers ×3 题型 + Jev 注册表零漂移红线）。
- P1：三接点校准证据落盘 `acceptance/block-117/`（含语料 sha256、θ 曲线、裁决值），harness API 失败率 >10% 退出非零。
- P2：dev-verify 实机 flow ≥1 条（设置页切供给→真跑→decision_log 记账 Laya→summary 可见）；收口跑 closeout 门禁（docs/ui/test:changed/quality）+ 回归：block116 契约全绿（registry 零漂移或 schema 扩展契约同步）。
- 完成语义：三接点裁决值 + 实机接入证据 + 裁决写回（或如实记录"全不可采纳"）= completed；「Laya 成为某接点默认供给」不在完成语义内（属后续用户裁决）。

**预期节奏**：一次会话收口。

## 4. 实现完成记录（2026-09-22 当日收口）

### P0 线兼容契约（2/2 绿）

- 仓库外 `laya_decide serve` 增 `POST /v1/systemone` 别名路由 + 响应补 `model` 字段（`laya@<checkpoint>`）；Gewu `decision-api.js` 零改动。
- 真实 Laya 响应捕获为 `acceptance/block-117/fixtures/laya-answers-{stuck-loop,test-weakening}.json`（含 questions+response 全文）；`test/block117-laya-supply.test.mjs`：fixtures 过 `validateQuestions`+`validateAnswers` 三题型全覆盖 + 七接点 Jev 注册表零漂移红线（钉住逐键 deepEqual）。
- **抓真 1（适配器契约缺口）**：Gewu `validateQuestions` 允许 1 候选 choice（marker-celltype 推导单候选即此形态），而适配器沿用 jev.py 包装器的 2–255 保守规则 → 400。已放宽为 1–255（注释留因：生产契约 n≥1 优先于包装器惯性）。jev.py 上游不改。

### P1 三接点校准裁决（0/3 可采纳；harness 触改=touch-and-migrate 级）

- `block111/112/113-p0-calibrate.mjs` 三处最小触改：`CALIBRATION_EVIDENCE_OUT/FILE/MODEL` 三个 env 的输出重定向（默认路径行为逐字节不变）——供给换接校准不覆盖原 Jev 绑定证据的承载机制；语料/组装器/门限判据零改动。
- `scripts/block117-p0-calibrate.mjs` 编排：`BIOF3_DECISION_CONFIG_PATH` 沙箱（fixtures/decision-config-laya-sandbox.json 指向本地供给，零 API 费用零外发）顺序驱动三 harness；`--dry` 前置校验；汇总裁决落 `acceptance/block-117/calibration-laya-summary.json`。
- **抓真 2**：原 harness 防伪预检走 `resolveDecisionConfig()`（沙箱通道天然兼容），但 `decision-config.readDoc` 要求文件含 `points` 键——沙箱配置缺它即静默回退种子（已补 `"points": {}`，属本包 fixtures，非仓内代码）。
- 裁决明细（证据=同目录三份 calibration-<point>-laya.json）：
  - **intent-route：不可采纳**——θ∈[0.5,0.95] 全域零采纳（Laya confidence 典型 0.05–0.23，够不到生产门控下限）；task 零误采纳与 chitchatPrecision=1 为零采纳下的空真。
  - **tool-route：不可采纳**——同构（adoptedCoverage=0@θ=0.5，allFalseAdoption=0）。
  - **marker-celltype：不可采纳（最接近）**——θ=0.3 最优档：采纳精度 **1.0**（门 0.95 ✅）、trap 误采纳 0（门 ✅）、覆盖 0.7875（门 0.85 ❌）。约束=confidence 语义差异，非判别质量。
- 共性结论：Laya 的 confidence 字段语义（熵型）≠ Jev 的校准 confidence（≈top-prob），在现有「confidence≥θ」生产门控契约下不可直接采纳；改门控语义（如 top-probability）属决策契约变更，留候选池另裁。**注册表零改动**——「无证据不改阈值」红线正向行使。

### P2 实机接入验证（flow block117-layasupply-live 7/7 全绿）

- 供给切换走 `PUT /ai/decisions/provider`（设置页「决策模型接口」保存同通道）；真实提交 chitchat 消息 → intent-route 决策由 `laya@typed-decisions` 执行（choice=chitchat，延迟 **56ms**，degraded=0）→ decision_log 记账（recent 行 model 含 laya）→ **配置文件级还原零残留**。
- **抓真 3**：flow 进程内 `configPath()` 默认推导（cwd/data）与 dev 后端数据面（`.biof3-dev-user-data/data`）不一致——首次运行切换生效但还原落错文件（ENOENT）。修复=flow 显式对齐 dev 数据面约定；还原通道=文件级（API GET 打码红线取不回真实 key）。事故即改即测，第二次运行全绿。

### 收口门禁总账

- 契约：block117 2/2 + block116 回归 12/12（14/14 合跑）。
- test:changed：impact-map 新登记 `block117-laya-supply-validation` 规则（**抓真 4：双规则分类冲突两连**——三存量 harness 归各自 block 规则单源；`platform-branch-freeze` 的 `scripts/**` 无 classifiesScripts 不参与分类；新脚本须在恰好一条 classifiesScripts 规则内）。
- docs:check / ui:audit:check / hygiene / code-size / quality:secret / arch / lint / types：closeout 链实测（见 AUDIT-LOG 收口行）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 4. 环境纪律

- dev 栈启动：fnm Node 24 + remote-debugging-port（P2 实机前置）；本地 Laya 供给 serve 常驻 `http://127.0.0.1:8765`（仓库外 laya-test，后台进程）。
- 校准 harness 不读 env 的 TYPESAFE_API_KEY 做真实调用（overrides 显式指向本地），零费用零外发。
- 并行包文件面：无 active 并行包；BLOCK-116 已收口文件面（decision-api/config/thresholds/routes/面板）仅按 P2 裁决最小触改。
