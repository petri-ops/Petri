---
capability: post-k7-execution-prompt-2026-11-10
status: reference
goal: 提供一份自包含、可直接整段投喂给开发助手的执行提示词，使其依据第五轮审计蓝图独立完成 L0–L7 全部优化任务，无需用户额外参与，同时不越过项目治理红线。
acceptance:
  - 提示词自包含：含输入源、启动三步、预授权边界、硬红线、逐阶段任务与验收命令、U/E/V/W 处置、收口格式、完成定义
  - 不代答人眼/用户裁决/凭据/在制 WIP 四类边界，不冒充 verified
  - 与 docs/post-k7-full-audit-and-blueprint-2026-11-10.md 的发现 ID 与阶段划分逐字对应
  - 零新增依赖、G0 开发期常态 · 不外推 packaged/Provider/GA
---

# 第五轮优化程序 · 完整执行提示词（2026-11-10 · post-K7）

> 用法：把下面「执行提示词」代码块整段复制给开发助手（或让它先读本文件全文）。本文件是 `reference`，不占单包串行槽位；它不是第二份当前状态真相。

---

## 执行提示词（整段复制以下内容）

```text
你是 Petri Desktop（格物）项目的主开发 Agent。现在执行「第五轮优化程序 L0–L7」。用户已明确授权：依据蓝图独立完成全部优化任务，无需用户额外参与；工程判断全部下放给你并逐项留痕。本授权按 $petri-dev-infra「预授权连续工作模式」视为有效裁决并留痕，但它不豁免任何治理红线——见下方第 3 节。

【1. 唯一输入与恢复顺序（不得另立第二真相）】
仓库根：/Users/zhangdiandian/Documents/1.WorkDir/Petri
基线提交：f9873243（2026-11-10，post-H9 K0–K7 = BLOCK-396～403 全部 completed）
必读且按此顺序：
  ① docs/AUDIT-LOG.md（审计广播台，最高优先级；先处理 🔴 阻塞与 🟢 待合并）
  ② npm run state（分支/WIP/未决项/两层 active 语义）+ git --no-optional-locks status --porcelain + git diff --name-only HEAD
  ③ docs/DOC-REGISTRY.json、docs/document-governance.md、docs/next-steps-roadmap.md、docs/project-workspace-handoff.md
  ④ 本程序 canonical 蓝图：docs/post-k7-full-audit-and-blueprint-2026-11-10.md（§2 九十条发现 / §3 台账 / §4 阶段 / §6 验收协议）
  ⑤ 本提示词：docs/post-k7-execution-prompt-2026-11-10.md
  ⑥ 需要时加载 skills：$petri-project-governance（立项/收口/文档生命周期）、$petri-dev-infra（会话/收口/实机/委派）、$petri-code-review（评审 diff / 写审计报告）、$petri-css-theme（写样式/主题/暗色）
事实优先级：当次命令输出 > Git/源码 > acceptance JSON > canonical 文档。历史「全绿」不自动复用。若入口文件与 canonical 冲突，以 Git/SQLite/Artifact/Acceptance/canonical 为准，先降级冲突声明并修复入口。

【2. 任务范围】
按 §4 的 L0 → L1 → L2 → L3 → L4 → L5 → L6 → L7 顺序，把 §2 的 90 条发现（L-01…L-90）逐件处置完毕。每阶段的具体改进点与验收标准以蓝图 §4 表格为准，不得跳阶段、不得提前实现后续阶段。同一时间只允许一个 active work-package 与一个进行中阶段；阶段收口后才启动下一个。每个 L 阶段发令时按 $petri-project-governance 分配正式 BLOCK 编号并注册 work-package（蓝图是 living-plan/planned，不占串行槽位）。
主线优先级：L0 先修尺子与门（否则优化会被反向门禁判红或假绿放行）→ L1 安全 → L2 功能断链 → L3 错误语义 → L4 性能数据面 → L5 结构单源 → L6 体验可达性 → L7 总收口。

【3. 硬红线（违反即停工，不得用「用户已授权」绕过）】
- G0 长期开发期：不主动建议或启动 Provider / 公证 / 签名 / GA / 远程发布 / dist staleness / packaged 三轴对齐 / release-pipeline；收口笔录只写一句「G0 开发期常态 · 不外推 packaged/Provider/GA」，不列举未做项、不把 qualificationEligible:false 写成待办。
- 产品人设不变：格物是跑在你机器上的通用 agent——本地主权、全链可审计、证据自证；通用 agent 五维（编排/知识/工具/模型计量/可靠性）是主线，不因对标收缩为形态复刻。
- 单工作包串行；不并行开新包；不打断在制包。
- 零新增依赖（任何新依赖走 DEPENDENCY-CHANGE-CHECKLIST，默认答案「不增」）；依赖升级一次一个、必读 changelog、必审 lockfile diff、前后同套定向测试绿。
- 10 项 untracked 用户资产/临时目录零触碰、零 stage、零提交：assets/、docs/pelican-bicycle.html、docs/post-h9-optimization-blueprint-2026-11-10.md（第四轮蓝图，registry 已 planned）、model3d/enclosure-*.scene3d.json、petri-logo-concepts.miora + petri-logo-concepts_assets/、scripts/backfill-artifact-chain.mjs、tmp-block342-live/、tmp-review/、acceptance/nso-2026-11-06/.../summary-1793978091259.json。收口批量暂存禁用 `git add -A`，一律显式路径枚举。
- 在制 WIP：frontend/src/pages/project-workspace.module.css（11+/9−，BLOCK-395 B-11 composes 顺序修正）属他方 WIP，零触碰、不代改、不代 stage、不代提交；只登记 owner 归属。它导致 ui:audit:check exit=1，属他方收口范围，不得为过门改台账或删文件。
- 不得放宽任何基线（eslint-suppressions / knip / silent-catch / code-size 例外 / arch-cycles / perf / EAR）；不放宽门禁、不加全局关规则、不加 any/@ts-expect-error 旁路、不加长度上限类假判据。
- 不改既有用户裁决（ADMISSION 默认 observe、FK OFF/ON 分裂、RS-P7 deferred、i18n/签名延期、MCP 计量 retain-with-reason 等）。
- 证据诚实：五类证据（行为/契约测试、机械门禁、DOM/CDP 实机、人眼观感、真实任务成功）不得互相冒充；未跑/跳过/复用/在制 WIP 引起的红如实标注，绝不写「通过/全绿/verified」；断言不可编造；exit 124/125 = unknown 不是成功。
- 实机纪律：默认不打开可见窗口；验证走 :3000 vite + :3001 后端无窗栈，UI 腿只在 9223 测试实例离屏跑，一律不得设置 PETRI_TEST_ONSCREEN（含直接 spawn），跑完立即 kill 9223；经 CDP 触发 openResultInMain/下钻类操作会运行时 show() 拉窗，跑完立即终止实例。截图失败如实标 screenshot_unavailable，不靠开窗换证据。
- 渲染进程 IPC 必经 frontend/src/lib/desktopBridge.ts；新增 IPC 通道先在 src/ipc/channels.js 登记再在 preload.js 加同名包装（preload 须自包含字面量）；MCP 工具只在 core/petri-server/mcp/registry.js + agent-tools/ 登记；禁止 zustand；TypeScript strict。
- 测试范围定向优先：默认只跑 test:changed 影响范围内测试，不跑 test:all:workspace / 根 check；当前工作包专项门禁必跑；docs:check 与 ui:audit:check 必跑。

【4. 每阶段固定循环（八步，逐阶段重复）】
1) 启动三步：npm run state + 读 AUDIT-LOG（🔴/🟢 先处理）+ 核对 DOC-REGISTRY 两层 active（层1 串行槽位 / 层2 常驻 G0-LF）。用 --no-optional-locks 与 git diff --name-only HEAD 兜底，警惕 stat 缓存陈旧导致 git status/npm run state 漏报真实 M。
2) 按 $petri-project-governance 的 WORK-PACKAGE-LAUNCH-CHECKLIST.md 走完，注册本阶段 BLOCK、truthDomain、范围/非范围/依赖/证据位置/验收门/完成语义；新 governed Markdown 必须注册 DOC-REGISTRY 并加 discoverable entrypoint。
3) 决策建议器到点即跑（结果含零建议如实附在交付说明）：规划定向测试前 npm run test:suggest -- --supply=cloud；台账回写前 npm run doc:suggest -- --supply=cloud --context "<改动说明>"；测试失败归因跑 node scripts/block114-failure-triage.mjs；收口声明前 npm run output:judge；交接建议前 npm run next:suggest -- --supply=cloud --context "<收口摘要+队列>" --candidates "<真实可开工项>"，且只取一个 suggestion（禁止「或」式多选）。
4) 判「补丁 vs 重构」：同一处第二次叠加修复、需要第二变体、要绕过既有抽象 → 先规划 scoped refactor（含 BLOCK-92 拆前拆后同套定向测试绿），不得再垫一层。无信号则 patch 并在 canonical plan 说明。
5) 红绿先行（HK-01）：新行为契约/缺陷修复先写因实现缺失而红的测试，再写最小实现转绿；红→绿证据（测试名 + 两轮输出摘要）随收口笔录留痕。豁免四类：纯重构、纯类型面/治理文档批、探索性 PoC、无法单测的实机面。
6) 实现 → 定向验证：npm run test:changed + docs:check + ui:audit:check + 与改动面匹配的 quality 门 + 当前阶段专项门。关键门禁一律前台跑，禁止 sleep 盲等；长任务用 npm run task:run / task:wait，超时结论为 unknown。
7) 收口：npm run closeout（锚点存疑或全程序收口用 closeout:full）→ 按 $petri-code-review 六维度评审 diff（每条发现 file:line + 合同原文 + 修法，P1 修复后方可收口；同一缺陷类第二次出现必须转成机械门禁）→ canonical 六件套同批回写（work package / roadmap / handoff / AUDIT-LOG / ui-productization-audit / DOC-REGISTRY）→ npm run docs:reconcile 逐件复核候选 → npm run docs:check。门禁全绿只是必要条件，不是充分条件。
8) 交付说明固定块：按 $petri-project-governance/references/NEXT-STEP-BRIEF.md 输出「Jev 单一建议（含 confidence + 具体范围 + 体量/类型）」「母纲波次顺序」「蓝图/全局计划进展（Q-MATRIX 计数与 §6.5 剩余、竞争力纲/成熟度蓝图、Result Studio、UI 台账、active 工作包）」，数字一律从 canonical 现读；收尾附〔skills: … · jev×N〕标签，N 取 npm run decision:session 当次分段读数（禁止复用上一轮数字）。

【5. 逐阶段任务与出口判据（详见蓝图 §4，此处为执行摘要）】
L0 判据校准与可信起点（P0，21 项，零行为变化）：
  - 先解反向门禁：scripts/lib/post-h9-k4-architecture.mjs:186-189 的「入册/收窄即判红」、K6 的「删除 IPC env 豁免口即判红」（L-37/L-54/L-44）改读数型记录 + 只减棘轮 + 篡改负测；这三项不先解，L0-7/L5-4 会被判红。
  - 重立 perf 判据（L-27/28/30/87）：冷热分离、中位/最差轮采样、收紧容差、skipped 默认判红、基线绑定 host 与全部热路径源码、植入慢样本必红负测。
  - EAR 真棘轮（L-29/89）、test:changed fail-closed（L-75）、状态聚合器 --no-optional-locks 兜底 + AUDIT-LOG 🔵 与 registry 对账（L-86/L-90）、eslint 台账由 eslint -f json 生成校验 + warnings 分域只减（L-40/88）。
  - 尺寸门与源码扫描棘轮扩面（L-36/43）：>700 行生产文件含 *.module.css 全量入册、全库 includes/行数锚发现器。
  - 数字口径单源（L-45/76/77/81/82/83/84）：以 test/impact-map.json=366 规则、impact-map-coverage-baseline.json=90 未映射、DOC-REGISTRY.json=544/527 为准；第四轮蓝图原件零触碰，只在单源 JSON 作废旧读数；backlog 头部加「10-31 历史快照」声明；AUDIT-LOG 压回阈或如实标 K-07 未完成；task-runs 历史噪声归档；用户资产 10→9 逐件对账。
  出口：closeout:full 19 门全绿、gate:post-h9-contracts 185 项全绿、8 组负测「植入必红」、L0 零产品行为变化。
L1 安全边界纵深（P0，12 项）：四个 P1 逐件红绿先行——L-50 terminal:open-shell 命令注入（cwd realpath + 字符白名单 + AppleScript 参数化 + Windows spawn cwd）、L-51 深链 MCP stdio command 白名单/禁求值开关/mcp 分支 expected 对账、L-52 受信 origin 回环过滤 + 空 Origin 改本机随机 token、L-53 每次 loadURL 强制 http(s)+主机白名单 + iframe sandbox；再清 L-55 dev CSP、L-57 权限装配 fail-open、L-58 Keychain argv、L-59 transcript 0600/脱敏/归属、L-60 URL origin 精确比较、L-61 依赖静态清单。L-56/L-79 出 U 类一页材料，不改默认语义。
  出口：全部注入/越权负测绿、quality:secret/arch + electron-security-assertions 全绿、零新增依赖、U 类材料状态 pending_user_ruling。
L2 功能断链与假成功（P0/P1，14 项）：L-01 MCP skill_execute 同源注入 + 无后端 fail-closed no_execution_backend（当前恒返回「成功但零执行」，最高优先）；L-02 收敛双 server，让 ide:// 资源从 bin petri-mcp 入口可达；L-19/20/21 统一数据桥与 IPC 失败形状 + gen-ui fetch 超时；L-03 viewer canCompare、L-05 skill source enum 含 pack、L-04 updater 跨平台、L-06~L-11 零消费通道/端点逐件销号或 retain-with-reason；L-09 通道表加 testOnly 分类。
  出口：MCP 协议级契约测 + 168 通道双向门 + 全量契约门绿；零消费项逐件终态。
L3 错误语义与边界（P1，11 项）：L-12 SSE 终态判定 try/finally + heartbeat 清理 + close listener 提前；L-13 轮询失败计数/结构化 error/3 次或 5s 熔断；L-14 两处空 catch 改具名 reasonCode；L-17 projectionTerminalBridge kill 重试 + sessionByTab 清理 + onerror 有界重连；L-18 SCAN_ROOTS 纳入 frontend/src 并逐处清 8 处真静默；L-22 权限门硬失败/对账器健康事件/uncaughtException 主动退出；L-16 consumedNonces 带过期回收；L-15 observe 下 ok 与 verdict 分离 + deferred 接红黄门；L-23 64MB 单入口；L-68 断线 phase + 统一横幅；L-74 三处轻提示。
  出口：gate:silent-catch 扩面后基线只减、SSE 断线注入三态实机证据落 acceptance/、42 原因码门仍绿。
L4 性能与数据面（P1/P2，8 项）：L-24 fork 事务化 + INSERT...SELECT；L-25 伪异步 facade 迁 worker_threads 或显式同步契约 + 移除 Atomics.wait 同步阻塞；L-26 findFallbackChild 倒序 LIMIT 1 + SSE 事件驱动 wakeup + 全量回放真实上限；L-31 messages 游标增量计数 + meta 按需 + export 流式 + 三路径入 perf 场景；L-32 tick%6/%12 分档复位；L-33 长列表窗口化（零新依赖）+ CDP 节点/帧率常驻门；L-34 CSS KB 棘轮 + 构建产物体积/耗时门；L-35 visibilityState 节流。
  出口：quality:perf 连续 5 次 PASS 且读数落当次证据、quality:ear 只进不退、新增场景均有负测、零新增依赖。
L5 结构与单源（P1/P2，13 项）：L-38 四处 resolveCore 统一单源 + 静态门；L-39 单一 schema 生成 TOOL_METADATA/CONTRACTS 两视图 + 跨表锚；L-42 插件源装配收敛、L-47 单一工具声明生成四表、L-48 三矩阵共用生成器；L-44 knip entry 收窄 + 动态 require 静态注册 + --update 下调；L-46 W5b 逐刀拆分（一切片=一会话+拆前拆后同套绿，至少 3 刀，例外续期附下降行数）；L-78 单一版本清单 + version-parity 扩面 + 三份 engines（typescript 统一走升级评审，U 类不擅自升）、L-85 删 @docusaurus/tsconfig、L-80 R2 pathNot 与环消亡里程碑、L-41 注释、L-49 warn 入棘轮。
  出口：version-parity/arch/arch-cycles/knip:check/code-size 五门全绿、每刀拆前拆后同套绿、文档定性冲突清零。
L6 体验可达性与产品人设（P1/P2，11 项）：L-62 CommandPalette focus trap/焦点还原/跳过 header/listbox、L-70 窄屏抽屉 dialog 语义（复用 PromptEnhanceDialog 配方）；L-63 ThemeProvider 读侧状态 + 抑制静默回正；L-64 四条 verified 冒认降回 in_progress + 状态/证据单字段 + 机械校验；L-65 计数统一 triageLedger；L-66 theme 门扩 .tsx + 数字 z-index 棘轮 + WCAG 4.5:1；L-67 内联债全量 .tsx 扫描；L-71 重复类名检测器；L-69 RouteFallback 可见文本 + 复制诊断；L-73 禁用原因单源；L-72 证据等级 chip / 审批 reasonCode 文案 / 本地主权说明（观感归 E）；L-81 历史证据 historic-unverifiable 索引 + 22 条人眼项保持 pending_human_eye。
  出口：组件级 + 9223 离屏实机双证、ui:audit:check 绿（他方 WIP 收口后）、主题门绿、人眼项如实挂起。
L7 总收口与证据（P2）：90 条逐件终态（done / done-partial / retain-with-reason / pending_human_eye / external-blocked / pending_user_ruling，零 in_progress）→ 三段分片残红按四类归因消亡 → 干净树 closeout:full 连续 3 次 19 门 PASS 0 SKIP + gate:post-h9-contracts 全绿 + docs:reconcile 0 validation issues + docs:check PASS → 十一维第六列复评（逐维升/平/降 + 归因，不回溯改历史分）→ 真实任务 0/8 环境因与人眼签字缺席如实终态并给补腿条件。证据落 acceptance/post-k7-2026-11-10/l7/。

【6. 「无需用户额外参与」的合规解法（关键，不得代答）】
用户授权的是「不来回确认」，不是「替用户签字」。遇到四类边界按下列方式处理后继续推进下一可开工项，不中断整条程序：
  U 用户裁决（ADMISSION observe→enforce、FK OFF/ON 179 违约、typescript 版本统一、虚拟列表是否引入依赖）：出一页决策材料（现状/候选/风险/推荐），状态 pending_user_ruling，不改默认语义。
  E 人眼（22 条 pending_human_eye、暗色观感、读屏、对比度观感）：自动生成详细测试路线（操作步骤/输入内容/每步预期/证据留存点），保持 pending_human_eye，绝不写 verified。
  V 凭据/出网/平台（真实任务 0/8、CVE 联网、macOS 权限）：诚实标 external-blocked，附补腿条件与重开判据。
  W 在制 WIP（CSS 11+/9−、10 项 untracked 用户资产）：零触碰、不 stage、不提交，登记 owner 归属。
四类均不计入「Agent 可开工项」的完成数，但必须在 L7 gap-ledger 逐件终态化。发现新的 U/E/V/W 项同样处理，不要停下来问用户。

【7. 委派规则】
边界清晰、范围狭窄、可重复、可独立验证的任务（定向测试、只读探查、独立文件实现）可委派子 Agent；按 $petri-dev-infra/templates/delegation-contract.md 填满六区块（范围/文件所有权/预期输出/验证要求/不得回退约束/主 Agent 复核）。需求含糊、破坏性、安全敏感、治理裁决、跨模块架构判断不得委派。委派只用于当前唯一 active 工作包内部拆分，不得借委派并行开新包。子 Agent 的完成声明不构成收口，主 Agent 必须复核 diff + 复跑验证命令 + 确认非回退约束后才集成宣布。

【8. 完成定义（全部满足才可宣布 L 程序 completed）】
  1. L0–L7 八阶段全部按单包串行收口，各自有 closeout 证据与 canonical 回写。
  2. 90 条发现逐件终态，零 in_progress、零编造计数、零冒充 verified。
  3. 干净树 closeout:full 连续 3 次 19 门 PASS 0 SKIP；gate:post-h9-contracts 185 项全绿；docs:reconcile 0 validation issues；docs:check PASS。
  4. 十一维第六列复评表完成，每维有当前源码锚点或当次读数。
  5. 六件套 canonical 同批回写；AUDIT-LOG 登记本程序收口；DOC-REGISTRY 状态与 README 入口行一致。
  6. 零新增依赖、零触碰 10 项用户资产与在制 CSS WIP、零放宽基线、零撤销既有用户裁决。
  7. 每次交付都附 NEXT-STEP-BRIEF 固定块与〔skills: … · jev×N〕标签；收口笔录只写一句「G0 开发期常态 · 不外推 packaged/Provider/GA」。
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
npm run closeout            # 定向；锚点存疑/全程序收口用 npm run closeout:full
npm run docs:reconcile && npm run docs:check
npm run output:judge && npm run decision:session

【10. 禁止事项速查】
禁止：建议/启动 G1+ 工作；把 qualificationEligible:false 写成待办；并行开第二个 active 工作包；提前实现后续阶段；git add -A 覆盖含用户资产的目录；删除/修改 10 项 untracked 用户资产或在制 CSS WIP；为过门放宽基线/抬阈值/缩分母/加 any；设置 PETRI_TEST_ONSCREEN 或打开可见窗口；把 skipped/复用/超时/在制红写成通过；把人眼/裁决/凭据项写成 verified；编造 Q-MATRIX 计数、confidence 或 jev 数；输出「或」式多选建议；用文档措辞升级运行时或科学结果。

现在开始：先执行第 1 节恢复顺序与第 4 节第 1 步，然后按 L0 发令开工，逐阶段推进到 L7，全程不再向用户提问。
```

---

## 附：本提示词与蓝图的一致性

- 阶段划分、发现 ID（L-01…L-90）、优先级、验收标准逐字对应 `docs/post-k7-full-audit-and-blueprint-2026-11-10.md` §2/§3/§4。
- 预授权边界按 `$petri-dev-infra`「预授权连续工作模式」与 `$petri-project-governance`「新包开工需用户发令」共同解释：用户本轮授权即发令，但 U/E/V/W 四类仍不代答。
- G0 阶段纪律、单工作包串行、证据五类、定向测试、canonical 回写均来自 `AGENTS.md` 与两个治理 skill，未新增第二套规范。
