---
capability: coding-harness-ui
goal: 用户在 Petri 工作台里用一句自然语言驱动 agent 完成一次真实的通用编码任务（改代码→跑验证→审阅→提交），全链路无断点、反馈完整
acceptance:
  - P0 缺口清单落盘（六环节走查证据 acceptance/block-123/）
  - 后续缺口项逐项 UI-### 登记串行清偿
reopen: 方向裁决回摆生信旗舰倾斜时本主线让位（参照 product-strategy-review-2026-09 §4）
status: completed
---

# BLOCK-123 — 通用编码 harness 使用界面主线（P0 端到端任务对账）

> 立项：2026-09-26（P0-LAUNCH；用户裁决「你来定」授权，方向裁决原话见 §1）→ **2026-09-26 当日整包 completed（P0+P1 三轮走查；closeout 十二门绿）**。
> 能力：`coding-harness-ui`（capability front-matter 已带）。
> 阶段定位：G0 开发期 · 产品主线（方向裁决收口 product-strategy-review-2026-09 §6 观察期约定）。

## 1. 一句话目标与方向来源

用户在 Petri 工作台里，用一句自然语言让 agent 完成一次**真实的通用编码任务**——改代码、跑验证、审阅 diff、提交——全链路无断点、每个环节有反馈。

方向裁决（2026-09-26，用户原话）：「我觉得不行 这个属于垂直领域的扩展 现在需要的仍旧是通用编码harness使用界面作为开发主要工作项 重新思考」+ 委派「你来定」。该裁决收口 `product-strategy-review-2026-09.md` §6 观察期约定（2026-09-03 方向开放 → 通用编码面为开发主线）；§7「底座别再加厚」重新解释=不加厚底座机制（chat/流式/loop 红海标配），加厚的正是**使用界面**。

## 2. 范围与非目标

**范围内**：通用编码任务全链路的使用体验——指令理解、文件读写、命令执行、验证反馈、diff 审阅、提交。
**明确不做（反目标）**：
- 不预设架构手术（存量四件套 UI 是对账对象不是推倒对象）；
- 红海标配面（chat UI/流式输出/agent loop）不加厚；
- 垂直生信域不回摊（转候选池 C-15，重开条件在案）；
- 参数确认卡等已被裁决取消的形态不复活（AGENT-WORKBENCH 修订 2：agent 主导）。

## 3. 存量资产盘点（2026-09-26 勘察，防重复开发）

- **工具面**：workspace_list/find/search/read/**write/replace**（编辑）+ **workspace_exec/exec_background**（命令执行）+ process_status/stop + system_info + todo_write + plan（多步计划）+ verify_state——通用编码工具链**清单层面完备**。
- **UI 面**：工作台四件套俱全——RightFileTree + 文件标签页（useWorkspaceFileTabs）+ TerminalPanel + RightPanel 审阅 tab（WorkingTreeReview/ReviewMode 1310 行 verified，projectId 感知，accept/reject/revertFile IPC 全链）；SimpleChat（plan 审批流 usePlanApprovalFlow、steering、工具活动条）。
- **结论**：缺口不在清单，在**体验闭环**——工具齐但串联体验未经验证，这正是 P0 要用真实任务走出来的。

## 4. 阶段划分

| 阶段 | 内容 | 出口 |
| --- | --- | --- |
| P0（本阶段） | **端到端任务对账**：dev 栈测试实例上跑一个真实通用编码任务，六环节逐项记录断点/缺工具/缺反馈 → 缺口清单落盘 | 走查证据 acceptance/block-123/ + 缺口清单入本 plan §5 |
| P1..Pn | 缺口逐项串行清偿（AGENT-WORKBENCH 修订 3 同款：每项启动前先对照当前代码对账是否已被覆盖） | 每项独立 UI-### 登记 + 实机证据 |

**P1 进展（2026-09-26）**：**G-01 已清偿（UI-446，in_progress 待实机过目）**——对账先行抓真：聊天区改动卡片系 2026-09-09 用户裁决移除（c0e92dd0），不复活；形态收窄为**审阅 tab 未读圆点**（当前会话有未看工作区改动时药丸亮 `--petri-accent` 圆点，激活审阅 tab 即 acknowledge 熄灭，新改动复亮）。实现=conversationChangesStore 未读判定面（单调时间戳防同毫秒竞态）+TitleBarTab.dot+titlebar 组装+药丸渲染；红绿先行（store 未读测试+RightZone 渲染测试先落 6 红→15/15 绿）；tsc 0+theme 契约 4/4+quality:lint 0 error。

**整包收口（2026-09-26）**：P0 六环节零断点 + P1 三轮走查四形态闭环（单文件修 bug / 需求在测试+错误 runner 自纠 / 跨文件 TTL 改造带防作弊复核）+ 缺口清单全清（G-01 清偿=UI-446 / G-02 销号 / G-03 清偿 30 条 / G-04 续观非阻塞）。closeout 十二门绿。**riders 全清**：UI-446 已 verified（用户实机复测通过，含 v4 计数徽章与 v5 0 态修复）；第三轮走查形态（reject→agent 调整回路/终端反馈面）转候选，按真实使用反馈择优。

**P0 六环节走查协议**（探针 `scripts/block123-p0-coding-walkthrough.mjs`，复用 block121 flow 驱动姿势：真实 chat + context.accessMode='full' + 测试实例 CDP）：

1. **S1 播种**：临时项目 + 植入带 bug 的小脚本与测试文件（git init，供审阅环节 diff）；
2. **S2 指令**：真实 chat 下达修复任务（「修掉 utils.js 的 bug：divide(1,0) 应抛错而非返回 Infinity；改完跑 `node utils.test.js` 验证并报告结果」）；
3. **S3 读取与编辑**：观察 agent 是否用 workspace_read → workspace_replace/write（SSE 事件流取证工具调用序列）；
4. **S4 执行验证**：是否调 workspace_exec 跑测试、结果是否真实回传并进入回答；
5. **S5 反馈面**：CDP 实机——文件树/标签页是否反映变更、审阅 tab 是否出现该项目的 diff、chat 回答是否引用真实执行输出；
6. **S6 审阅与提交**：审阅 tab 能否看到该变更并可 accept/commit（能走通走到哪一步，断点如实记录）。

每环节记录三类判定：**通（有证据）/ 涩（能走但反馈弱或绕路，记具体表现）/ 断（走不通，记报错与现场）**。产出=缺口清单（编号 G-01..），每条带 file:line 或截图证据指针。

## 5. P0 缺口清单（2026-09-26 走查回填）

**总体结论：六环节全部走通，零断点。** 真实模型（测试实例供给 DeepSeek/deepseek-flash，完全访问）**12 秒**完成「修 bug→跑测试」任务；工具序列教科书级（`workspace_list → find → read → read → replace → read → exec`）；盘面真修复（探针独立复跑 `node utils.test.js` 通过）；审阅面完整——改动/历史双 tab、逐文件 diff 渲染（+1/−1 与变更行原文）、接受/拒绝、未跟踪文件识别、全部还原、提交审阅、`0/2 已审` 进度（acceptance/block-123/p0-review-innertext.txt 取证）。

| 编号 | 判定 | 缺口 | 证据 | 处置 |
| --- | --- | --- | --- | --- |
| G-01 | 涩 | **审阅不主动浮现**：agent 完成编辑后，默认视图无「有 N 处变更待审阅」类引导，用户需自行发现右侧「审阅」tab——审阅面完整但发现靠用户（walkthrough S5 `changedHint=null` 佐证） | p0-walkthrough.json S5 + p0-review-innertext.txt | **已清偿（UI-446，2026-09-26）**：审阅 tab 未读圆点（对账收窄不复活被裁决移除的卡片，见台账）；待实机过目 |
| G-02 | 观察项 | 工作台默认视图 DOM 未命中终端 tab（`terminalTab=false`）——终端面板可能懒渲染或入口在别处，未人工核对 | p0-workspace-innertext.txt | **销号（2026-09-26 非缺口）**：终端是默认收起的底部 dock（`bottomTerminalOpen` 缺省 false，Ctrl+`/顶栏开关），走查任务走 `workspace_exec`（输出进工具行）本不需要可见终端——设计如此非缺陷 |
| G-03 | 观察项 | 测试实例左栏历史会话残留堆积（UI444/UI442 取证、LIVE-VERIFY 等十余条）——测试 userData 会话历史无清理机制；主实例不受影响 | p0-review-innertext.txt 左栏 | **已清偿（2026-09-26）**：`scripts/test-session-cleanup.mjs`（模式匹配只删测试命名、默认干跑、逐项目+全局双扫+项目本体收敛）+契约 test/test-session-cleanup.test.mjs 防误伤；实跑两轮清 30 条（21+9）至 0 命中，项目 22→10 |

探针侧瑕疵（非产品缺口，如实登记）：`screenshotPng` 签名误用致两张截图落成空目录（正确签名=三参 `(client, dir, filename)`，探针代码已修正）；「审阅」文本存在歧义元素（探针首击命中 `_emptyResultLaunchCard` 类按钮），最终以 tab 激活后 innerText 取证为准。

### 缺口清单 v2（P1 第二轮走查回填，2026-09-26：错误恢复 + 多文件形态）

探针 `scripts/block123-p1-walkthrough-2.mjs`；证据 p1-scenario-{a,b}-events.json + p1-walkthrough-2.json。

- **正面实证（错误恢复）**：场景 A 双重障碍下 agent 完成恢复循环——需求藏在测试断言里（+86 前缀，指令不写）+ 指令带了不存在的 runner 名。实际序列 4 次 exec：基线跑败 → 修复 → 撞 MODULE_NOT_FOUND（我的错误指令）→ **自纠跑对 `phone.test.js` ALL PASS** → 一次字面重试后收敛。恢复能力真实在位。
- **正面实证（多文件行为级验证）**：场景 B「硬编码重试改读 config.json（缺省回退 3）」终态测试通过（行为级：改 config 生效+缺省回退双断言）。
- **G-04（涩，观察）→ 已根治（2026-09-26 轻量批，用户菜单裁决「exec 错误反馈增形」）**：指令与环境不一致时（不存在的 runner 名）agent 收敛前多绕一次字面重试（exec#4）——根修=workspace_exec 命令不存在时附 `commandNotFoundHint`（npm scripts/测试文件/常见 runner 有界候选）+note 指路（locale 无关确定性判定，Windows GBK 文案实测抓真）；契约 4/4 + 实机走查 allPass（acceptance/block-124/g04-live.json），本行「续观」终结。
- **G-05（观察）**：多文件形态本轮仅轻覆盖（单文件编辑+跨文件读 config；git 仅 1 文件变更）——真正的多文件并行改造任务走查待后续轮次。
- **方法学记录**：B4 圆点探针「未亮」系方法学限制非产品缺陷——REST 驱动的任务不经 UI 流（前端改动索引按构造不记录），且审阅 tab 未打开时无药丸可挂点；UI-446 实机验证以用户真实 UI 路径为准（走查姿势不变）。

### 缺口清单 v2 补充（G-05 多文件深度走查，2026-09-26）

探针 `scripts/block123-p1-walkthrough-3.mjs`（带**防作弊验证器**：探针自持原始 runner 副本复核，agent 弱化断言/改测试即现形）。

- **G-05 已清偿（通）**：真·跨文件任务「KV store 加 TTL 过期 + api 会话缓存接入（1s TTL，缺省回退）」，需求全藏预置测试里。**24 秒完成**：先 5 连读（store/api/两测试/runner 全读完才动手）→ exec 红 → 改 store.mjs+api.mjs → **原始 runner 复跑 ALL PASS（断言零弱化、run-tests.mjs 未触碰）**。变更 3 文件（store.mjs/api.mjs + 探针自置 verify-runner.mjs）。
- **累计走查结论（P0 六环节 + 错误恢复 + 多文件三轮）**：通用编码 harness 在「单文件修 bug、需求在测试、错误 runner 自纠、跨文件 TTL 改造」四种形态下全部闭环，未发现断点级缺口；观察项 G-04（字面重试绕路）续观。

## 6. 边界与风险

- 测试实例隔离（start-test-instance.sh），不污染用户实例；临时项目 A6 清理必达（block121 同款 cleanup 链）。
- 并行会话：UI-44x 会话曾在本机活动——本包触达面=工作台 UI + agent-tools workspace/session 域，提交前照常核对 git status，不碰他包 WIP。
- G0 开发期常态 · 不外推 packaged/Provider/GA；单工作包串行纪律不变。
