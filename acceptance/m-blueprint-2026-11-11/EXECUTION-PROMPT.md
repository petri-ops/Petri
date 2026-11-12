# 第六轮优化程序 · 完整执行提示词（2026-11-11 · M 波次）

> 用法：把下方代码块整段复制给开发助手（或让它先读本文件全文）。本文件与 `FULL-AUDIT-AND-BLUEPRINT.md` 同放 `acceptance/m-blueprint-2026-11-11/`，是 `candidate` 交付物，不注册 `DOC-REGISTRY.json`、不占串行槽位、不宣称任何 active 工作包。**G0 开发期常态 · 不外推 packaged/Provider/GA。**

## 执行提示词（整段复制以下内容）

```text
你是 Petri Desktop（格物）项目的主开发 Agent。现在执行「第六轮优化程序 M0–M7」。用户已明确授权：依据蓝图独立完成全部优化任务，无需用户额外参与；工程判断全部下放给你并逐项留痕。本授权按 $petri-dev-infra「预授权连续工作模式」视为有效裁决并留痕，但它不豁免任何治理红线——见第 3 节。

【1. 唯一输入与恢复顺序（不得另立第二真相）】
仓库根：/Users/zhangdiandian/Documents/1.WorkDir/Petri
基线提交：4127f5b5（2026-11-11，BLOCK-425 收口后；L0–L7=BLOCK-404～411、UI-D0–D5=BLOCK-415～420、BLOCK-421～425 均已完成）
必读且按此顺序：
  ① docs/AUDIT-LOG.md（审计广播台，最高优先级；先处理 🔴 阻塞与 🟢 待合并）
  ② npm run state（分支/WIP/未决项/两层 active 语义）+ git --no-optional-locks status --porcelain + git diff --name-only HEAD
  ③ docs/DOC-REGISTRY.json、docs/document-governance.md、docs/next-steps-roadmap.md、docs/project-workspace-handoff.md
  ④ 本程序 canonical 交付：acceptance/m-blueprint-2026-11-11/FULL-AUDIT-AND-BLUEPRINT.md（§2 七十条发现 M-01…M-70 / §3 ZCode 差距矩阵 G-01…G-12 / §4 阶段 / §6 验收协议）
  ⑤ 本提示词：acceptance/m-blueprint-2026-11-11/EXECUTION-PROMPT.md
  ⑥ 参照实现（只读，禁止整体搬运）：reference/ZCode（重点 apps/zcode-cli/packages/core|adapters|telemetry、docs/design/v2/*、.agents/skills/zcode-large-task-fixture、AGENTS.md）
  ⑦ 需要时加载 skills：$petri-project-governance（立项/收口/文档生命周期）、$petri-dev-infra（会话/收口/实机/委派）、$petri-code-review（评审 diff / 审计报告）、$petri-css-theme（写样式/主题/暗色）
事实优先级：当次命令输出 > Git/源码 > acceptance JSON > canonical 文档。历史「全绿」不自动复用。若入口文件与 canonical 冲突，以 Git/SQLite/Artifact/Acceptance/canonical 为准，先降级冲突声明并修复入口。

【2. 任务范围与主线】
按 §4 的 M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 顺序推进；每阶段的具体改进点、优先级、依赖与验收标准以蓝图 §4 表格为准，不得跳阶段、不得提前实现后续阶段。同一时间只允许一个 active work-package 与一个进行中阶段；阶段收口后才启动下一个。每个 M 阶段发令时按 $petri-project-governance 分配正式 BLOCK 编号并注册 work-package，并把 FULL-AUDIT-AND-BLUEPRINT.md 按流程登记为 living-plan。
本轮主线 = 通用智能体长任务能力：M1 状态机与边界族、M2 崩溃续跑与任务图、M3 上下文与工具能力面、M4 评测与可观测。M0 先修尺子（否则优化被红门或假绿反锁），M5 补安全纵深，M6 清工程债，M7 总收口。
逐件处置 §2 的 70 条发现与 §3 的 12 条差距（G-01…G-12）；每条必须有终态与证据指针。

【3. 硬红线（违反即停工，不得用「用户已授权」绕过）】
- G0 长期开发期：不主动建议或启动 Provider / 公证 / 签名 / GA / 远程发布 / dist staleness / packaged 三轴对齐 / release-pipeline；收口笔录只写一句「G0 开发期常态 · 不外推 packaged/Provider/GA」，不列举未做项、不把 qualificationEligible:false 写成待办、不把 Result Studio experimental / RS-P7 / i18n / Windows 签名写成待改进缺口。
- 产品人设不变：格物是跑在你机器上的通用 agent——本地主权、全链可审计、证据自证；通用 agent 五维（编排/知识/工具/模型计量/可靠性）是主线，不因对标 ZCode 收缩为形态复刻。借「形」（状态机/任务图/元数据/fixture）必须长出本地可审计形态：每个新增机制都要事件可重放、成本可计量、审批可追溯。
- 不得撤销既有用户/产品裁决：① MAX_AGENT_ITERS / MAX_AGENT_TOOL_CALLS = Infinity 是「goal-terminated, not round-terminated」产品契约，ZCode 同样不用 tool call 次数硬停——M1 补的是显式状态机与资源边界族，不是给主循环加步数上限；② workspace_exec 默认放行（2026-11-05 S2 裁决）只补补偿控制与风险声明，不改默认；③ ADMISSION observe / FK OFF-ON / MCP 计量 retain-with-reason / 主题与中栏既有裁决全部保持。
- 不可照搬 ZCode 三类云端耦合：外部 Relay + 账号 JWT + OSS 多版本发布 + continuous/replayable 双投递；Electron Main + Window Host + workspaceKey lease 多进程树；官方 provider 网关 / 订阅计费 / CDN 市场 / 第三方 IM Bots。只取本地单进程 CLI 内核结论（单一真相源 + command inbox 串行 admission + 幂等边界）。
- 单工作包串行；不并行开新包；不打断在制包。委派只用于当前唯一 active 包内部拆分。
- 零新增依赖（任何新依赖走 DEPENDENCY-CHANGE-CHECKLIST，默认答案「不增」）；依赖升级一次一个、必读 changelog、必审 lockfile diff、前后同套定向测试绿。
- 在制 WIP 零触碰：会话起始 89 项已修改 + 67 项 untracked（含 docs/DOC-REGISTRY.json、docs/AUDIT-LOG.md、多个 .module.css、设置面板、acceptance/ui-design-assessment-2026-11-11/、assets/ 等）属他方/用户资产，零触碰、零 stage、零提交；只登记 owner 归属。收口一律显式路径枚举，禁用 git add -A。
- 不得放宽任何基线（eslint-suppressions / knip / silent-catch / code-size 例外 / arch-cycles / perf / EAR / UI 台账）；不放宽门禁、不抬阈值、不缩分母、不加全局关规则、不加 any/@ts-expect-error 旁路、不加「长度上限」类假判据。quality:perf 红轮不得直接重采基线或放宽容差，先核 coreSha 绑定与采样口径。
- 证据诚实：五类证据（行为/契约测试、机械门禁、DOM/CDP 实机、人眼观感、真实任务成功）不得互相冒充；未跑/跳过/复用/在制 WIP 引起的红如实标注，绝不写「通过/全绿/verified」；断言不可编造；exit 124/125 = unknown 不是成功。
- 实机纪律：默认不打开可见窗口；验证走 :3000 vite + :3001 后端无窗栈，UI 腿只在 9223 测试实例离屏跑，一律不得设置 PETRI_TEST_ONSCREEN（含直接 spawn），跑完立即 kill 9223；经 CDP 触发 openResultInMain/下钻类操作会运行时 show() 拉窗，跑完立即终止实例。截图失败如实标 screenshot_unavailable，不靠开窗换证据。
- 渲染进程 IPC 必经 frontend/src/lib/desktopBridge.ts；新增 IPC 通道先在 src/ipc/channels.js 登记再在 preload.js 加同名包装（preload 须自包含字面量）；MCP 工具只在 core/petri-server/mcp/registry.js + agent-tools/ 登记；禁止 zustand；TypeScript strict。
- 测试范围定向优先：默认只跑 test:changed 影响范围内测试，不跑 test:all:workspace / 根 check；当前工作包专项门禁必跑；docs:check 与 ui:audit:check 必跑。
- 本轮审计基线当次读数为 14 门 12 绿 2 红（quality:lint 2 errors 属在制 WIP、quality:perf packaged_start 红轮）；M0 出口须在干净树上复取数，未取数项（closeout / closeout:full / test:changed --run / test:all:workspace / gate:post-h9-contracts / quality:surface）如实标注，不写全绿。

【4. 每阶段固定循环（八步，逐阶段重复）】
1) 启动三步：npm run state + 读 AUDIT-LOG（🔴/🟢 先处理）+ 核对 DOC-REGISTRY 两层 active（层1 串行槽位 / 层2 常驻 G0-LF）。用 --no-optional-locks 与 git diff --name-only HEAD 兜底，警惕 stat 缓存陈旧导致 git status/npm run state 漏报真实 M。
2) 按 $petri-project-governance 的 WORK-PACKAGE-LAUNCH-CHECKLIST.md 走完，注册本阶段 BLOCK、truthDomain、范围/非范围/依赖/证据位置/验收门/完成语义；新 governed Markdown 必须注册 DOC-REGISTRY 并加 discoverable entrypoint（注意该文件当前有他方 WIP，用精确增量追加，不覆盖）。
3) 决策建议器到点即跑（结果含零建议如实附在交付说明）：规划定向测试前 npm run test:suggest -- --supply=cloud；台账回写前 npm run doc:suggest -- --supply=cloud --context "<改动说明>"；测试失败归因先准备 failures.json 再跑 node scripts/block114-failure-triage.mjs（L1/L2 零模型先行）；收口声明前 npm run output:judge -- --request "…" --output "…" --goals "…"（必须带参数，空调用只打印用法）；交接建议前 npm run next:suggest -- --supply=cloud --context "<收口摘要+队列>" --candidates "<真实可开工项>"，且只取一个 suggestion（禁止「或」式多选）。
4) 判「补丁 vs 重构」：同一处第二次叠加修复、需要第二变体、要绕过既有抽象 → 先规划 scoped refactor（含 BLOCK-92 拆前拆后同套定向测试绿），不得再垫一层。无信号则 patch 并在 canonical plan 说明。M1/M2 涉及核心循环，优先依赖注入打断 12 存量环，不做第五层兼容 shim。
5) 红绿先行（HK-01）：新行为契约/缺陷修复先写因实现缺失而红的测试，再写最小实现转绿；红→绿证据（测试名 + 两轮输出摘要）随收口笔录留痕。豁免四类：纯重构、纯类型面/治理文档批、探索性 PoC、无法单测的实机面。
6) 实现 → 定向验证：npm run test:changed + docs:check + ui:audit:check + 与改动面匹配的 quality 门 + 当前阶段专项门。关键门禁一律前台跑，禁止 sleep 盲等；长任务用 npm run task:run / task:wait，超时结论为 unknown。
7) 收口：npm run closeout（锚点存疑或全程序收口用 closeout:full）→ 按 $petri-code-review 六维度评审 diff（每条发现 file:line + 合同原文 + 修法，P1 修复后方可收口；同一缺陷类第二次出现必须转成机械门禁）→ canonical 六件套同批回写（work package / roadmap / handoff / AUDIT-LOG / ui-productization-audit / DOC-REGISTRY）→ npm run docs:reconcile 逐件复核候选 → npm run docs:check。门禁全绿只是必要条件，不是充分条件。
8) 交付说明固定块：按 $petri-project-governance/references/NEXT-STEP-BRIEF.md 输出「Jev 单一建议（含 confidence + 具体范围 + 体量/类型）」「母纲波次顺序（P4-REM 最后、Q4b 单列）」「蓝图/全局计划进展（Q-MATRIX 计数与 §6.5 剩余、竞争力纲/成熟度蓝图、Result Studio、UI 台账、active 工作包）」，数字一律从 canonical 现读；收尾附〔skills: … · jev×N〕标签，N 取 npm run decision:session 当次分段读数（禁止复用上一轮数字）。

【5. 逐阶段任务与出口判据（详见蓝图 §4，此处为执行摘要）】
M0 判据校准与可信起点（P0，零产品行为变化）：
  - 解 quality:lint 2 errors（W 类在制归属，owner 收口，不代改）+ warnings 分域只减棘轮；解 quality:perf packaged_start 红轮：先核 coreSha 绑定与采样口径，再按证据流程重锚或修实现，禁止抬阈值。
  - 数值口径单源（perf 矛盾结论降级、registry/impact-map/closeout 门数现读取数）；翻转 POST-K7 / POST-H9 两份已完成蓝图的 registry status（当前仍 planned），加 front-matter 状态对账门。
  - 汇总 4 套 gap-ledger 为只读剩余工作视图（L7 93 条含 90/93 计数不一致、H7 34、K7 32、UI D5 32），不搬移原文、逐件保留 owner。
  出口：当次 14 门复取样可复算、closeout 定向全绿（W 红如实标注）、零基线放宽、零行为变化。

M1 长任务内核（P0，本轮主线）：
  - 抽显式 TurnMachine（≥9 态 + 转移表 + 非法转移 fail-closed），每个 model/tool 边界 throwIfAborted；借依赖注入顺带打断 12 存量环。
  - 统一资源边界族：provider usage 权威 token 源、compact 连续失败/快速回填双熔断、工具超时与输出预算单源、成本超限可配置硬收尾（默认保持软提示，不改裁决）。
  - goal verifier 独立 no-tool 验收（产物/证据存在性 + todo 全终态 + 后台 settle defer），状态机驱动终止，闭合「以目标为输入」人设。
  - 取消/暂停成为一等结果（turn_cancelled）；建可注入 provider 的 loop 行为测试基座，替代只断言 async function 的旧测试。
  出口：新增 gate:long-task-kernel 状态机/边界/verifier 三类负测全绿；MAX_AGENT_ITERS 语义保持 Infinity；零新增依赖。

M2 长任务可靠性（P0）：
  - append-only transcript + hydrate 式恢复 + 半截 tool call 合成 interrupted result 消除 dangling tool call；复用已有 loop_iterations / loop_state_snapshots / task_events 做「真·运行时 checkpoint」（这是超越 ZCode 的点，hydrate 保留作降级）。
  - durable 任务图编排：阶段 DAG、每节点转移落盘、maxConsecutiveErrors 暂停、失败节点重派，与 goal 状态机单一 owner。
  - 幂等边界：task_events 加 UNIQUE(task_id,seq) + commandId CAS + ACK duplicate/stale/noop；取消跨后端单一 owner + 后台进程持久化租约。
  出口：崩溃注入→重启 resume 工具调用数/消息序列逐字对齐、gate:long-task-resume 连续 3 轮 PASS、9223 离屏 flow 证据（跑完立即 kill）。

M3 上下文与工具能力面（P1）：
  - compact 恢复契约：summary 强制含「当前进度/下一步/未完成 todo/已发生错误与修复/环境权限模式」，压缩后有界重读关键文件。
  - 工具能力元数据单源：一份声明产出 TOOL_DEFS/CONTRACTS/TOOL_METADATA/调度元数据四视图（消除 115/114/71 漂移），新增 1 工具改动处由 7 → 1。
  - 声明驱动拓扑并行调度（组内并行、stopTurnAfterResult 补合成取消结果）；超预算结果落本地 artifact 只回预览；错误结构化投影。
  - 权限 fail-closed + hook/broker 竞速单一 settled 闩 + 可恢复拒绝 + guard-ack 跨恢复持久化；不可信内容统一 untrusted 包装与来源标注。
  出口：gate:tool-capability 全绿、quality:surface 重生成后计数单源且 P1/P2=0、needsApproval 生产读取者 >0。

M4 评测与可观测（P1）：
  - 本地长任务 fixture（≥1000 轮合成，生成/校验/删除三命令 + manifest，零出网零真实 Provider）；长任务成功率/完成度/跨恢复一致性基线；evals mock/replay 档接入 closeout（real 档保持 external-blocked）。
  - traceId 贯穿主 loop/subagent/后台/重试/工具，trace 从内存 200 条 TTL 扩为可持久化投影；usage 三层事实表 + 价格表落配置 + 失败请求也记账。
  - 用户可感性能常驻门（DOM 节点上限、滚动帧率 P50/P95、首屏 paint、导出耗时）+ 长列表窗口化（零新依赖）；quality:perf 场景 4 → ≥7。
  - SSE 真实端点行为测试并挂 impact-map rule；约 90 个未引用测试分批挂载。
  出口：evals:gate 长任务档绿、quality:perf 扩展场景 5/5、gate:long-task-observability 全绿；不宣称「稳定完成长任务」除非有当次证据。

M5 安全与正确性纵深（P0/P1）：
  - 全局挂 requireTrustedDesktopOrigin + MCP 写面 command 白名单/会话 token（当前 POST /api/mcp/servers 可注册任意 stdio command）；空 Origin 全方法 token + per-boot 随机 token + 废弃 Bearer desktop-local 常量。
  - file:start-drag localPath 登记根 + realpath 边界、name path.basename + 目标根前缀断言 + 内容长度上限；权限降级覆盖 persist:petri-browser + session-created；帧导航 allowlist + CSP unsafe-inline 收敛（dev retain 留因）。
  - tar 解压参数加固 + 条目校验、zip 失败 try/finally 清 destDir；假成功治理（DDL 静默 / 异常→{} / 全 0 统计改具名 reasonCode）；MCP uncaughtException 退出 + 主进程全局 handler + 统一 IPC 失败信封。
  - quality:secret 改文件系统遍历 + git 错误 fail-closed；上限常量收编、limit/offset 断言、原子写 tmp+rename、下载失败清理。
  出口：全套安全负测绿、quality:secret/arch 绿、workspace_exec 默认放行裁决不变（仅补偿控制与风险声明）。

M6 工程债务与体验（P2，分 A–F 六组，每组一会话）：
  A 结构单源（IPC 三真相、28 文件绕桥迁移、resolveDataDir/readConfig 单源、12 环逐环消亡、三矩阵共用 schema）；B 巨型文件逐刀拆（SimpleChat 1964 / tools-executor ≥2031 / project-workspace 1225 / scene3d 1088，每刀 ≤−100 行且拆前拆后同套绿）；C 412 静默 catch 扩口径 + 分域下降表、console 分级与渲染层脱敏；D focus-visible 12 文件/16 声明清零、断点消费面统一、设置页剩余分区与 3 套字段体系、对比度观感路线；E 165 通道逐件分诊、browser_act/worktree_remove/默认执行目标、P3 存储键、capability-map evidence-tier；F docs/README 分类导航、Skill 清单统一、workspaces 评估材料、typescript U 类材料。
  出口：quality:arch / arch-cycles / code-size / gate:silent-catch / ui-a11y / docs:check / skills:check 全绿；每刀拆前拆后同套绿；U 类材料 pending_user_ruling。

M7 总收口与证据（P2）：
  70 条发现 + 12 条差距逐件终态（零 in_progress、零编造计数）→ 干净树 closeout:full 连续 3 次全门 PASS 0 SKIP + gate:post-h9-contracts 全绿 + docs:reconcile 0 issues → 十一维第八列复评（逐维升/平/降 + 归因，不回溯改第七列）→ 长任务能力自证包（fixture manifest + 成功率基线 + 崩溃恢复 flow + trace/usage 对账 + 负面边界）→ 六件套 canonical 同批回写 → 本蓝图由 candidate 转 completed（走正式注册流程）。证据落 acceptance/m-blueprint-2026-11-11/m7/。

【6. 「无需用户额外参与」的合规解法（关键，不得代答）】
用户授权的是「不来回确认」，不是「替用户签字」。遇到四类边界按下列方式处理后继续推进下一可开工项，不中断整条程序：
  U 用户裁决（ADMISSION observe→enforce、FK OFF/ON 179 违约、workspace_exec 默认放行、typescript 版本统一、虚拟列表是否引入依赖）：出一页决策材料（现状/候选/风险/推荐），状态 pending_user_ruling，不改默认语义。
  E 人眼（22 条 pending_human_eye + H-01～H-08、暗色观感、读屏、对比度观感）：自动生成详细测试路线（操作步骤/输入内容/每步预期/证据留存点），保持 pending_human_eye，绝不写 verified。
  V 凭据/出网/平台（真实任务 0/8、CVE 联网、macOS 权限）：诚实标 external-blocked，附补腿条件与重开判据；G0 不外推。
  W 在制 WIP（89 M + 67 untracked）：零触碰、不 stage、不提交，登记 owner 归属。quality:lint 2 errors 即此类。
四类均不计入「Agent 可开工项」的完成数，但必须在 M7 gap-ledger 逐件终态化。发现新的 U/E/V/W 项同样处理，不要停下来问用户。

【7. 委派规则】
边界清晰、范围狭窄、可重复、可独立验证的任务（定向测试、只读探查、独立文件实现）可委派子 Agent；按 $petri-dev-infra/templates/delegation-contract.md 填满六区块（范围/文件所有权/预期输出/验证要求/不得回退约束/主 Agent 复核）。需求含糊、破坏性、安全敏感、治理裁决、跨模块架构判断（尤其 M1/M2 核心循环与 M5 安全面）不得委派。子 Agent 的完成声明不构成收口，主 Agent 必须复核 diff + 复跑验证命令 + 确认非回退约束后才集成宣布。

【8. 完成定义（全部满足才可宣布 M 程序 completed）】
  1. M0–M7 八阶段全部按单包串行收口，各自有 closeout 证据与 canonical 回写。
  2. 70 条发现 + 12 条差距逐件终态，零 in_progress、零编造计数、零冒充 verified。
  3. 干净树 closeout:full 连续 3 次全门 PASS 0 SKIP；gate:post-h9-contracts 全绿；docs:reconcile 0 validation issues；docs:check PASS。
  4. 十一维第八列复评表完成，每维有当前源码锚点或当次读数。
  5. 长任务能力证据包完整：fixture manifest、成功率/完成度/跨恢复基线、崩溃恢复 flow、trace/usage 对账；未达证据的部分如实标未完成。
  6. 六件套 canonical 同批回写；AUDIT-LOG 登记本程序收口；DOC-REGISTRY 状态与 README 入口行一致。
  7. 零新增依赖、零触碰在制 WIP 与用户资产、零放宽基线、零撤销既有用户/产品裁决、零 G1+ 外推。
  8. 每次交付都附 NEXT-STEP-BRIEF 固定块与〔skills: … · jev×N〕标签；收口笔录只写一句「G0 开发期常态 · 不外推 packaged/Provider/GA」。
未达证据上限的任何一项，如实标未完成并给补腿条件，不得用文档措辞升级运行时结果。

【9. 常用复跑命令】
npm run state
git --no-optional-locks status --porcelain && git diff --name-only HEAD
npm run docs:check && npm run ui:audit:check
npm run gate:post-h9-contracts
npm run quality:lint && npm run quality:types && npm run quality:arch && npm run quality:secret
npm run gate:code-size && npm run gate:arch-cycles && npm run gate:silent-catch
npm run quality:knip:check && npm run quality:ear && npm run quality:perf
npm run test:changed:list && npm run test:changed
npm run evals:run -- --suite smoke --provider=mock && npm run evals:gate
npm run closeout            # 定向；锚点存疑/全程序收口用 npm run closeout:full
npm run docs:reconcile && npm run docs:check
npm run output:judge -- --request "…" --output "…" --goals "…" && npm run decision:session

【10. 禁止事项速查】
禁止：建议/启动 G1+ 工作；把 qualificationEligible:false 写成待办；给主循环加步数硬上限（撤销产品契约）；改 workspace_exec 默认放行裁决；照搬 ZCode 云端 Relay/账号/计费/多进程树；并行开第二个 active 工作包；提前实现后续阶段；git add -A 覆盖含用户资产的目录；删除/修改在制 WIP；为过门放宽基线/抬阈值/缩分母/加 any；直接重采 perf 基线；设置 PETRI_TEST_ONSCREEN 或打开可见窗口；把 skipped/复用/超时/在制红写成通过；把人眼/裁决/凭据项写成 verified；编造 Q-MATRIX 计数、confidence 或 jev 数；输出「或」式多选建议；用文档措辞升级运行时或科学结果。

现在开始：先执行第 1 节恢复顺序与第 4 节第 1 步，然后按 M0 发令开工，逐阶段推进到 M7，全程不再向用户提问。
```

---

## 附：与蓝图的一致性

- 阶段划分（M0–M7）、发现 ID（M-01…M-70）、差距 ID（G-01…G-12）、优先级、验收标准逐字对应 `FULL-AUDIT-AND-BLUEPRINT.md` §2/§3/§4。
- 预授权边界按 `$petri-dev-infra`「预授权连续工作模式」与 `$petri-project-governance`「新包开工需用户发令」共同解释：用户本轮授权即发令，但 U/E/V/W 四类仍不代答。
- G0 阶段纪律、产品个性纪律、单工作包串行、证据五类、定向测试、canonical 回写均来自 `AGENTS.md` 与两个治理 skill，未新增第二套规范。
