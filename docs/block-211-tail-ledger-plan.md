---
capability: tail-ledger-clearing
goal: BLOCK-211 = runlist W8 收尾族。**本包按"逐项独立验收"执行**，不追求一次全清。首批（P1）清偿 **C-32：decision-config 的 env='1' 语义与自身注释相反**——把 env='1' 从"运行时强制开"降级为**首载种子**（`env='0'` 仍是永不违逆的杀开关），使"设置页关掉的守卫不会被残留 env 重新打开"；连带修正 `envShadowedKeys` 对 seed 的误报（否则 doctor 会把不生效的 env 报成遮蔽）。
acceptance:
  - P0 基线：C-32 现状先钉住（`test/block199-config-compat.test.mjs` 里钉"env=1 强制开"的那条要在同一提交里**显式改写**并留因，不得静默改）。
  - P1 C-32 清偿：`decision-config.getPointRuntime` 生效顺序=`env='0'`（杀）> 文件 > `env='1'`（种子）> 注册表默认；`shared-config` 标注 `envOneIsSeed` 并让 `envShadowedKeys` 对 seed 不报"遮蔽生效值"。
  - P2 回归面：设置页读写、`/api/ai/agent/decisions` 端点、dev 脚本里靠 `env=1` 开接点的用法（`test:suggest`/`doc:suggest` 等）全部核过——seed 语义下"没有文件配置时 env=1 仍能开"，"有文件配置时以文件为准"。
  - 其余 W8 项（lint 基线净收缩 / 双机 riders+BK-08 / 休眠插件激活裁决 / RS 徽标语义 / C-27 拒绝类 judge 口径 / C-30·C-31 销号）**逐项另立小批**：需要裁决的（休眠插件）、需要第二台机器的（双机 riders）、需要成对实验的（C-27）不在本批强行收口。
  - **领域包到位复看（2026-10-20 第八批）**：兄弟仓 `petri-pack-bio` 检出后 `skills:check` 14/14 PASS、tools/catalog=7、preflight 三态如实；`PETRI_PACK_DIRS` 补 5/5 契约测；UI-527 pack-present 复探 2/2；UI-526 根因更正为 R 运行时未安装（`r.installed=false`）仍保持 `in_progress`——**不得以 pack 到位冒充产物到位**。
  - 完成语义：首批只交付 C-32；第八批（2026-10-20）交付领域包复看与 W8 自决项收口（§13）；W8 的双机 riders/BK-08 与 i18n 仍 deferred，不得因为本包收口就宣称 W8 全清或阶段 4 出口完全达成。
reopen: 双机 riders 与 BK-08 销号（需第二台机器/实机）；UI-526 实机腿（需 R 运行时 petri-r-runtime 安装后跑一次 demo 分析）；i18n 决策（D-04 用户裁决，不并入）；lint 进一步净收缩（可选，当前 318 suppressions / 1824 warnings 已低于原目标）。C-27 仍为 G0 边界 deferred；C-30/C-31 已销号；C-33 已于 2026-10-20 复看销号。
status: completed
---

# BLOCK-211 · W8 收尾族（首批：C-32 env 语义清偿）

执行序位置=`docs/stage-3-4-execution-runlist.md` 的 **W8**（W0–W7e 已 completed）。用户发令：2026-10-18「好 棒 满意 继续后面的工作」。

## 0. 为什么先做 C-32

其余 W8 项各有前置：lint 收缩是机械降债、双机 riders 要第二台机器、休眠插件要**用户裁决**、C-27 要成对实验、C-30/C-31 是立项/销号判断。**C-32 是唯一"纯代码 + 有明确判据 + 影响治理透明度"的一项**：它现在的行为是"用户在设置页关掉守卫，只要环境残留 `PETRI_JEV_*=1` 它又开了"——这是"我关掉了但它还开着"，直接命中治理透明魂面。

## 1. 语义定义（本批的验收口径）

| 层 | 值 | 语义 |
| --- | --- | --- |
| `env='0'` | 杀开关 | **永不违逆**（最高优先级） |
| 文件配置 | `enabled` | 用户显式选择，高于种子 |
| `env='1'` | **首载种子** | 仅当文件没有该键时生效（"默认开"的一种表达） |
| 注册表默认 | `enabledDefault`/`defaultOn` | 兜底 |

## 2. 红线

- 不改 `env='0'` 的杀开关语义；不改阈值数值与校准键。
- 同一提交里显式改写 `block199-config-compat` 中"env=1 强制开"的钉法（留因），不许静默改基线。
- 不动设置页/REST 契约形状（只动"env=1 的胜负"）。

## 3. 落地记录（2026-10-18）

- **C-32 清偿**：`resolvePointEnabled` 改为显式四层（`env='0'` 杀 > 文件 > `env='1'` 种子 > 注册表默认），不再依赖通用 `resolveConfigLayers` 的 env 层——因为本族 env 有两义，硬塞进通用模型会让所有族背上只有本族用到的形状。
- **假警报一并修**：`shared-config` 的 `decision-points` 标 `envOneIsSeed: true`，`envShadowedKeys` 对 seed（`env='1'`）**不再报遮蔽**（否则 doctor 天天说"被 env 盖住"，而实际没盖）。
- **基线显式改写**：`test/block199-config-compat.test.mjs` 里"env=1 强制开"的钉法在同一提交改写为"seed 语义"，并留因（修的是"设置页关不掉"的治理缺陷，不是放宽判据）。
- 证据：`test/block211-c32-env-seed.test.mjs` **4/4**（真相表 / envOverride 保留 / seed 不报遮蔽 / 族标记）+ 邻域 **150/150**（112/113/116/119/173/199/200/202 + 新测）。
- **发现一笔在册旧账（未修，非本批引入）**：`test/block110-p1-topic-shift.test.mjs` 有 **5 例在 HEAD 上就红**（noul 三区间 / 降级 / 杀开关，全部断 `callModelTask` 调用数）。A/B 验证：`git stash` 掉本批改动后同样 5 红 ⇒ 与本批无关，需独立 triage。

## 4. 🟡 triage 记录：`block110-p1-topic-shift` 5 例 HEAD 红（2026-10-18）

**结论：与本批无关，且不是产品回归——是测试夹具的隔离缺陷。**

证据链：
1. **A/B**：`git stash` 掉 C-32 改动后同一文件仍 5 红（1 pass / 5 fail），恢复后同样 5 红 ⇒ 与 C-32 无关。
2. **失败形态**：5 例全部断"应当走到大模型路径"（`callModelTaskCalls.length === 1` 实得 0），日志里伴随
   `[topic-shift] failed: database disk image is malformed`——即查询抛错后被 `_maybeDetectTopicShift` 的
   try/catch 吞掉，函数返回 null。
3. **排除产品 DB**：仓库里 `core/petri-server/petri.db` 的 `PRAGMA integrity_check` = **ok**（335KB 遗留件本身没坏）。
4. **排除"路径本身不可用"**：按测试同样的方式自举（14 个 `src/migrations/*.sql` → `PETRI_DB_PATH` 指向临时文件）
   后，独立脚本 require `conversations` 并调用 `_maybeDetectTopicShift` **不抛 malformed**（返回 null，属门禁/依赖差异），
   说明报错只在**测试夹具（mock 注入 + 自举顺序）**这套组合下出现。

判断：`core/petri-server/db/connection.js` 的 `DB_PATH = process.env.PETRI_DB_PATH || <core>/petri.db` 是**模块加载时**求值；
测试在 `installMocks()` / require 链里可能先摸到连接，而自举只跑了 `src/migrations`（桌面侧），后端表由
`helpers/conversations.js` 自带 `CREATE TABLE IF NOT EXISTS` 创建——**自举范围与连接绑定两者都在夹具侧**，
不是 `conversations`/`decision-config` 的行为问题。

处置建议（单独小批，不混进 C-32）：修夹具而不是修产品——
① 在**任何 require 之前**固定 `PETRI_LOCAL_DATA_DIR` 与 `PETRI_DB_PATH`；
② 用 `conversations` 自己的建表路径初始化（而不是只跑 `src/migrations`）；
③ 断言里不要依赖"malformed 被吞成 null"这种形态。修完应 6/6。

## 5. 第二批：lint 基线净收缩（2026-10-18）

- **做法**：挑一个"纯测试、全同规则、可整文件清零"的目标——`frontend/src/lib/chat-file-references.test.ts`（8 条 `@typescript-eslint/require-await`）。把 `vi.fn(async () => …)` 与 `json: async () => …` 改成同步 mock（**`it(..., async () => {` 保留**，因为函数体里真有 await），并把 4 处 `as Response` 改为 `as unknown as Response`（同步 mock 不再结构上像 Promise）。
- **净收缩**：`eslint-suppressions.json` **326 → 318（−8）**，文件数 135 → 134（该文件条目整块消失）；`npx eslint . --prune-suppressions` 清掉陈旧键，`quality:lint` **0 errors**。
- **验证**：该测试文件 `vitest` **25/25**、`tsc --noEmit` 0。
- **自纠一次**：首版用整文件 `s.replace('async () =>', '() =>')` 把 `it(..., async () => {` 也改了，导致 `await` 出现在非 async 函数里（tsc TS1308 + 测试 0 执行）→ `git checkout` 还原后改成**只替换两种 mock 形态**的定向改法。

## 6. 🟡 → ✅ `block110-p1` 夹具修复完成（2026-10-18）

- **真因（在 §4 的假设上收敛）**：`seedConversation` 每次都开**第二条** `better-sqlite3` 句柄往同一个 WAL 库里写、写完就 `close()`，而后端那条长连接仍在用；首个查询因此撞 `database disk image is malformed`（被 `_maybeDetectTopicShift` 的 catch 吞成 null）。另有第二个约束：`db.js` **加载时**就预编译 `projects` 等语句，所以 schema 必须先于 require 存在。
- **修法（三步，全在夹具侧）**：①**env 先行**——`PETRI_LOCAL_DATA_DIR` + `PETRI_DB_PATH` 在任何后端 require 之前固定；②建表仍走 `src/migrations`（`db.js` 预编译需要），但**只开这一条引导句柄、用完即关**；③`seedConversation` 改用后端自己的连接（`dbMod.getDatabase()`）写种子，**不再开第二句柄**。
- **结果**：`block110-p1-topic-shift` **6/6 绿**（此前 1/5）；产品代码零改动（临时加的 error.stack 探针已还原）。
- 口径更正：§4 里"需要单独小批"的结论保留（它确实是独立问题），但修复本身在本批内完成——因为**改的是夹具不是产品**，不会污染 C-32 的验收面。

## 7. 第四批：RS 徽标语义诚实化（2026-10-18）

- **改什么**：`resultSurface.describeTruthStatus` 的 `valid` 文案从「可信结果」→「**已核验（未篡改）**」，并新增 `detail`（渲染为徽标 `title`/`aria-label`）：明确"核验范围=产物完整性与来源一致性，**不代表科学结论正确，也不代表 Result Studio 整体已验证**（仍 `implemented_unverified / experimental`，P7 deferred）"。另三态（尚未核验/需要复核/结果已阻断）同样补范围说明。
- **为什么这是诚实化而不是改词**：`valid` 是**产物级**结论（artifact-truth），旧文案把它升格成"结果可信"的全局判断——正好违背 G0 期"RS 徽标不许冒充资格"的纪律。
- 证据：`resultSurface.test.ts` **18/18**（新断言 `detail` 含"不代表 Result Studio 整体已验证"）+ `tsc` 0 + `theme-token-contract` 17/17（无样式变更）；台账 **UI-526 `in_progress`**（纯文案/可访问性变更，无实机腿）。

## 8. 第五批：候选收尾裁定（2026-10-18）

| 候选 | 裁定 | 依据 / 重开条件 |
| --- | --- | --- |
| **C-27** 拒绝类 judge 口径 | **deferred（G0 边界）** | 需**真实 Provider** 成对送判（照办 vs 拒绝各 3 次）；当前 G0 不外推 Provider。实验设计已固定；重开=进 G1+ 或用户批一次真调用预算。**不得用 mock 冒充结论。** |
| **C-30** ANN / 召回质量基线 | **销号（不立项）** | BLOCK-94 已裁决不引入 `sqlite-vec`；零依赖纪律下无第二选项；单用户规模下暴力 cosine 无可测缺口；"分层"属产品设计不是索引缺失。重开=向量数 >5 万 或 检索 P95 >250ms（要实机计时证据）。 |
| **C-31** >2 节点中继 | **销号（不立项）** | 现形态就是点对点直连；多跳需要真实 3+ 节点需求与路由协议，仓内零实义命中——**为不存在的能力造锚=幽灵锚点**（BLOCK-195 教训）。重开=真实 3+ 节点部署需求 + 委托失败率证据。 |
| 休眠插件激活 | **待用户裁决**（不自决） | 属产品取向裁决；本批只登记"为什么需要裁决"（停用/启用的默认与审计口径）。 |
| 双机 riders + BK-08 | **deferred（环境依赖）** | 需第二台机器/签名机复跑；重开=有第二台设备可用时按 BLOCK-105/198 的 riders 清单复跑并销号。 |

**W8 结论**：可自决项（C-32 / lint 收缩 / block110 夹具 / RS 徽标 / C-27·C-30·C-31 裁定）**全部处理完毕**；剩余仅"需用户裁决"（休眠插件）与"需第二台机器"（双机 riders）两类。**不宣称 W8 完成**——那两项不在代理可自决范围。

## 9. 第六批：休眠插件激活——**裁决包**（不代裁，2026-10-18）

**为什么停下来把问题交回去**：这一项在我的判据里不是"做不做"，是**产品取向**（哪几项能力算"已交付"、默认开还是关、不可用时怎么提示）。AGENTS 的治理纪律写明治理裁决不代裁；我前几次已经把可自决项做完了，这一项继续"按建议来"就会变成替用户定义产品面。

**实码核对（避免把观感当事实）**：

- `resources/skills/manifest.json` 只有 **14 条**（deg/go/sc 标准、coding/visualize、7 个 obsidian/mermaid/canvas 笔记族），字段仅 `id/name/category` 等——**没有 `status`、没有依赖声明、没有验证时间**；
- 全仓 grep `dormant|休眠` 只命中两处**注释**（`result-selection-tools.js:423` 说 gsea 因 R 重依赖本机 dormant；`upload-domain-validation.js:8` 说插件休眠期=校验真空），**不存在"休眠插件"的机械登记表**；
- 评估报告 `§55/§138` 的「休眠插件+demo 错位」是**产品观感判词**（"货架可见不可用"），不是代码状态——所以"激活范围"无法从代码推导。

**三选一（需要你选，括号内是我看到的代价）**：

| 方案 | 内容 | 代价/风险 |
| --- | --- | --- |
| **A 保持现状 + 如实标注** | 不激活任何东西；给 manifest 加 `requires`/`verifiedOn` 字段，货架对"缺依赖/未验证"的项显示"未适配"而不是"可用" | 最小（~0.5 天）；收益=消除"demo 错位"的**误导**，但能力面不变 |
| **B 激活"零重依赖"一族**（我倾向这个） | 只把不依赖 R/Python 重环境的项（visualize / mermaid / excalidraw / json-canvas / obsidian-markdown 等）标为"可用"，其余标"需 R 环境/未适配"；激活=货架状态与详情页一致 + 失败时给明确原因 | 中（~1-1.5 天）；需给每项加依赖探测与失败文案，避免"点了才报错" |
| **C 全量激活** | 所有 skills 都标可用，缺依赖时自动安装或明确降级 | 大（1-3k 行级 + 环境矩阵）；在 G0 无第二台机器/无 packaged 验证的条件下，等于把"本机能跑"冒充"普遍可用" |

**我的建议：B**。理由：A 只解决"说谎"，B 才解决"可见不可用"；C 在没有 packaged/第二台机器证据时会把 G0 的证据等级问题放大成产品质量问题。但**选哪个是你的裁决**，选完我按它立一个小包（范围 1-2 轮）。

**边界**：本批未改任何插件/技能代码，也未改 manifest——只留证与选项。

## 10. 第六批证据补充：`skills:check` 实测 5 红（2026-10-18）

按方案 B 的前提核对时跑了 `npm run skills:check`，**它现在是红的**（5 条），且正好印证 C-33 的"货架可见不可用"：

```
❌ skills/deg-analysis-standard: plugins.required 引用插件 "expression-qc" / "deseq2" / "volcano-plot" 在 built-in-plugins/pack 插件源中不存在
❌ skills/sc-analysis-standard: plugins.required 引用插件 "scanpy-advanced" / "seurat-standard" 同上
```

- **事实**：`resources/built-in-plugins/` 目录在本仓**不存在**；两个生物信息学标准 skill 声明的 5 个硬依赖插件因此全部解析不到。
- **注意口径**：这不是本批引入的——`skills:check` **不在 closeout 十三门里**（十三门=audit:compact/hygiene/docs/ui-audit/test:changed/code-size/arch-cycles/css-modules/secret/arch/lint/types/knip），所以它可以长期红而不挡收口。AUDIT-LOG 2026-10-01 已登记过 6→8 红的存量（归 BIO-D2 裁决）。
- **对 A/B/C 的影响**：B 方案"把零重依赖一族标可用、其余标未适配"**必须先让 manifest 的依赖声明与真实可用性对齐**；否则"未适配"标签的依据本身就是一条红门禁。C 方案更需要先补 `built-in-plugins`。
- **处置**（仍属 C-33 裁决范围）：建议把 `skills:check` 纳入 closeout 门禁的**报告级**（不阻塞、但每次收口必须打印红数），避免它继续"红着走"。是否升为阻塞门禁，与 A/B/C 一起裁。

## 11. 第六批落地（C-33 代码侧，2026-10-18）

- **preflight 纳入插件硬依赖**：`checkSkillDeps` 增 `hasPlugin` 探测面，`missingPlugins` 与 `missingBins` 并列；**缺插件不算 installable**（配方只装二进制）。默认 `hasPlugin=()=>true` 保持既有调用方语义不变（不制造假红）。
- **探测面单一真相**：`projection-data.js` 的 preflight 路由用 `plugin-loader.getPlugin/isPluginInstalled`（与 `/api/plugins/installed` 同源），探测失败=未检出（不虚报可用）。
- **货架如实**：`SkillCard` 对"有插件硬依赖"的技能也显示依赖徽标（此前只有 `requires.bins` 才显示），title 列出「缺插件包：…」。
- 证据：`block211-skill-deps-plugins` **4/4** + `tsc` 0；台账 **UI-527 `in_progress`**（无实机腿）。
- **仍未做（属 C-33 产品裁决）**：`resources/built-in-plugins/` 是否补齐、`skills:check` 是否升为阻塞门禁——本轮只把"货架不说谎"这一半做实。

## 12. 第七批：`skills:check` 以**报告级**纳入收口（2026-10-18）

- **做法**：`closeout-gates.mjs` 新增 `--report <npm-script>`（可重复）——所有阻塞门禁跑完后执行，**不改变退出码**，摘要里打印 `✅/⚠️` 与红条数；`package.json` 的 `closeout` 已挂 `--report skills:check`。
- **效果**：`npm run closeout` 现在会打印 `⚠️ npm run skills:check — 红（exit 1，5 条）`，其余门禁照常 PASS。**"红着走"变成"每次收口都被看见"**。
- **为什么不是直接升阻塞**：`skills:check` 的红来自 `resources/built-in-plugins/` 在本仓不存在——补齐插件包是**资产/产品裁决**（C-33），先把它变阻塞会让所有收口卡在一个不该由工程侧单方面决定的前置上。
- **顺手修**：改脚本时误删了 `repoGate` 辅助函数（`ReferenceError`），已恢复并用 `--report skills:check` 冒烟验证（报告行出现、CLOSEOUT 仍 PASS）。
- 未做：把红数写进 AUDIT-LOG 自动对账（当前是人工登记）；`--report` 的单元测试（脚本本身无测试面，靠冒烟）。

## 13. 第八批：领域包到位后的复看与 W8 收口（2026-10-20）

**触发**：本机 `D:\1.WorkDir\petri-pack-bio` 已检出（W8 首批时记为未检出），C-33 的重开条件「拿到 pack 仓后复跑」满足。用户 2026-10-20「查看远程库有没有更新，保持双端一致。启动进入下一个阶段工作」=下一轮启动授权。

### 13.1 同日实测（pack 到位）

- 兄弟仓发现命中（`discoverAvailablePacks({ projectRoot })`）；`npm run skills:check` **PASS（14 个内置 Skill）**，此前 5 红消失 ⇒ C-33 根因确认为 pack 未检出，不是 manifest 缺陷。
- 后端以 `PETRI_PLUGINS_DIR=<pack>/plugins` + `PETRI_PACK_DIRS=<pack>` 启动：`GET /api/tools/catalog` **count=7**（deseq2 / deg-standardizer / expression-qc / go-kegg / gsea / sample-metadata-validator / volcano-plot）；`GET /api/skills/preflight` 中 `deg-analysis-standard=available`，`sc-analysis-standard` 与 `go-enrichment-analysis=missing_deps` 且 `missingPlugins` 如实为 scanpy-advanced / seurat-standard 与 clusterProfiler。
- 证据：`acceptance/block-211/pack-unlock-live.json`（4/4）、`preflight-pack-present.json`、`skills-check.txt`、`runtime-status.json`。
- **契约补测**：`PETRI_PACK_DIRS` 此前零机械断言 → `test/block211-pack-dirs.test.mjs` **5/5**（多目录 path.delimiter / 无效目录跳过不抛 / 非法包仍拒 / 与兄弟包+extraDirs 合并去重 / 未设 env 时回旧行为）。`impact-map` 的 `block211-tail-c32` 规则同步登记脚本与 acceptance 目录。

### 13.2 台账复看结论

| 项 | 结论 |
| --- | --- |
| **C-33** | **销号**：重开条件已满足并复跑；`skills:check` 保持**报告级**（没有 pack 的机器不应无法收口），本机现为 PASS；本仓只做"承认位置 + 货架如实"，不写插件 stub。A/B/C 的"激活范围"裁决随之失效（插件包是外部资产，不在本仓硬造）。 |
| **UI-527** | 维持 `verified` 并补 pack-present 证据：9223 复探 **2/2**；截图 `acceptance/block-211/ui527-skills-shelf-pack-present.png` 显示三卡真实三态（标准差异表达=依赖可用；GO 富集/标准单细胞=缺依赖）。 |
| **UI-526** | 根因从「pack 缺失」更正为「**R 运行时未安装**」：`GET /api/runtime/status` 实测 `r.installed=false`（Python 可用），pack 内插件全为 R ⇒ 无 R 就无产物。保持 `in_progress`；重开=R 运行时安装后跑一次 demo 分析并看结果页徽标。 |
| **lint 净收缩** | 当前 `eslint-suppressions.json` **318** 条、warnings **1824**（原目标 2153→≤2145 已满足）；本批不再强行降债。 |
| **休眠插件激活** | 随 C-33 复看关闭：pack 到位后货架按真实依赖显示三态，不再需要"激活裁决"；休眠项仍休眠但不再冒充可用。 |
| **双机 riders + BK-08** | 维持 **deferred**（需第二台机器/签名机），重开=有第二台设备时按 BLOCK-105/198 riders 清单复跑。 |
| **C-27** | 维持 **deferred（G0 边界）**：需真实 Provider 成对送判，G0 不外推。 |
| **C-30 / C-31** | 已销号（§8），本批复核无新证据，不重开。 |
| **i18n** | D-04 用户裁决 deferred，不并入；不属于本仓工程可自决范围。 |

### 13.3 W8 / 阶段 4 出口口径（不越权宣称）

- **W8 可自决范围=完成**：C-32、lint、RS 徽标、C-33 复看、C-27/C-30/C-31 裁定、UI-526/527 复看全部有结论或证据。
- **仍非工程可自决的两项**：双机 riders/BK-08（环境依赖 deferred）与 i18n（用户裁决 deferred）。因此 runlist W8 勾选为"自决项完成 + 两项 deferred"，**不宣称阶段 4 出口完全达成**；不外推 packaged/Provider/GA。
- 下一步（若继续 G0 开发）：R 运行时安装是解锁 `7-result-loop-live` 环境档、UI-526 与 dim7 的唯一前提；本批不擅自下载/安装 657MB 运行时，留待用户授权或专用环境窗口。
