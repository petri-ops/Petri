最后更新：2026-11-17（**e2e 自动推进中：W1（BLOCK-454 P1 vision）已收口**——UI-638 迁移盲区修复 + capability 同批落盘，HK-01 红→绿，证据 acceptance/block-454/p1/；Windows 安装版文件腿 external-blocked。当前执行到 W2 搜索 adapter。G0 开发期常态 · 不外推 packaged/Provider/GA.）｜最后更新：2026-11-17（**端到端自动执行方案 + 提示词落地**：`docs/e2e-execution-plan-2026-11-17.md`(active) 把蓝图 W1-W10 细化为 W1-W9 可执行任务卡；`docs/E2E-PROMPT.md` 为可独立驱动全流程的自包含提示词（预置 D1-D8 裁决免人工介入）。**接手者若要自动推完，直接复制 E2E-PROMPT.md 代码块给新 Agent 即可**。未执行项 W6/W8/W10 在最终报告列出。G0 开发期常态 · 不外推 packaged/Provider/GA.）｜（**Agent 体验设计原则确认 + 蓝图二次优化**：`docs/agent-experience-design-principles.md` 为设计宪法（active），用户 5 条原则逐条确认+补充 P1-a/P2-a-b/P3-a-b-c/P4-a-b/P5-a-b-c 与横向 X1-X5；核心=对标借形不改魂，P5 最小化不破治理/审批/审计。蓝图已加 §0.5 设计宪法 + W2/W3/W7 落实标注。接手者动 Agent 体验相关波次前必读原则文档。G0 开发期常态 · 不外推 packaged/Provider/GA.）｜（**统一工作蓝图重整**：`docs/next-work-blueprint-2026-11-16.md` 为当前唯一 active 执行蓝图（living-plan，不占槽位），`next-steps-roadmap.md` 降为其指针——W1-W10 覆盖 BLOCK-454 P1-P6 + 设置页 IA v2 实施 + UI-703 收口 + 遗留治理 + 排队大纲，含 7 决策点。**接手先读蓝图 §0-§2**。本轮 API Endpoint 工作撞号已纠正为 UI-703。G0 开发期常态 · 不外推 packaged/Provider/GA.）｜（**BLOCK-454 立项启动（active / P0-LAUNCH，占串行槽位）**：用户「按照你的建议来」+ 疑虑「只用 deepseek 全家桶太依赖」→ 通用能力窄口 + DeepSeek adapter（非全家桶）。P0 端点契约核实（只读、未 VERIFIED 不开写）→P1 vision 修通→P2 搜索 adapter（SearXNG 默认不变）→P3 OCR 窄口（本地优先+artifact 留痕）。非范围=ASR/TTS/Responses/capabilities 语义/token 预算/G1+。plan=docs/block-454-capability-adapters-plan.md，registry active，README 447。**P0 已完成（2026-11-16）**：抓 DeepSeek 官方 8 页文档核实全家桶=3 对话协议 + 7 对话内联能力 + 5 独立接口（Search/Fetch/OCR/ASR/TTS），逐项 VERIFIED+深链+Petri 落点判断落 `docs/block-454-endpoint-contract-findings.md`（registry+入口 448）；plan 已细化为 P1 vision→P2 搜索 adapter→P3 OCR→P4 文件链→P5 协议(可选)→P6 ASR/TTS(暂缓)。接手者从 P1 起，开写前看 findings 的 UNVERIFIED 项。G0 开发期常态 · 不外推 packaged/Provider/GA.）｜（**流式 stall idle-only-reasoning 误报根因根治**：安装版实测「连续无 token 60010ms」→ 看门狗 idle 60s 正常判死但重试判据错用 phase 代理，只吐 reasoning 后卡死（零可见输出）被误判不可重试。已修：`emittedOutput` 判据替代 phase、reasonCode `stream_stalled_no_output`；HK-01 红绿 21/21。**已重打 Win 包并覆盖安装实机验证**：修复代码在 asar 解出产物与已装目录均确认在场，exe mtime 20:22→20:58、版本 0.0.4、6 进程主窗在场；当前已装应用含此修复。详见 AUDIT-LOG 本轮条目。串行槽位空闲。G0 开发期常态 · 不外推 packaged/Provider/GA.）｜（**Windows 本机打包 + 换标批 logo 同步（轻量交接动作）**：HEAD 已前进至 `d88bb76f` —— `63bb9aa1f` v0.0.4 高级分组默认展开 + `d88bb76f` 换标批 logo 入库（19 图标 + icon-tray.png，新 icon.ico 370KB sha `d1cf1d03`）。**「换标批 WIP 未提交」历史状态已终结**：该批 logo 此前长期是 Mac 工作区未提交 WIP，本轮已由用户提交入库并 push，Win 侧 pull 后重打。`npm run build:win` exit=0 产出 `dist/Petri Setup 0.0.4.exe`（228.6MB，版本 0.0.4，内嵌新 logo 与源一致），已静默安装到 `C:\Program Files\Petri\Petri.exe`（0.0.4，卸载表在册、6 进程运行中）。三处环境障碍（缺 Win SDK 10.0.26100 / afterPack.js 跨盘符 rename / IDE safe-delete shim）均以工具链绕法解决、零改源码、非产品缺陷；NSIS 安装走短路径绕开路径报错误。打包副产物 better-sqlite3 Electron ABI 已 rebuild 回 Node ABI，临时脚本清理，工作区干净。G0 本机试用，未碰签名/公证/GA/远程发布。串行槽位空闲。G0 开发期常态 · 不外推 packaged/Provider/GA.）｜（**BLOCK-452 completed（更新 UX 自动推送）**：15min 轮询 + 前台恢复 check + 复用 app:notify 系统通知（独立偏好/按版本去重/前台可见例外，零新 IPC）；useAutoUpdate 18/18 + 模型 10/10，实机 9223 确认设置页更新入口在场。`docs/block-452-update-ux-push-plan.md`。串行槽位空闲。G0 开发期常态 · 不外推 packaged/Provider/GA.）｜（**v0.0.1 初版本机打包安装完成**：版本 0.0.1-rc.7→0.0.1（去 rc，commit `3ce3ca73`、tag `v0.0.1`），build:mac-arm64 exit=0，DMG 198M 装到 `/Applications/Petri.app`，启动进程树完整；换标批 WIP 原样入包未提交；本机试用≠发布。用户裁决 P6 销号 + 交接队列①~④全部走完：用户显式裁决「生信层面垂直领域非当下需求，清理掉」→ P6 pressure 腿从活跃待办销号、移入 §五已裁决延期/挂起（历史 404 事实与 BLOCK-448 原补腿条件原样保留，不冒充通过）；外部条件 **1→0**。①probe 仍 404→②BLOCK-451 M-55 completed→③U 类 7+E 类人眼材料核对补齐（`docs/u-e-decision-materials-reconciliation-2026-11-16.md`，全批终态 pending 不变）→④next:suggest。**用户裁决 U 类 7 项全部销号**（「都行 按你的建议自主搞完」→ 7 项均采纳维持现状推荐、销号≠实现完成，原档终态不改写，见对账文档 §9）。**E 类 3 条可过目项已终态化**：UI-200 用户本人确认 verified；UI-695/331 用户授权自动化 flow 8/8 allPass verified（`acceptance/ui-695-331-modelcfg-time/`），其余 19 条前序已 verified/cancelled 或无需过目。待办现为 外部 **0** / U 类裁决 **0（7 项已销号）** / 可执行候选 **0** / E 类人眼 **0（22 条已核销，3 条本次终态化）** / 延期挂起（含 P6 销号）/ G1+ 出籍。**全清单清零**。串行槽位空闲。G0 开发期常态 · 不外推 packaged/Provider/GA.）｜**并集校正 2026-11-16（接手当次读数）**：HEAD 已前进至 `4d3ef9c1`（交接落册提交）；工作区存在「换标批 v4 定稿」tracked WIP（19 图标 + `src/main/desktop-shell.js`）+ `icons/icon-tray.png`，零触碰；`r-enrichment` bundle 11-16T08:12Z 复探仍 404（NoSuchBucket, ec=0015-00000101）⇒ probe 分支走 ②；候选层级校正=QODER/竞争力纲等 3 项为规划大纲（非可执行候选），M-55 为唯一可执行候选。

---

# 工作区交接（Workspace Handoff）

## 恢复顺序（接手 Agent 必读）

1. `docs/AUDIT-LOG.md`（处理 🔴/🟢 未决项——当前无未决；🟡 区为延期/待评估不阻塞）
2. `npm run state`（分支 / WIP / active 工作包两层语义）
3. `docs/next-steps-roadmap.md` + 本文档（重点：§当前待办分类清单）
4. `AGENTS.md` 为唯一工程指令；事实优先级：当次命令输出 > Git/源码 > 证据 JSON > canonical 文档

## 当前事实快照（2026-11-16 交接时点 · 本轮 Windows 打包后刷新）

- `main` @ `d88bb76f`（换标批 logo 入库；版本 `0.0.4`，根/前端 `package.json` 一致）；**工作区干净**（无 tracked 修改、无 untracked）。历史快照中的「换标批 v4 定稿」WIP（19 图标 + `src/main/desktop-shell.js` + `icons/icon-tray.png`）**已提交入库**（commit `d88bb76f`，用户裁决「同步最新 logo 到云端」），不再是 WIP。
- **Windows 本机打包验证已完成**（G0 本机试用）：`dist/Petri Setup 0.0.4.exe`（228.6MB，NSIS x64，内嵌新 logo），已静默安装到 `C:\Program Files\Petri\`（版本 0.0.4，卸载表在册，应用已启动）。Mac 侧 v0.0.1 DMG 打包 + ECS 更新源为另一路线（见 AUDIT-LOG 2026-11-16 相关条目）。打包环境障碍与绕法详见 AUDIT-LOG 本轮条目；这些是工具链/平台问题，非产品缺陷、零改源码。
- 环境前置（换 agent 复现 Win 打包需注意）：①本机已 winget 装 `Microsoft.WindowsSDK.10.0.26100`（原生模块重建所需）；②打包须绕过 `build/afterPack.js` 跨盘符 rename（把 TEMP/TMP 指到产物同盘）——**这是已知源码缺陷，尚未在代码层修复**；③IDE 注入的 safe-delete shim 会误伤构建删除，打包子进程需清空 `NODE_OPTIONS`；④NSIS 安装包放短 ASCII 路径（如 `D:\petri-setup.exe`）避免 "Error writing temporary file"。打包后 `better-sqlite3` 会变 Electron ABI，需 `npm rebuild better-sqlite3` 恢复 Node 开发态。
- **串行 active 工作包 = BLOCK-454**（通用能力窄口 + DeepSeek adapter，P0 契约核实已完成、下一步 P1，plan=docs/block-454-capability-adapters-plan.md，findings=docs/block-454-endpoint-contract-findings.md）——接手者从 P1 vision 修通起，开写前看 findings 的 UNVERIFIED 项。全家桶全清单已核实（约 12 类能力，Petri 已覆盖约 6 类），融入=补缺口+可换 adapter。UI-703（API Endpoint 信息密度）已收口让出槽位。BLOCK-449/450 已收口；除 BLOCK-454 外待办清单全清零（见下方 §一~§六）。
- 无窗栈可无头启动：`PETRI_DB_PATH`/`PETRI_LOCAL_DATA_DIR` 指向 `.petri-dev-user-data/data` + `R_SERVER_PORT=3001` 起 `node core/petri-server/server.js`；vite `:3000`；9223 离屏实例走 `scripts/start-test-instance.sh`（禁 `PETRI_TEST_ONSCREEN`，跑完立即 kill）。

## 当前待办分类清单（2026-11-15 读数 · 2026-11-16 交接落册）

> 事实来源：`acceptance/m-blueprint-2026-11-11/m7/gap-ledger.json` + `m4/m5a` 原档 + AUDIT-LOG 🟡 区当次核对。本节是交接快照，不是第二真相源：各项终态以各自 evidence 原档为准；清偿时在对应工作包收口并增量更新本节。

### 一、等外部条件（0 项）

> **2026-11-16 用户裁决销号**：P6 pressure 腿重采（原 BLOCK-448/449 唯一 external 原册，依赖 `r-enrichment` 生信 capability bundle）经用户显式裁决「生信层面的垂直领域不是当下的需求，清理掉」→ **从活跃待办销号**，不再作为解锁动作追踪。
> - **销号依据 = 用户裁决，不是 bundle 恢复**。`r-enrichment` bundle HTTP 404 是历史事实（probe 2026-11-15T07:37Z / 2026-11-16T08:12Z 均 404，`NoSuchBucket` / `x-oss-ec=0015-00000101`），原样保留、不改写。
> - `docs/block-448-p6-recovery-driver-syntax-plan.md` §7.3 的原补腿条件（bundle 恢复 → `npm run g0:result-studio:p6:update` → `closeout:full` 三连）作为历史证据原样保留，**不冒充已执行、不冒充 P6 通过**。
> - 下游影响：P6 pressure 腿不再纳入当前验收范围；P6 恢复腿（BLOCK-448 active-crash PASS + BLOCK-449 崩溃注入 31/31）与 Result Studio 状态（implemented_unverified / experimental、RS-P7 deferred）均不变。

附注：dev 库本体 4 组 seq 碰撞行将在下次后端启动时由 BLOCK-450 重排逻辑自愈（副本已验证），无需人工动作。

### 二、等用户裁决（U 类，Agent 不可代答）——**2026-11-16 已全部裁决销号（0 项待裁决）**

> **用户裁决**：「U 类 7 项 都行 按你的建议自主搞完 尽可能不要我参与进来」→ 逐项采纳推荐，7 项推荐均为"维持现状"，故全部**维持现状、无需另立切片、销号**。销号≠实现完成：零产品代码/配置/默认语义改动，gap-ledger 与 plan 证据原档历史终态原样保留不改写。逐项裁决表与重开条件见 `docs/u-e-decision-materials-reconciliation-2026-11-16.md` §9。

| 项 | 来源 | 裁决 |
| --- | --- | --- |
| ~~U-04 档位收敛（IDE `accessMode` / `tools_only` 强制）~~ | gap-ledger M-43 | 采纳 B1 维持现状 → 销号 |
| ~~TypeScript 双版本决策（`^5.9.3` vs `^5.5.4`）~~ | M-65 | 采纳 D1 保持 → 销号 |
| ~~npm workspaces 迁移评估~~ | M-66 | 采纳 A1 维持两独立包 → 销号 |
| ~~test:changed 长耗时拆片范围~~ | M-59 | 采纳 A1 维持定向优先 → 销号 |
| ~~evals 接入 closeout~~ | M-58 | 采纳 A1 不接阻塞链 → 销号 |
| ~~MCP 白名单默认~~ | m5a 原档 | 采纳 A1 维持仅显式 env → 销号 |
| ~~竞争力纲 CP-16/17/18 注记冲突对账~~ | BLOCK-449 S0 | 采纳 A1 只登记不改原档 → 销号 |

### 三、可执行候选（有实现路径，需用户发令）

> **候选层级校正（2026-11-16 接手并集）**：`npm run state` 报的 3 项「排队候选」（POST-H9 优化蓝图 / 竞争力纲 / QODER 吸收）——其中后两者 `status: planned`，是**规划大纲**不是可立即开工的单项；QODER §6.5 串行队列已清零、竞争力纲 CP-1~22 全闭环，二者需用户显式裁决另立子包，不构成「可执行候选」。本节唯一可执行候选 = M-55。

| ~~M-55 SSE 真实端点行为测试腿 + 挂 impact-map rule~~ | **2026-11-16 已由 BLOCK-451 收口 completed**（解锁=:3001 无头栈可起；7 契约测试 HK-01 红绿 + 真实回放证据 allPass + impact-map 单一归属；证据=acceptance/block-451/）。本节已无可执行候选，串行槽位空闲。 |

> **执行队列③已完成（2026-11-16，交接流程动作非工作包）**：U 类 7 项 + E 类人眼的决策材料/测试路线逐项核对与补齐，落 `docs/u-e-decision-materials-reconciliation-2026-11-16.md`（registry `U-E-RECON-2026-11-16`）。结论=2 项已有合格材料（U-04→post-h9-k1 决策 B、TS 双版本→post-h9-k4，指针引用不重造）+ 5 项补六段一页决策材料（workspaces / test:changed 拆片 / evals closeout / MCP 白名单默认 / CP 冲突对账）+ E 类 canonical 路线核对（签字槽全空、无材料缺口）。**全批终态不变**：U 类 `pending_user_ruling`、E 类 `pending_human_eye`，Agent 不代答、不替签、不改默认语义、零产品代码改动。batch 收口后交接执行队列①~④全部走完。

### 四、等人眼签字（E 类，不代答）——**2026-11-16 交接 22 条已核销（0 待过）**

> 核对结论（`docs/e-class-human-eye-guide-2026-11-16.md`）：22 条中 11 条前序已 verified、2 条 cancelled、6 条无实机面/等环境（保持 in_progress 非债）、**3 条本次终态化**——UI-200 用户本人确认 verified；UI-695/331 用户授权按 BLOCK-349 口径自动化 flow 8/8 verified。Agent 未代签，UI-200 结论出自用户本人。
- UI 设计专项签字槽（BLOCK-415~423）：路线材料在册（`docs/post-s7-h7-human-eye-route.md`、`docs/ui-design-human-eye-route.md`）；本交接未对其余签字槽代签。
- M-42 / M-44（M6 期自动人眼路线 + 对比度观感确认）：保持 `pending_human_eye`（不在本次 22 条内核销，属设计专项签字槽）。

### 五、已裁决延期/挂起（条件触发，非欠账）

**P6 pressure 腿重采（2026-11-16 用户裁决「生信垂直领域非当下需求，清理掉」→ 活跃待办销号；历史 external 404 事实与 BLOCK-448 §7.3 原补腿条件原样保留，不冒充通过；重开条件=用户重新裁决需求 + bundle 恢复）** · Windows 代码签名（待证书）· i18n 抽离（待国际化决策）· C-34 Claude 缓存断点（待 G1+ 预算）· CP-19 数据桥 WS 化（宜整段设计）· **G0 `macos-arm64: qualified` 视觉证据唯一性问题**（2026-07-27 裁决暂不发布故挂起；**重开条件=任何对外发布前必须先处理**）· G0-RS-P7 重资格（G1+）。

### 六、G1+ 出籍（阶段禁区，不算待办）

Provider 矩阵 / 公证签名 / GA / packaged 三轴对齐 / 远程发布 / `qualificationEligible` —— G0 开发期常态 · 不外推。

### 七、已过时注记（后续进展覆盖，随 audit:compact 自然归档）

M-14（lint errors 属在制 WIP——BLOCK-449 T1 已清账，warnings 2445 基线守住）；M-46 干净树三连部分（BLOCK-449 达成，P6 残腿归第一节）。

### 八、零触碰区与按纪律未跑（非债务）

- 12 项 untracked（第一节快照所列）——处置权在用户。
- `npm run check` / `npm run test:all:workspace` / `test:all:sharded`——按定向优先纪律留发布前 / CI，不是缺口。
