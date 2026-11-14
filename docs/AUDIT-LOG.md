最后更新：2026-11-14（🏁 **BLOCK-446 凭据 file 后端加密化+错误语义分离 completed**：file 后端全写路径 encryptAll 落盘零明文（mcp-env-crypto 单源 AES-256-GCM）+ 整组急切迁移 fail-open + 损坏/不可读 fail-closed 拒覆写 + status() 三态健康面；红绿先行 9/9、邻域回归绿、test:changed 1425/1435 三红先于本包归因（UI-629 W/block414 环境/P6 W）；治理门七项 PASS；closeout 第 4 门 ui-audit 被他方 WIP 拦停如实登记；unmappedTests 90→89 棘轮改善。证据=acceptance/block-446/gate-evidence.json。G0 开发期常态 · 不外推 packaged/Provider/GA.）
最后更新：2026-11-14（🏁 **BLOCK-445 completed（通用 Agent 插件/技能兼容层）**：任意 Agent 的插件目录/技能目录统一识别（ZCode/Claude/Codex/CodeBuddy/… + `.agents/skills`），skills 原生导入、MCP 配置投影（含 `${ZCODE_PLUGIN_ROOT}` 变量替换与插件目录复制）、commands→合成技能、MCP App 页面宿主链路（后端 readResource / 主进程 prepareMcpApp / preload）；真实 ZCode 五个插件试跑通过，444 6/6 + 445 5/5，离屏 Electron 实测 prepareMcpApp 返回沙箱 URL。未覆盖=JS 扩展宿主/hooks/前端自动渲染/插件构建依赖，已在证据里精确列出。证据=acceptance/m-blueprint-2026-11-11/m6a/universal-plugin-compat.json。G0 开发期常态 · 不外推 packaged/Provider/GA.）
# 审计广播台 (AUDIT-LOG)
最后更新：2026-11-12（🏁 **BLOCK-439 端到端核对补漏 + 台账补登记**：补建并注册 BLOCK-436 发令文档（原 `aeda9abc` 只有代码）；补登记 f155dc22 / ca86d4ac / 22a4d2dd / e1282ed5 四次后续提交（复核补测 3 项 / 全量实测三层修 7 个失败 / 凭据与 agent 主链 + evals 1/9→8/9 / 完整 dev 栈启动与真页面收发消息）；机械遗漏 B2–B6 一次补齐——B2 仅重打 perf `coreSha`（阈值/容差零改动，`block350` 15/15）、B3 `BLOCK-264` 测试改用隔离 file 凭据后端不再依赖本机 Keychain、B4 `impact-map` 补挂 4 个生产文件（覆盖门 3/3）、B5 本条台账、B6 `scripts/m-blueprint-m0-wip-owner.mjs` 入库。核对结论：主体工作已完成并推送；凭据回退根因已定位并根治——test/block93-role-prompt.test.mjs 的 mock-key-block93 在 macOS 下经 login Keychain 覆盖用户真实 deepseek 账号（PETRI_LOCAL_DATA_DIR 隔离对 Keychain 无效），已给该测试与 block337 / evals-harness 隔离后端加 PETRI_CREDENTIAL_BACKEND=file，恢复 key 后跑完整 Node 全量仍稳定；`packaged_start` 陈旧产物与 79 个他方 UI 面 WIP 仍待外部条件。G0 开发期常态 · 不外推 packaged/Provider/GA.）
最后更新：2026-11-11（🏁 **BLOCK-437 completed（拖入源范围门 + 真实栈实测）**：`fs/import-from` 在 `cp` 前判定源范围——越界/设备路径/相对/NUL/不存在全拒，符号链接按 realpath 逃逸也拒；默认允许根=家目录+`os.tmpdir()`+`/tmp`+`/Volumes`+项目工作区，`PETRI_DRAG_SOURCE_ROOTS` 可覆盖（`*` 放开）；**实测抓到并修了自己第一版真 bug**：允许根未 realpath 归一 → macOS 上 `/tmp` 与 `os.tmpdir()` 两棵树，合法源被误拒 403；体积棘轮促使抽 `helpers/content-type.js` + `helpers/drag-source-roots.js`，`routes/files.js` 764→**682**（基线 708，不改基线）。真实栈冒烟（无窗/临时库/本机 HTTP）：health·facts·memory-stats·memory-audit·mcp-servers 全 200、evil origin 403 / 可信 200 / `Origin:null` 200、import 允许 200 且 `entry.size=26`、越界 403、设备 403、缺失 404、相对 400、`ddl FAILED=0`、`uncaught=0`。HK-01 15/15、lint 基线 2447 未变（改动文件 0 error）、code-size/arch/secret/knip/ear PASS、docs 581、reconcile 0 issues。未实测：Electron 渲染面、gen-ui 帧导航、MCP 实连、zip 安装、真实模型 loop。证据=acceptance/m-blueprint-2026-11-11/m6a/。G0 开发期常态 · 不外推 packaged/Provider/GA.）
最后更新：2026-11-11（🏁 **M6-A=BLOCK-435 completed（结构单源第一刀：S1 三面 schema 门 + S2 静默 catch 基线 412→406；S3 环消亡已实现但被 D7 域中立棘轮拦下→原样回退，环基线恢复 12）**：三面共用 schema（entry=kind/id/scope/exposed/consumed，ipc168/tool115/route283=566 条）配漂移与已知缺陷只减不增棘轮，首次运行即抓到 `ai-legacy` 双注册 `POST /api/ai/interpret` 与 `summary.metadata` 116 vs 行计数 115（冻结可见、不隐藏）；静默 catch 基线 `412→406`（ai-memory 接单源后 9→3）并同步 M6 分域视图与 M0 读数；环消亡验证通过（12→11、permissions 回归 11/11）但键表含 legacy 别名 `single-cell`/`spatial`，搬迁即计「核心新增领域词残留」⇒ 不改基线洗白、不用拼接规避，原样回退。HK-01 7/7、lint 0、docs:check 580、reconcile 0 issues、arch-cycles 12 PASS、silent-catch 406 PASS、knip 330 PASS。test:changed 1482/2 fail 仍为 UI-629 与 P6（W 类在制 WIP）；closeout exit 1（第 5 门拦停）如实登记。另发现 pre-existing 红：agent-runner.js 1143 行 vs BLOCK-375 锚点 1140（HEAD 既有，不重锚）。证据=acceptance/m-blueprint-2026-11-11/m6a/。G0 开发期常态 · 不外推 packaged/Provider/GA.）
最后更新：2026-11-11（🏁 **M5-A=BLOCK-434 completed（5 项判据接线：4 done + 1 done-partial 带 U 类待裁决 / 2 项仍 done-partial）**：W1 `scripts/secret-scan.mjs` 的 git grep 故障 fail-closed；W2 全局 Origin 门挂到 `bootstrap`（只拦真实 http(s) 不可信来源，`Origin:null`+token 拖出下载语义 9/9 零破坏）；W3 `ai-memory` 迁移期 DDL 收敛单一入口 `ddl-migrate`（`ddlOutcome` 分类 + `redactLog` + 不阻断启动）；W4 `zip` 解压失败清理半成品目录。HK-01 8/8 先红后绿、改动 5 文件 lint 0、quality:arch/secret PASS、docs:check 579、docs:reconcile 0 issues。test:changed 1684/2 fail 两红仍为 UI-629 与 P6（W 类在制 WIP，接线未引入新红）；closeout exit 1（第 5 门拦停），如实登记不写全绿。仍 done-partial：drag 登记根 / MCP 白名单 / 帧导航 allowlist（补腿条件在册）。证据=acceptance/m-blueprint-2026-11-11/m5a/。G0 开发期常态 · 不外推 packaged/Provider/GA.）
最后更新：2026-11-11（🏁 **第六轮优化程序 M0–M7 八阶段收口（程序终态 done-partial）**：BLOCK-426～433 单包串行全部收口；70 条发现 + G-01…G-12 共 82 件逐件终态（零 in_progress、零编造计数：done 21 / done-partial 47 / pending_human_eye 2 / external-blocked 3 / pending_user_ruling 3 / W 6）；十一维第八列 8 升 3 平 0 降（不回溯改第七列、非 verified）；长任务自证包（1000 轮 fixture + 三连恢复门 + trace/usage 对账 + 13 条负面边界）。HK-01 逐阶段累计 106 项、6 个专项门、lint 0；gate:post-h9-contracts 186/186 全绿、docs:reconcile 0 issues、docs:check 578。**closeout:full 三连均 exit 1**（第 5 门 test:changed 两红 W 类在制 WIP 拦停），前 4 门 PASS、后 13 门未执行，如实登记不写全绿、不写 PASS 0 SKIP。§8 完成定义第 3/5 条未达证据上限 ⇒ 程序 done-partial；治理 status=completed 仅表示执行完毕。补腿=干净树 + owner 重采 P6 + 9223 离屏实机腿。零新增依赖/零放宽基线/零触碰 WIP/零 stage 零提交/零撤销裁决/零 G1+ 外推。证据=acceptance/m-blueprint-2026-11-11/m7/。串行槽位转空。G0 开发期常态 · 不外推 packaged/Provider/GA.）
最后更新：2026-11-11（🏁 **第六轮 M6=BLOCK-432 completed（六组终态均 done-partial / W / U / E）**：A–F 组内串行，全部为只读视图/判据/决策材料，零改写基线（silent-catch 412 / knip 330 / code-size 86605 / arch-cycles 12 / UI debt 35 / surface-matrix 在制 WIP 零触碰）；三矩阵 schema 只读对账 + IPC 三真相视图 / 巨型文件只读清单 / 静默 catch 分域下降表 / 165 通道逐件分诊 / W 零触碰 + E 人眼路线 / U 类材料。HK-01 9/9、gate:m6-debt 0 issues、lint 0、七门治理门全绿。test:changed 1497/2 fail 两红 W 归属；closeout exit 1（第 5 门拦停），前 4 门 PASS、后 13 门未执行，如实登记不写全绿。六组无一组冒充 done 或 verified；U/E/V/W 逐件在册交 M7 终态化。证据=acceptance/m-blueprint-2026-11-11/m6/。串行槽位转空；M7 总收口按预授权继续。G0 开发期常态 · 不外推 packaged/Provider/GA.）





















































> 本文件只保存需要主 Agent 看见的活跃广播与最近处理记录。
> 每次会话先读本文件；只有追溯问题来源时才读取[完整历史归档](./archive/checkpoints/audit-log-through-2026-10-11.md) · [through-2026-09-19](./archive/checkpoints/audit-log-through-2026-09-19.md) · [through-2026-09-17](./archive/checkpoints/audit-log-through-2026-09-17.md) · [through-2026-09-16](./archive/checkpoints/audit-log-through-2026-09-16.md) · 上一档：[through-2026-09-13](./archive/checkpoints/audit-log-through-2026-09-13.md) · [through-2026-09-12](./archive/checkpoints/audit-log-through-2026-09-12.md)（更早前史：[through-2026-07-26](./archive/checkpoints/audit-log-through-2026-07-26.md)、[2026-08-pre18](./archive/audit-log-2026-08-pre18.md)）。
> 非主 Agent 发现阻塞、可安全合并或需评估事项时追加到“当前待处理项”，不要把长篇完成历史重新堆回本文件。
> 入口直链（registry `entrypoint` 指向本台的 canonical 文档，归档轮转不得切断发现路径）：[block-14-left-panel-qa-fix-closeout](./block-14-left-panel-qa-fix-closeout.md) · [block-15-architecture-perf-plan](./block-15-architecture-perf-plan.md) · [block-22-codemirror-inline-diff-plan](./block-22-codemirror-inline-diff-plan.md)


## 当前待处理项

| 状态 | 日期 | 事项 | 处置边界 |
| ✅ | 2026-11-11 | **M1=BLOCK-427 收口登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位）**：长任务内核三件套纯新增、Infinity 契约与主循环零改动；closeout exit 1 两红 W 归属如实登记；主循环接线 done-partial 归 M6-A | plan=docs/block-427-m1-long-task-kernel-plan.md | BLOCK-427 / COMPLETED |
| ✅ | 2026-11-11 | **M0=BLOCK-426 收口登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位）**：六项改进点全数交付，closeout exit 1 两红 W 归属如实登记；串行槽位转空，M1 按预授权继续 | plan=docs/block-426-m0-criteria-calibration-plan.md | BLOCK-426 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-421-WORKSPACE-LAYOUT-REFACTOR 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户显式裁决+授权接管 WIP）**：范围=布局定义单源 / 断点变量化 / 四块几何量测；红线=不撤销既有中栏裁决 / 不改视觉 token / 不放宽基线 | plan=docs/block-421-workspace-layout-refactor-plan.md | BLOCK-421 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-420-UI-DESIGN-D5-FINAL 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=汇总门 / 评分卡复评 / gap-ledger / 三连；红线=U·E·V·W 不代答 / 不放宽基线 / 红如实标注 | plan=docs/block-420-ui-design-d5-final-plan.md | BLOCK-420 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-419-UI-DESIGN-D4-A11Y 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=八态矩阵 / focus-visible 只减 / WCAG AA 纯函数 / 9223 离屏 / 人眼签字槽；红线=E 不代答 / 零新增依赖 / WIP 零触碰 | plan=docs/block-419-ui-design-d4-a11y-plan.md | BLOCK-419 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-418-UI-DESIGN-D3-VISUAL 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=token 语义单源 / 裸 z 只减 / `;;` 清零 / 双棘轮下调；红线=WIP CSS 零触碰 / 不放宽基线 / U·E 不代答 | plan=docs/block-418-ui-design-d3-visual-plan.md | BLOCK-418 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-417-UI-DESIGN-D2-LAYOUT 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=断点单源与对齐 / 布局定义唯一性门 / 9223 离屏几何腿；红线=WIP CSS 零触碰 / U-04 不代答 / 零新增依赖 / 不放宽基线 | plan=docs/block-417-ui-design-d2-layout-plan.md | BLOCK-417 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-416-UI-DESIGN-D1-IA 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=单一入口表 + 入口↔路由双向对账门 + 页头残留清理 + U/E 材料；红线=零 UI 结构改动 / 零新增依赖 / U·E 不代答 / 零触碰他方 WIP 与并发写入者在制 | plan=docs/block-416-ui-design-d1-ia-plan.md | BLOCK-416 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-415-UI-DESIGN-D0-BASELINE 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=对账基线机械门 + UI 验收清单 v1 + 门禁读数快照 + plan.started 留痕；红线=零 UI 代码改动 / 零新增依赖 / U·E·V·W 不代答 / 不为过门改台账 | plan=docs/block-415-ui-design-d0-baseline-plan.md | BLOCK-415 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-414-POST-K7-W5B-SLICE-1-SIMPLECHAT 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=SimpleChat.tsx 第一刀内聚抽取；红线=零行为变化/拆前拆后同套绿/零新增依赖 | plan=docs/block-414-post-k7-w5b-slice-1-simplechat-plan.md | BLOCK-414 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-413-POST-K7-L6-FOLLOWUP-THEME-GATE-EXPANSION 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=L-66/67 续（theme 门 .tsx 扩面+z-index 棘轮+内联债全量基线）；红线=观感归 E 不代答/零新增依赖 | plan=docs/block-413-post-k7-l6-followup-theme-gate-expansion-plan.md | BLOCK-413 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-412-POST-K7-L4-FOLLOWUP-MESSAGES-CONTRACT 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=L-31 续（COUNT 索引化+export 流式）；红线=分页行为逐字对齐 K2 基线/零新增依赖 | plan=docs/block-412-post-k7-l4-followup-messages-contract-plan.md | BLOCK-412 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-411-POST-K7-L7-FINAL-CLOSEOUT 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户 2026-11-11 执行提示词预授权连续工作）**：范围=蓝图 §4-L7 五项终态化 | plan=docs/block-411-post-k7-l7-final-closeout-plan.md | BLOCK-411 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-410-POST-K7-L6-EXPERIENCE-ACCESSIBILITY 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户 2026-11-11 执行提示词预授权连续工作）**：范围=蓝图 §4-L6 十一条（L-62/70 焦点 → L-63 → L-64/65 台账 → L-66/67 主题门 → L-69/73 → L-72 人设 → L-81 索引）；观感归 E 不代答；ui:audit:check 的 CSS WIP 红延续 W 归属 | plan=docs/block-410-post-k7-l6-experience-accessibility-plan.md | BLOCK-410 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-409-POST-K7-L5-STRUCTURE-SINGLE-SOURCE 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户 2026-11-11 执行提示词预授权连续工作）**：范围=蓝图 §4-L5 十三条（L-38 → L-39/41/42 → L-44/49 → L-46 W5b → L-78/85/80）；红线=typescript 统一 U 类不擅自升/依赖升级走 checklist/拆前拆后同套绿 | plan=docs/block-409-post-k7-l5-structure-single-source-plan.md | BLOCK-409 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-408-POST-K7-L4-PERFORMANCE-DATAPLANE 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户 2026-11-11 执行提示词预授权连续工作）**：范围=蓝图 §4-L4 八条（L-24 fork 红绿先行 → L-25/26 → L-31/32/33/34/35）；红线=零新增依赖/worker_threads 若超 scoped 判据出补腿不擅自扩 | 拆前拆后同套绿=BLOCK-92 先例。plan=docs/block-408-post-k7-l4-performance-dataplane-plan.md | BLOCK-408 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-407-POST-K7-L3-ERROR-SEMANTICS 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户 2026-11-11 执行提示词预授权连续工作）**：范围=蓝图 §4-L3 十一条（L-12/13/14 SSE → L-17 桥 → L-18 扩面 → L-22/16 → L-15/23 → L-68/74）；红线=零新增依赖/词表类别封闭不破 | 红绿先行=HK-01 全适用。plan=docs/block-407-post-k7-l3-error-semantics-plan.md | BLOCK-407 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-406-POST-K7-L2-FUNCTION-INTEGRITY 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户 2026-11-11 执行提示词预授权连续工作）**：范围=蓝图 §4-L2 十四条（L-01 假成功 fail-closed 最高优先 → L-02 双 server → L-19/20/21 失败形状 → L-03/05 → L-04~L-11 销号）；红线=零新增依赖/不改 skill_execute 产品语义裁决（BLOCK-157 计量 retain-with-reason 不动） | 红绿先行=HK-01 全适用。plan=docs/block-406-post-k7-l2-function-integrity-plan.md | BLOCK-406 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-405-POST-K7-L1-SECURITY-HARDENING 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户 2026-11-11 执行提示词预授权连续工作）**：范围=蓝图 §4-L1 十二条（L-50/51/52/53 四 P1 红绿先行 → L-55/57/58/59/60/61 P2 清偿 → L-56/79 U 类材料）；红线=零新增依赖/不改既有用户裁决/不碰用户资产与在制 WIP；U/E/V/W 边界不代答 | 红绿先行=HK-01 全适用（安全行为修复）。plan=docs/block-405-post-k7-l1-security-hardening-plan.md | BLOCK-405 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-404-POST-K7-L0-CRITERIA-GATES 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户 2026-11-11 执行提示词预授权「依据蓝图独立完成全部优化任务，无需用户额外参与…按 L0 发令开工，逐阶段推进到 L7」＝零参与、工程判断下放并逐项留痕）**：范围=蓝图 §4-L0 八改进点（L0-1 解反向门禁 L-37/54/44 读数型+负测 → L0-2 perf 判据重立 L-27/28/30/87 → L0-3 EAR 棘轮 L-29/89 → L0-4 fail-closed L-75 → L0-5 state 兜底+🔵对账 L-86/90 → L0-6 lint 台账机械校验 L-40/88 → L0-7 尺寸门扩面 L-36/43 → L0-8 数字口径单源 L-45/76/77/81/82/83/84）；红线=零产品行为变化/零新增依赖/不放宽基线/不碰在制 CSS WIP 与 10 项用户资产；非范围=L-54 安全行为面归 L1 | 红绿豁免=治理/判据面批（负测即红绿证据）。plan=docs/block-404-post-k7-l0-criteria-gates-plan.md | BLOCK-404 / COMPLETED |
| 🔵 | 2026-11-09 | **BLOCK-385-post-S7-H0-TRUSTED-START 启动登记（历史阶段广播·不占串行槽位；BLOCK-385 已 completed，见处理记录——原「active」表述系 L-90 登记的两层语义冲突源，2026-11-11 L0-5 修正）**：范围=H0 可信起点——①state 两层语义显式化（串行槽位 work-package vs 常驻 living-plan + AUDIT-LOG 🔵 不同层注记 + truthDomain 冲突当场报警）②影响图重复 id fail-closed（block337 同名双条合并，规则 357→356）+ 未映射第一批消亡（C5-db-migration×4→electron-runtime、C9-g0-qualification×3→g0-baseline；145→138）③三段分片当次跑 + 逐件归因 ④canonical 对账（POST-NSO 蓝图→completed、post-S7 蓝图→active/living-plan、backlog 349–354、roadmap/handoff 恢复链、README 入口行补反引号） | 红线=零新增依赖/不动 10 项 untracked 用户资产/不放宽任何基线/不撤销既有用户裁决/未达证据不写 verified。plan=docs/block-385-post-s7-h0-trusted-start-plan.md | BLOCK-385 / COMPLETED |
| 🟡 | 2026-11-06 | **BLOCK-365 W1 接收在制批的处置注记**：用户授权接收会话起始在制批（22M+3 新测试；用户资产与临时目录、并发写入者 UI-696 批不在授权内）。首切片流程=逐文件审读→在制批自带测试+影响面测试→lint/types→model-surface 基线重打留因（993→1083，归因 system-prompt 用户优先级条款）→显式路径提交→P6 源绑定重算（观测数据原样保留）。授权范围为「提交这批既有工作」，不改变其中任何行为 | W1 主项随后：F-01/F-02/F-03/F-14/F-15/F-16 + SSE 收尾 |
| 🟡待环境 | 2026-10-20 | **本机 `bash` 解析到 WSL launcher（`C:\Users\Admin\AppData\Local\Microsoft\WindowsApps\bash.exe`）⇒ block67/block89 fs 测试整类误红**：`bash C:\...\x.sh` 被 WSL bash 读成 `C:UsersAdmin...`（反斜杠被吃），报 `No such file or directory`；与本批改动无关，**在 HEAD 同样复现**。规避=跑 `test:changed` / `closeout` 前把 Git Bash 前置：`$env:PATH="D:\Program Files\Git\bin;"+$env:PATH`（BLOCK-219 收口即用此法，Node 744 项 0 红）。根治=修正系统 PATH 顺序或测试改为显式 Git Bash 路径 ；**同一台机器的第二个坑**：`tar` 解析到 Windows bsdtar（不支持 `--force-local`），`capability-bundles` 等 5 项因此红——收口时 PATH 须同时前置 `D:\Program Files\Git\usr\bin`（GNU tar）与 `D:\Program Files\Git\bin`（bash，两处都要，缺一仍红） | 环境；不阻塞产品判据，但**会误伤任何一次 closeout**——修复前每次收口须前置 PATH 并在笔录里写明 |
| 🟡 | 2026-10-18 | **C-34（BLOCK-212 reopen）**：Claude 缓存断点方案成文——会话级固定工具集 + tools 末项断点 + ≥1024 才打点；验收需真实调用、风险=路由精度，**先决=G1+ 预算** | BLOCK-212 / reopen |
| --- | --- | --- | --- |
| 🟡建议 | 2026-10-01 | **BLOCK-128 实机验收抓真三条——①③已清偿（2026-10-05 BLOCK-141：①取消终态竞窗分类修复+③process_pid 核实 HTTP 链正常随①收敛），余②**：②**墙面板取消跨后端可达性未定**——Jobs Wall 取消钮 POST rApiBase（:53542 Electron 自spawn 后端），对 owner=:3001 的 job 15s 无效果；双后端脑裂家族（dev-infra §76 长期条款），durable flag 30s 慢路径被探针 fallback 掩蔽未能排除 | ②归属 dev 双后端结构性修复方向（dev-infra §76③ attach 机制），非产品缺陷；非阻塞（取消链本体 SIGTERM 击杀已实证） |
| 🟡延期 | 2026-08-03 | **G0-RS-P7 Honest Product Requalification。** 用户裁决发布级资格工作后移；Result Studio 保持 `implemented_unverified / experimental`，没有 canonical P7 PASS evidence | 重开前必须先解决 selection→enrichment 无 candidate/compare/lifecycle、existing Git consent UI、五条独立 task trace、双 Provider、packaged 六格与 literal OS reboot；历史 RS9、P4R/P6 开发态证据不得冒充资格 |
| 🟡待评估 | 2026-07-26 | **G0 `macos-arm64: qualified` 的视觉证据不成立。** `acceptance/g0-qualification/packaged-ui/` 5 张 PNG 只有 4 个唯一 sha256：`chat-summary-light-wide.png` 与 `restart-restored-light-wide.png` 逐字节相同（均为 `bb54acff…`），即「重启后恢复」证据是重启前截图的副本。`scripts/g0-qualification-visual.mjs:59-62` 只校验哈希格式/宽高/字节数，无唯一性断言；配套 `inspection.json` 为 811 字节九个人工布尔值，仓库内无任何写入者。该形态与 `core/shared-backend/result-studio-qualification.js:113-121` 判 RS9 non-qualifying 的理由（`inspection_booleans_are_human_assertions`）完全一致，但该理由未推及 G0 自身 | 仅登记事实。**不得**由 Agent 擅自变更 `core/shared-backend/g0/support-matrix.json` 的 `qualified` 状态或 `evidence-ledger.json` 的 `visual_state_convergence`——资格状态变更属用户决定。修补检查脚本（加 `distinctStates` 唯一性断言）会使当前 G0 门变红，需先获批。**2026-07-27 用户裁决：暂不发布，故本项降级为待评估、不阻塞开发。** 重开条件：任何对外发布、资格声明或 G0 重新资格之前必须先处理——发布时若仍以此证据支撑 `qualified`，即为不诚实声明 |
| 🟡建议 | 2026-07-17 | `capability-provisioning.js` 的下载实现与 plugin-manager 各自维护 | host 白名单已经修复；共享下载 helper 只在改动该能力时评估，不阻塞 RH0 |
| 🟡延期 | 2026-08-10 | **Windows 代码签名缺失（任务 #55）**：`electron-builder.yml` 仅 macOS 配置 afterSign，Windows 段无证书/签名配置；当前 Windows 安装包为未签名 NSIS（`dist/Petri Setup 0.0.1-rc.7.exe`）。未签名包在 Windows SmartScreen/Defender 下会触发未知发布者警告，属发布门禁缺口，非功能缺陷 | 阻塞于**代码签名证书**：需发布负责人提供 EV/标准代码签名证书并配置 `electron-builder.yml` win 段 afterSign/证书路径。证书到位前不得伪造 `release-contract.json` 的 windows-x64.supported 翻转——当前 `supported` 仍诚实保持 false（reason 已写明"制品存在且通过验证，仅缺签名/公证"）。用户裁决：标记 deferred，待证书到位再闭环 |
| 🟡延期 | 2026-08-10 | **i18n 资源抽离未做（任务 #91）**：全仓无 react-i18next/i18n 框架，用户可见字符串散落于组件（grep 命中多为 `Intl.`/locale 巧合，非 i18n 体系）。抽离需引入 i18n 框架、建立语言资源文件、改造所有文案调用点，属较大前端架构决策 | 阻塞于**产品/架构决策**：是否国际化、支持哪些语言、采用 react-i18next 还是自研轻量方案。决策前不强行抽离（避免半吊子框架增加维护成本）。用户裁决：标记 deferred，待产品明确国际化范围后再立项 |


> **本区段纪律（2026-09-13 清理确立）**：只保留**尚未处置**的条目：🔴 阻塞 / 🟢 建议 / 🟡 延期或待评估。
> 已收口条目（✅）**一律移入「最近处理记录」**，不得在本区段堆积——本次清理将 23 条已收口项迁出，
> 待处理项由 28 行降为 8 行（活跃项占比 100%）。新增 ✅ 项请直接追加到「最近处理记录」。
## 最近处理记录
| ✅ **BLOCK-446（凭据 file 后端加密化 + 错误语义分离）completed（用户裁决「好的 按照你的建议来」＝ Jev 单一建议发令；ZCode v3.18.2 systemCredentialCipher 借鉴落地）**：file 后端全写路径 encryptAll 落盘零明文（复用 mcp-env-crypto 单源 AES-256-GCM，密钥与 SETTINGS_DIR 同根）；读取明文透传 + 整组急切迁移（fail-open 不丢值）；损坏/不可读文件 fail-closed 拒覆写（防毁他 provider 密文）、remove 零触碰；值不可解诚实空串密文保留；status() 三态健康面。红绿先行 9/9（红跑 8/9 存档）；邻域回归绿（block414 环境条件红经 HEAD 换置复现=先于本包）；test:changed 1425/1435 三红均先于本包归因；docs 584/secret/arch/code-size/arch-cycles/types/knip 全 PASS；lint 改动文件 0 error 警告净收缩 4→3；closeout exit 1（第 4 门 ui-audit 被他方 172 文件 UI WIP 拦停，如实登记）；coverage 棘轮 90→89。keychain 后端零改动；原生 OS 凭据库/IPC 明文回传最小化=非范围。证据=acceptance/block-446/gate-evidence.json。G0 开发期常态 · 不外推 packaged/Provider/GA. | BLOCK-446 / COMPLETED |
| ✅ **BLOCK-445（通用 Agent 插件/技能兼容层）completed**：任意 Agent 插件与技能目录统一发现/投影，MCP App 页面宿主链路实测可用；真实 ZCode 插件试跑 + 离屏 Electron 验证；未覆盖项精确列明。证据=`acceptance/m-blueprint-2026-11-11/m6a/universal-plugin-compat.json`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-14 | BLOCK-445 / COMPLETED |
| ✅ **BLOCK-439 端到端核对补漏 + 台账补登记**：BLOCK-436 补建册注册；4 次后续提交头部补登记；B2 perf 内容指纹重打 / B3 测试凭据隔离 / B4 impact-map 补挂 4 文件 / B6 M0 owner 脚本入库；全量门禁与测试复跑后提交。证据见 `acceptance/m-blueprint-2026-11-11/m6a/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-12 | BLOCK-439 / COMPLETED |
| ✅ **BLOCK-437（拖入源范围门 + 真实栈实测）completed**：`fs/import-from` 源范围判定接线（越界/设备/相对/NUL/缺失全拒，realpath 防逃逸）；实测修正自己第一版的 realpath 归一 bug；体积棘轮下抽两个 helper（files.js 764→682，不改基线）；无窗后端冒烟 10 项全绿、`ddl FAILED=0`。HK-01 15/15。证据=`acceptance/m-blueprint-2026-11-11/m6a/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | BLOCK-437 / COMPLETED |
| ✅ **BLOCK-435（M6-A 结构单源第一刀）completed（S1/S2 done；S3 尝试后回退）**：三面共用 schema 门（566 条 + 漂移/缺陷棘轮，抓到 2 个真实缺陷并冻结）、静默 catch 基线 412→406、环消亡实现后被 D7 域中立棘轮拦下→原样回退（不改基线洗白）。HK-01 7/7、lint 0。证据=`acceptance/m-blueprint-2026-11-11/m6a/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | BLOCK-435 / COMPLETED |
| ✅ **BLOCK-434（M5-A · 判据层→生产路径接线收尾）completed（4 项 done / 3 项 done-partial）**：secret-scan 故障 fail-closed、全局 Origin 门、DDL 单一入口、zip 失败清理；HK-01 8/8、lint 0、arch/secret PASS、block67 拖出语义 9/9 回归；drag/MCP/帧导航补腿条件在册。证据=`acceptance/m-blueprint-2026-11-11/m5a/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | BLOCK-434 / COMPLETED |
| ✅ **第六轮 M0–M7 优化程序收口（BLOCK-426～433，程序终态 done-partial）**：八阶段单包串行各有 closeout 读数与六件套回写；82 件逐件终态零 in_progress；十一维第八列复评；长任务自证包；post-h9 契约 186/186、reconcile 0 issues。closeout:full 三连 exit 1 两红 W 归属如实登记，§8 第 3/5 条未达证据上限，不冒充全绿/verified。证据=`acceptance/m-blueprint-2026-11-11/m7/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | M-PROGRAM / DONE-PARTIAL |
| ✅ **BLOCK-432（第六轮 M6 · 工程债务与体验 A–F）completed（六组终态均 done-partial / W / U / E）**：六组组内串行只读视图，HK-01 9/9、专项门 0 issues、七门治理门全绿；零改写基线、零触碰在制 WIP、巨型文件 git diff 0 行；U/E/V/W 不代答交 M7。证据=`acceptance/m-blueprint-2026-11-11/m6/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | BLOCK-432 / COMPLETED |
| ✅ **BLOCK-431（第六轮 M5 · 安全与正确性纵深）completed（8 项判据层 done / 生产接线 done-partial）**：8 类判据收敛单一纯模块，HK-01 15/15、专项门 0 issues、lint/secret/arch 全绿；workspace_exec 默认放行裁决与既有裁决全部保持；生产接线归 M6-A/M6-C 带拆前拆后同套绿基线。证据=`acceptance/m-blueprint-2026-11-11/m5/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | BLOCK-431 / COMPLETED |
| ✅ **BLOCK-430（第六轮 M4 · 评测与可观测）completed（带 external-blocked / W / done-partial）**：1000 轮零出网 fixture + 基线（claimStableLongTask 恒 false）+ trace/usage 投影 + 性能门，HK-01 14/14、专项门 0 issues；evals run 红读数如实登记、gate 复用证据明确标注；evals-run 写盘副作用已自纠恢复 HEAD 版。证据=`acceptance/m-blueprint-2026-11-11/m4/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | BLOCK-430 / COMPLETED |
| ✅ **BLOCK-429（第六轮 M3 · 上下文与工具能力面）completed（带 1 项 done-partial）**：六项能力收敛单一纯模块，HK-01 18/18、专项门 0 issues、lint 0；needsApproval 首次真实消费；四表与 workspace_exec 默认放行零改动；生成器改造归 M6-A。证据=`acceptance/m-blueprint-2026-11-11/m3/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | BLOCK-429 / COMPLETED |
## 广播规则

- 🔴：阻塞当前验收，主 Agent 必须优先处理。
- 🟢：已有独立提交且可安全合并，主 Agent 必须先核对。
- 🟡：建议或待评估，不阻塞当前工作。
- 🔵：当前唯一进行中阶段。
- ✅ 完成事项只在“最近处理记录”保留一个紧凑条目；详细证据进入 canonical 计划、Acceptance 或归档。
- 不在本文件保存凭据、用户数据、绝对结果路径或隐藏推理过程。

- **滚动精简（自动化 v2 · BLOCK-170 用户裁决「需要有个更稳定且优秀的设计 靠手动来优化 AUDIT-LOG 是不合理的」；v1 基座 2026-09-20「仅保留必要的内容」）**：`npm run audit:compact` 幂等全量自稳——「最后更新」链只留最近 8 条（淘汰行原文入 `archive/checkpoints/audit-log-through-<日期>.md`）+ 处理记录表只留最新 10 条（淘汰行入 `audit-log-compact-<运行日>.md`）+「当前待处理项」与广播规则全量保留；**搬移不改写**（台账原文永不被工具截断/改写，超长行的收敛责任在写入方，docs:check 出建议级提示）。接线=`closeout` 首步自动执行，无需记得手动跑；`docs:check` 对本台 >50KB 出建议级提示、>120KB（单读工具安全阈）硬红（AUDIT_LOG_OVERSIZE）。归档剪行后必须跑 `npm run docs:check`：凡 registry `entrypoint` 指向本台的 canonical 文档，其直链必须常驻头部「入口直链」行，不得只随旧记录进归档。
- **行写入纪律**：处理记录每行 ≤ 3 行（约 600 字符）：一句话结论 + 用户裁决原话/关键数字 + canonical 文档指针；阶段切片与长篇证据进工作包 plan/closeout 文档；「最后更新」行只描述最近一次更新，旧累积随归档走，不在行尾追加历史条目。

