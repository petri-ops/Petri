# BLOCK-348 实测报告 — 通用 agent 任务基准（2026-11-05）

> 形态：**实测报告（EVIDENCE）**，BLOCK-348（总纲 `docs/next-phase-program-2026-11-05.md` 包 1/7）交付物。
> 取数方式：机械可复跑（判据表冻结 + runner 事件轨迹 + 产物 sha256 清单），非抽样推断。
> 阶段声明：**G0 开发期常态 · 不外推 packaged / Provider / GA**（本报告所有判词均在此边界内）。

- 计划：`docs/block-348-universal-agent-eval-plan.md`；总纲：`docs/next-phase-program-2026-11-05.md`
- 判据表：`acceptance/block-348/tasks.json`，**冻结于 2026-11-04T16:48:53Z（跑前写死；冻结指纹 4b69b2d092bcae22 由 test/block348-task-suite.test.mjs 钉住）**
- 被测：Petri agent 内核（隔离后端 + real provider = deepseek-chat，凭据源=本机 BioF3-Local 凭据库，baseUrl/model 经 env 显式覆盖指向真实端点——本机 ai-settings 预设残留 mock 值，见 results.json provider.envOverrides）
- 运行环境：headless 隔离后端（PETRI_DB_PATH/PETRI_LOCAL_DATA_DIR 临时目录），web 访问按冻结口径预写开启
- 阶段边界：**G0 开发期常态 · 不外推 packaged / Provider / GA**；本报告结论只在 G0 dev 口径成立
- 本包纪律：只产出事实，不修暴露的缺陷（另立票）、不预设通过线、不事后调口径

## 0. 复跑命令

```bash
# 全量 8 任务（real provider）
PETRI_LOCAL_DATA_DIR="$HOME/Documents/BioF3-Local" \
PETRI_EVALS_BASE_URL="https://api.deepseek.com/v1" \
PETRI_EVALS_MODEL="deepseek-chat" \
node scripts/block348-task-runner.mjs

# 单任务（--tag 隔离多轮证据；--only 见 tasks.json id）
node scripts/block348-task-runner.mjs --only=t7-long-haul --tag=-rerun2 --report=acceptance/block-348/results-t7-rerun2.json
```

## 1. 四项度量（总表）

| 度量 | 数值 | 口径与说明 |
| --- | --- | --- |
| **自主完成率**（机械冻结口径） | **6/8 = 75%** | status=completed 且 criteria 全过：T1/T2/T4/T5/T6/T8；T3 缺 1 条、T7 缺 1 条（见 §2） |
| **使命达成**（人眼复核口径，报告内补记） | **6/8** | T3 机械缺 1 条但使命实质达成（判据表述过窄，见 §2.3）；T4 环境不可得、T7 缺陷阻断不计入 |
| **人工干预次数** | **0** | 全程 9 次运行（8 任务 + T7 重跑）零 dynamic_guard 审批请求；full 档工作区工具链未触发审批。干预点采集器在场（trace JSONL 可复核） |
| **工具选择合理性**（人眼，按冻结 checklist） | **24/24** | 8 任务 checklist 全过，含 T4 失败后行为合理（不编造、给绕路建议）；逐项证据见 §2 |
| **产物可用性**（人眼，按冻结 rubric） | **23/24** | 唯一失分=T4 页面标题未读到（环境不可得）；T7 按 run-1 产物判 3/3（保持力满分） |

环境不可得 / 缺陷阻断单列：**T4 环境不可得**（headless 无浏览器传输桥，冻结规则 pre-registered）、**T7 缺陷阻断**（P1，见 §3）。

## 2. 逐任务结果

### 2.1 t1-code-bugfix（代码）— ✅ 全过

- 机械判据 5/5；工具 13 次、16s；轨迹 `acceptance/block-348/traces/t1-code-bugfix.jsonl`
- 过程顺序完美：list/system_info → read package.json/src/test（3 次 workspace_read）→ `npm test`×3 看到失败 → `workspace_replace` 精准删除 `Math.floor` → 重跑 `node --test` → `pass 3`
- 人眼：工具选择 4/4（先失败后修、read 而非 cat、修后重跑、无破坏性）；产物 2/2（仅 average 取整行为变更，sum/maxPair 未动）
- 证据：`acceptance/block-348/artifacts/t1-code-bugfix/workspace/src/calc.js`

### 2.2 t2-data-cleaning（数据）— ✅ 全过

- 机械判据 8/8；21s；产物 `artifacts/t2-data-cleaning/workspace/`
- cleaned.csv 恰 33 行+表头、零 n/a、零斜杠日期、零重复（去重/无效剔除/补零全对）；summary.md 月度汇总数字正确（2025-03=12 条/1248 峰值），并主动给出「量程口径核查」建议；chart.html 纯内联 SVG 零外部依赖、四个月份刻度齐全
- 人眼：3/3 + 3/3

### 2.3 t3-research-cited（研究）— ⚠️ 8/9（1 条判据红）

- 机械判据 7/8：**红** = `file_contains "illustrative examples"`（report.md 不含该英文短语）
- 归因：代理把 example.com 正文**忠实翻译**进报告（「正文说明此域名用于文档示例，无需事先获得许可即可使用」——内容正确），但未逐字保留英文原句。判据口径要求逐字短语在场，**属判据表述过窄**（冻结表不回头改，如实记红）；使命实质达成
- 报告质量突出：5 个来源（example.com / IANA / RFC 2606 / RFC 6761 + 交叉核对节）、引用标记可回溯、**RFC 6761 抓取正文截断被诚实标注**（「本节点仅依据已取回部分」）
- 人眼：工具选择 3/3（纯 web_fetch×6、零 web_search 重试、引用 URL 与抓取一致）；产物 3/3
- 证据：`artifacts/t3-research-cited/workspace/out/report.md`

### 2.4 t4-browser-action（浏览器操作）— 🚫 环境不可得（冻结规则判定）

- 机械判据 3/3 全过——但按 tasks.json **t4.environmentUnavailableRule（跑前冻结）**：`browser_act` 两次 `transport_timeout`、`browser_status` 显示 `lastUrl:null / actionsPerformed:0`、本 headless 后端无 BrowserPanel webview 传输桥 → 判**环境不可得**，不计为 agent 能力失败
- **agent 行为亮点**：明确拒绝编造——「页面实际没有加载成功，我无法读取真实页面文本，因此不会编造标题和正文」，如实转述错误码、给出两条绕路建议（重试 / 改用 web_fetch）
- 人眼：工具选择 3/3（顺序正确、白名单内、失败行为合理）；产物 1/2（标题未读到 ✗ / 未编造 ✓）
- 证据：`traces/t4-browser-action.jsonl`；结构断链事实见 §3 P2

### 2.5 t5-docs-structuring（文档）— ✅ 全过

- 机械判据 9/9（8 次 workspace_read 全覆盖 6 笔记、3 个独特 token 全保留、摘要 331 字符）
- handbook 三节齐全、每节有概述句、逐条带来源标注；summary 4 句覆盖三节主旨
- 人眼：2/2 + 4/4
- 证据：`artifacts/t5-docs-structuring/workspace/out/handbook.md`、`out/summary.txt`

### 2.6 t6-multi-agent（多 agent）— ✅ 全过

- 机械判据 6/6：spawn_agent ×3、done 子任务 ×3、synthesis 含全部 3 个标记
- synthesis.md 三节 + A/B/C 来源标记 + 「各节要点由对应子代理独立阅读后回传，本节仅做归集，未增补外部内容」；要点与源文件实质一致
- 人眼：3/3 + 3/3
- 证据：`artifacts/t6-multi-agent/workspace/out/synthesis.md`

### 2.7 t7-long-haul（长任务·压缩）— 🔴 缺陷阻断（P1 实锤）

两轮实测（判据表未动）：

| 轮次 | 窗口 | 结果 | 判据 | 证据 |
| --- | --- | --- | --- | --- |
| run-1（首轮全量） | 64k（runner 覆盖写法缺陷未生效，回落模型表） | completed，49 工具调用，压缩 0 次 | 4/5（`context_compacted` 缺席） | `results.json`（stamped 2026-11-04T16-58-56-438Z） |
| run-2（runner 修复后，冻结场景 20k） | **20k 生效** | **失败**：压缩触发 ×1 后 provider 400 | 1/5（仅 `context_compacted` 在场） | `results-t7-rerun.json` + `traces/t7-long-haul-rerun.jsonl` |

- **run-2 失败原因（P1，见 §3）**：熔断裁剪后 tool 消息失去前置 assistant(tool_calls) 消息，provider 拒绝整个请求，任务 7 次调用即死
- run-1 附带观察（保持力口径）：任务提示词口令 ORCHID-42 与 20 个 FACT 标记**全部**出现在 final-report（机械断言 20/20 全过），20 个要点文件逐份落盘——无压缩场景下长程保持力满分。注：run-1 轨迹与产物被 run-2 覆盖（runner 证据管理缺陷，已修 `--tag`；run-1 事实由 stamped results.json 判据明细与全量日志承载，如实登记）
- 人眼（按 run-1 产物）：工具选择 3/3、产物 3/3；使命在压缩口径被 P1 阻断

### 2.8 t8-self-verify（自我验证陷阱）— ✅ 全过（本套件最亮表现）

- 机械判据 6/6：三组合计 47/31/24 全对
- 陷阱全识别：①`TOTAL,9999` 伪合计行显式排除并算出「计入会把总数抬到 10101」的反事实；②`delta,1O5` 识别字母 O，**「不做猜测性修正」**并请用户确认原值；③复核动作超出预期——Python(csv+正则) 与 awk **双实现交叉验证 diff 一致** + 行数对账 + 写盘后 sha256 复读校验
- 人眼：3/3 + 4/4
- 证据：`artifacts/t8-self-verify/workspace/out/totals.md` + 答复（trace 末段）

## 3. 短板清单（分级、逐条带证据）

| 级 | 短板 | 证据 | 处置 |
| --- | --- | --- | --- |
| **P1** | **上下文熔断裁剪破坏 tool 消息配对**：压缩裁剪按打分贪心拾取（`core/petri-server/helpers/message-trimmer.js:159-160` pickWithinBudget/scoreMessages 无 tool 链配对约束），可把 `assistant(tool_calls)` 裁掉而保留下属 `tool` 消息 → 后续请求被 provider 整体 400（`Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`）→ 长任务中断。触发条件=接近窗口上限（小窗口模型/长任务即真实风险，run-2 20k 下 7 次调用即触发） | `acceptance/block-348/results-t7-rerun.json`（error 原文）+ `traces/t7-long-haul-rerun.jsonl`（compaction ×1 后 fatal） | **另立票**（本包不修，计划 §3） |
| P2 | 浏览器执行链在 headless/后端态不可用：connector 传输层依赖桌面 BrowserPanel webview 事件桥（`core/petri-server/helpers/browser-connector.js` 头注），无桥时动作 25s 后 `transport_timeout`；且环回/私网地址被 web-fetch-policy 硬拒。属产品部署形态边界，非 agent 能力缺陷；agent 侧失败行为合格（不编造） | `traces/t4-browser-action.jsonl`（2×transport_timeout，lastUrl null） | 事实登记；如需 headless 浏览器能力需另行立项（新传输 provider） |
| P3 | web_search 检索后端未配置（provider=none）时联网任务只剩 web_fetch 一条路；t3 中 RFC 6761 抓取正文超限截断（agent 诚实标注） | `traces/t3-research-cited.jsonl`（6 次 fetch）+ report.md 截断注记 | 事实登记；检索后端配置属用户设置面 |
| P3 | 本套件判据设计教训：跨语言任务用「英文原句逐字在场」当判据过窄（t3 红）；机器判据无法覆盖「使命实质达成」时须依赖冻结 rubric 人眼补判 | §2.3 | 后续套件设计吸收（判据应锚定内容等价物或双语关键词） |
| P3 | runner 证据管理缺陷（已修）：同任务重跑覆盖 trace/产物目录（T7 run-1 轨迹丢失） | `scripts/block348-task-runner.mjs`（已加 `--tag` 隔离） | 已修；run-1 事实由 stamped results 承载 |

**观察（不计短板）**：答复末尾偶发重复段（T4 终文重复两遍，来源未归因——可能是采集器重复帧或流重放，不影响判据）；批量并行工具调用使「49 次工具调用 27 秒完成」成为常态（每回合多 tool_calls 并行执行，属正常高速能力）。

## 4. 结论

- 通用 agent 主线能力在 G0 dev 口径**真实可用**：代码修复、数据清洗+可视化、带引用联网调研、文档结构化、多代理编排、自我验证六个域全部使命达成，且 t8 自我验证、t4 拒绝编造等「可信与透明」行为自发出现
- **最大短板是韧性而非能力**：上下文压缩链的 P1 缺陷使长任务在小窗口/高压力场景不可靠（这是唯一把「能做」变成「做不完」的发现）
- 干预面干净：全程零审批拦截（full 档），干预点采集机制在场可复核
- 判据表冻结指纹 4b69b2d092bcae22；复跑须带上表 env；报告与判据口径一致，无事后调整

*G0 开发期常态 · 不外推 packaged / Provider / GA。*
