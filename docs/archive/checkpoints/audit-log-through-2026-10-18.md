# 审计广播台历史归档 · through 2026-10-18

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-10-18（**BLOCK-203 W4a 收口 completed（closeout 十三门全绿）**）：八片全落地——`user-prefs`/`skills-prefs`/`agent-rules`/`mcp-servers` 四族收编（注册表 **12 族 / 60 键**）、集合形状单一实现、上限单源、`ai-settings` 顶层白名单（过滤+自愈+doctor 点名）、`localStorage` 降纯启动缓存、`models` 导出默认脱敏。**覆盖率按实码=8/14（7/7 文件族 + localStorage）**，剩 6 处 SQLite/主进程态 + 4 条 data root 合一 = **W4b**；不得称「配置已统一」。收口链抓到两处真问题并当场修：①`accents.ts → prefCache.ts` 新环（`AccentId` 下沉、方向变单向）②P7/P8 漏 UI 台账（补 **UI-521/UI-522**，均 `in_progress`，无实机腿）。plan=docs/block-203-stage-3-b1b-config-landing-consolidation-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-17（**BLOCK-203-STAGE-3-B1B-CONFIG-LANDING-CONSOLIDATION 立项发令 active（runlist W4 拆片：W4a=纯文件落点收编先做 / W4b=SQLite 与 data root 搬迁后做；用户常驻授权按 W0→W8 连打）**）：P0 实码核对抓出**两处会污染验收口径的错误**并同批更正——①**落点是 10 处不是 11**（14−4；runlist W4 行、BLOCK-199 §5 红线、README 两处旧条目、handoff 旧恢复要点共五处同错，W1–W3 新增四族属新文件族不得抵数）②**BLOCK-199 plan §P2 声明的 `core/petri-server/config/config-service.js` 从未创建**（`git ls-files` 零命中）——真实收编形态=各族 helper 直接 `require` schema 函数（9 处实证），故 W4a **不新建 service 层**（第二抽象），后续包不得再按该文件路径找适配器。另测绘到四落点 **4 条互不相同的 data root 回落链**（`user-prefs` 认 `LOCAL_DATA_DIR`／`mcp-settings` 不认 `USER_DATA_DIR`／`agent-rules` 两者都认／`skill-prefs` 只认 `USER_DATA_DIR`）——这是 W4b 的搬迁对象，W4a 只收形状**不动根**（红线：落点实际路径须与改前逐字节相同）。范围=四文件族收编（user-prefs/skills-prefs/agent-rules/mcp-servers）+ ai-settings 顶层白名单过滤（**过滤+诊断非 400**，否则有历史脏键的用户保存不了任何设置，D-W4a-3 留痕）+ renderer localStorage 降为纯缓存并漂移钉住 + **D-2 rider**（`useEndpointProfilesEditor.ts:381` models 导出默认脱敏）。**当前 active 工作包=BLOCK-203（W4a）**，下一动作=P1（schema 加 `user-prefs` 族 + 集合条目字段 + 冻结基线）。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-18T01:02:28.453Z -->
最后更新：2026-10-18（**BLOCK-203 整包 completed（W4a + W4b；closeout 十三门全绿 ×2）**）：**落点账清完**——14 处逐条归属：7 配置全收编（注册表 12 族/60 键）、7 非配置逐条有理由（SQLite 四落点均属运行时态/授权数据，**不搬是裁定**：硬搬会把 Gen UI 留存状态与 `users.permissions` 做成"可导出可重置"）。目录单源 `shared-backend/data-paths`（两个有名字的根；四只手工链消失；`user-prefs` 旧 `cwd/data` 只读兼容）。机械门 `block203-landing-registry` 3/3（新增族不得抵 14 的账、运行时态/授权不得进注册表）。**收口抓真三处**：`accents↔prefCache` 新环、P7/P8 漏 UI 台账（UI-521/522 in_progress）、legacy 兜底无条件启用会读他实例 `cwd/data`（本机 `~/Documents/Petri-Local/user-prefs.json` 曾被测试写脏，已删并改只读测）。plan=docs/block-203-stage-3-b1b-config-landing-consolidation-plan.md §10。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-18T01:06:57.944Z -->
最后更新：2026-10-18（**BLOCK-204-MCP-TOOL-POLICY 立项发令 active（runlist W5：MCP 逐工具策略面）**）：P0 实码三处不可配——投影上限 `MAX_PROJECTED_TOOLS=40`、`callServerTool` 超时 60s 常量、合同只由 `readOnlyHint` 推导，启停粒度只有 server 级。范围=schema 族 `mcp-tool-policy` + helper + 投影/上限/合同/超时四处接线 + `GET/PUT /api/mcp/tool-policy`（unknown-tool 400）+ transfer/doctor/漂移门。红线=不改四档判定、不改 readOnlyHint 默认推导、unknown-tool 只拒该条。plan=docs/block-204-mcp-tool-policy-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-18T01:16:03.864Z -->
最后更新：2026-10-18（**BLOCK-204-MCP-TOOL-POLICY 整包 completed（runlist W5；closeout 十三门全绿）**）：MCP 逐工具策略面——上限/超时/合同模式三件可配且"未配置=零行为变化"（基线 4/4 冻结 DEFAULTS=启用/60s/auto、上限 40、CAP-1 派生）；`mcp-tool-policy` 族（13 族/65 键）+ `GET/PUT /api/mcp/tool-policy`（unknown-tool 400 只拒该条、离线可改既有条目）；transfer/doctor 接入；漂移门新增 `NO_UI_FAMILIES`（无设置页=显式登记，不空转）。**抓真**：`writeStore` 把"未传 projectionLimit"判非法（`Number(undefined)=NaN`）→ partial 写入整批被拒。未做=逐工具设置页（W5b）。**无 active 工作包**，下一包=W6。plan=docs/block-204-mcp-tool-policy-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-18T01:22:49.062Z -->
最后更新：2026-10-18（**BLOCK-205-MEMORY-COMPACTION-POLICY 整包 completed（runlist W6；closeout 十三门全绿）**）：compaction×4 + 检索×3 + 生命周期×2 进注册表 **14 族/75 键**，默认值逐字等于原常量（未配置=零行为变化）；`effectiveSnapshot()` 给生效值+来源；嵌入模型只读；写面 400 三分类；transfer/doctor/NO_UI_FAMILIES 接入。**评测基线对齐**：`context_snapshot` 7/7 指纹未变 + `evals:gate` smoke 回归 0 ⇒ 不重基准、如实记"未变"。抓真两处（作用域 ReferenceError / 未使用常量）。无 active 工作包，下一包=W7a。plan=docs/block-205-memory-compaction-policy-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-18（**BLOCK-205-MEMORY-COMPACTION-POLICY 立项发令 active（runlist W6）**）：compaction 四常量 + 记忆检索三参数 + 生命周期两项（TTL/批次）全部硬编码、无生效值出口；收进 `memory-policy` 族，默认值逐字等于常量（未配置=零行为变化，基线先冻结）；嵌入模型只读登记（改模型=换维度=重嵌入）。**与评测基线对齐**为硬条款（context_snapshot 指纹变则显式重基准留因）。plan=docs/block-205-memory-compaction-policy-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-18T01:31:59.973Z -->
最后更新：2026-10-18（**BLOCK-206-SUBAGENT-PROFILE-SLASH 立项发令 active（runlist W7a）**）：①子智能体 profile 声明式配置（concurrency 与 runtime 族逐字对账、只能收紧；reportGuard 仅 inherit）②C-29 斜杠即执行抽单元并给 D15 挂真锚。红线=profile 不是权限系统、未传 profile 零行为变化。plan=docs/block-206-subagent-profile-slash-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-18（**UI-523 composer 运行计量条 completed（UI 轨；9223 实机腿 10/10 + 隔离后端腿 14/14）**）：输入卡片下方三段读数「本次 轮/步/tok/s · 会话 tok/缓存命中 · 上下文%」；后端两条 additive（loop 每次调用 `usage` 事件 + `GET /api/ai/usage-conversation` 会话聚合，数字全部来自本地 `ai_usage`）；预算环从工具栏搬进条内（同一实例）。不可算一律 `—`；tok/s=最近一次调用端到端平均输出速率（非解码速度）。本机无真实 Provider 凭据 ⇒ 实机链用本地 OpenAI 兼容 mock provider，证据标注 `provider=mock`。台账=`docs/ui-productization-audit.md` §UI-523。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-10-18T02:09:33.941Z -->
最后更新：2026-10-18（**BLOCK-206（W7a）completed；closeout 十三门 PASS**）：profile 声明式配置（15 族/81 键，并发 min 收紧、reportGuard 仅 inherit）+ C-29 斜杠判定抽离并挂 D15 unit 锚。code-size 当场抓真（SimpleChat +2 行 → 删冗余注释回 2142）。**仍挂 🟡**：`context_snapshot` golden 指纹漂移待归因（W6 的"指纹未变"已作废），未重基准。plan=docs/block-206-subagent-profile-slash-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-18（**BLOCK-206（W7a）代码落地，但 closeout 未跑**；同时**更正 W6 的"评测基线未变"结论**）：`context_snapshot` golden 指纹 **dfc9be7b… vs 基线 9bb90c14…**，原因行=「system prompt 文案变更」；用 `git stash` 移除 W7a 改动后同样漂移 ⇒ **与 W7a 无关**。W6 收口时我用的是单测（只验归一化机制）而非 golden fp 对比，故"指纹未变"不成立，改记 🟡 待归因；**未重基准**（归因前不得 `--update-snapshot`）。另发现：main 上存在另一会话的提交（`7bf008b9 feat(ui-523)`），W7a 工作叠在其上。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-18T02:16:46.925Z -->
最后更新：2026-10-18（**🟡 context_snapshot 漂移已归因并修复：不是 prompt 文案，是路径分隔符**）：`normalizeContextString` 把 tmp 根换成 `<TMP>` 后保留了 OS 分隔符 ⇒ Windows 录的基线（`<TMP>\projects\…`）在 macOS 上恒红。处置=归一化统一 `<TMP>/`（新增"Windows 与 POSIX 同指纹"单测），显式重基准到 `dfc9be7b986a1c17` 并复跑 `✔ 一致`。**两处口径更正**：W6 的"指纹未变"不成立（用单测代替 fp 对比）；W7a 初判引用的"system prompt 文案变更"只是 harness 启发式提示语，非真因。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-18T02:36:17.650Z -->
最后更新：2026-10-18（**BLOCK-207（W7b）completed（closeout 十三门 PASS）**）：项目信任级 inherit/trusted/untrusted（16 族/84 键），`applyTrustCeiling` 只能收紧（untrusted 下写/执行→read，read/plan 原样），默认 inherit 零行为变化；接 agent-runner accessMode 构造点、信任层故障 fail-open；变更/导入/重置均落 `trust-audit.jsonl`。plan=docs/block-207-project-trust-policy-plan.md。无 active 工作包，下一包=W7c。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-18（**BLOCK-207-PROJECT-TRUST-POLICY 立项发令 active（runlist W7b）**）：项目信任级 inherit/trusted/untrusted，在 accessMode 构造点做只能收紧的天花板（untrusted ⇒ 禁止写/执行）；信任变更写追加式审计；默认 inherit=零行为变化。plan=docs/block-207-project-trust-policy-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-18T02:56:28.408Z -->
最后更新：2026-10-18（**BLOCK-209-EXTERNAL-AGENT-IMPORT 立项发令 active（runlist W7d）**）：只读解析 + 映射预览，零写入零网络；凭据拒绝自动导入（D-2）；patch 与注册表对账；一键应用进 reopen。plan=docs/block-209-external-agent-import-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-18（**BLOCK-208（W7c 收窄版）completed（closeout 十三门 PASS）**）：动效用户开关端到端（`user-prefs.motion` 接线 + `density` 仅登记 ⇒ 16 族/86 键；`prefCache` `petri-motion`；`data-motion` + 复用既有 reduced-motion 块两通道；设置页三档）。`theme-token-contract` 17/17——**motion 棘轮当场抓到**"字面量 transition 时长 + 与既有块重复实现"，已改为复用 `var(--petri-duration-fast)`。**证据缺口**：9223 实机腿未跑 ⇒ UI-525 `in_progress`。下一包=W7d。plan=docs/block-208-appearance-motion-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-18（**BLOCK-208-APPEARANCE-MOTION 立项发令 active（W7c 收窄版：只做动效开关）**）：`user-prefs` 加 motion（接线）+ density（仅登记）；CSS 双降级（data-motion/prefers-reduced-motion），只改时长与行为、不新增颜色 token；设置页常规节三档。预览专项/密度接线/对比度/通知/性能进 reopen。plan=docs/block-208-appearance-motion-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-18T03:02:44.118Z -->
最后更新：2026-10-18（**BLOCK-209（W7d）completed（closeout 十三门 PASS）**）：外部 Agent 配置只读解析 + 映射预览（Codex TOML 子集 / ZCode JSON），零写入零网络、凭据 D-2 双查拒入 patch、patch 与注册表对账、零新依赖；**预览不是导入**（一键应用属 reopen）。plan=docs/block-209-external-agent-import-plan.md。无 active 工作包，下一包=W7e。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-18T03:26:52.176Z -->
最后更新：2026-10-18（**BLOCK-210（W7e）completed（closeout 十三门 PASS）**）：留存/归档（默认零删除、apply 默认 dryRun、删除须 allowDelete、审计落盘）+ 迁移**计划器**（只读：步骤/备份/回退/阻塞项）；注册表 17 族/89 键；**真实搬迁与清理未执行**（reopen）。plan=docs/block-210-data-dir-retention-plan.md。无 active 工作包，下一包=W8 收尾族。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-18（**BLOCK-210-DATA-DIR-RETENTION 立项发起 active（runlist W7e）**）：留存/归档策略（默认零删除、apply 默认 dryRun）+ 迁移计划器/预览（只读不执行；真实搬迁属 reopen）；目录解析只走 `data-paths` 单源。plan=docs/block-210-data-dir-retention-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-18T03:51:16.994Z -->
最后更新：2026-10-18（**W8 第五批：候选收尾裁定**）：C-27 **deferred（G0 边界：需真实 Provider 成对送判，不得 mock 冒充）**；C-30 **销号**（不引 sqlite-vec、无可测缺口，重开=向量 >5 万或 P95 >250ms）；C-31 **销号**（点对点现形态；造锚=幽灵锚点，重开=真实 3+ 节点需求）。休眠插件=待用户裁决；双机 riders=deferred（需机器）。W8 可自决项已清完，**不宣称 W8 完成**。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-18（**W8 第四批：RS 真值徽标语义诚实化（UI-526）**）：`valid` 属产物级核验，旧文案「可信结果」过度声称 ⇒ 「已核验（未篡改）」+ `detail`（title/aria-label）点明"不代表科学结论正确、也不代表 RS 整体已验证"；三态同步补范围。证据=resultSurface 18/18 + tsc 0 + token 17/17；closeout 十三门 PASS。W8 余项：双机 riders（需机器）/休眠插件裁决（需用户）/C-27/C-30·C-31。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-18（**W8 第二批：lint 基线净收缩 326→318（−8）**）：以整文件清零方式消掉 `frontend/src/lib/chat-file-references.test.ts` 的 8 条 require-await（同步 mock + `as unknown as Response`），`--prune-suppressions` 清陈旧键；`quality:lint` 0 errors / 该文件 vitest 25/25 / tsc 0。**自纠**：整文件替换误伤 `it(..., async () => {`，已还原并改定向替换。W8 余项在册。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-18（**BLOCK-211（W8 首批）completed：C-32 清偿（closeout 十三门 PASS）**）：`env='1'` 从运行时强制开降级为**首载种子**（`env='0'` 仍杀开关）——设置页关掉的守卫不再被残留 env 重新打开；`envShadowedKeys` 不再把 seed 报成遮蔽；compat 基线同批显式改写留因。**新登记 🟡**：`block110-p1-topic-shift` 5 例在 HEAD 上就红（stash A/B 证明与本批无关）。W8 其余项仍在册。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-18T05:33:34.556Z -->
最后更新：2026-10-18（**W8 第六批：技能货架依赖徽标纳入插件硬依赖（UI-527）**）：`preflight` 纳入 `plugins.required`（`hasPlugin` 注入 + `missingPlugins`，缺插件不算 installable），路由用 `plugin-loader` 单一真相；卡片对有插件硬依赖的技能也显示徽标。证据=4/4 + 前端 10/10 + tsc 0；closeout PASS。`skills:check` 5 红仍在（是否补插件包/升阻塞门禁属 C-33 裁决）。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-18（**W8 第六批：休眠插件激活转为裁决包 C-33（需用户选 A/B/C），不代裁**）：实码核对——`resources/skills/manifest.json` 仅 14 条、**无 status/依赖/验证时间字段**，全仓无"休眠插件"机械登记（grep 仅两处注释）；评估报告的「休眠插件+demo 错位」是产品观感判词。三选一：A 现状+如实标注 / **B 激活零重依赖一族+其余标未适配（建议）** / C 全量激活（G0 无验证条件）。本批未改任何插件/技能代码，只留证与选项。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-18T07:27:09.699Z -->
最后更新：2026-10-18（**W8 第七批：`skills:check` 报告级纳入收口**）：`closeout-gates.mjs` 增 `--report`（非阻塞、不改进程退出码），`closeout` 已挂 `--report skills:check` ⇒ 每次收口打印红条数；未升阻塞（补齐 `built-in-plugins/` 属 C-33 裁决）。顺修：改脚本误删 `repoGate`（ReferenceError）已恢复并冒烟验证。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-18T10:56:13.485Z -->
最后更新：2026-10-18（**BLOCK-212 立项发令 active：提示词缓存前缀优化**）：两处成本泄漏已读码定位——动态上下文在 system 头部（每轮变⇒前缀全废）、Anthropic 无 cache_control（system 单字符串⇒全价）。方案=动态段搬尾部（不落历史）+ anthropic block 断点 + 基线加静态前缀 token；不声称真实命中率提升（需 G1+ 调用）。plan=docs/block-212-prompt-cache-prefix-plan.md。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-20T02:04:57.787Z -->
最后更新：2026-10-18（**BLOCK-212 completed（十三门 PASS）：提示词缓存前缀优化**）：动态上下文搬消息尾部（尾块不落历史），Anthropic system 改 block + 静态段 cache_control；基线增静态前缀规模与命中率阈值。证据=7/7 + 邻域 52/52。**局限**：静态前缀 215 tokens < Anthropic 1024 最小可缓存 ⇒ Claude 断点当前空操作；真实命中率需 G1+。G0 开发期常态 · 不外推 packaged/Provider/GA。
