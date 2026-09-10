# BLOCK-77 — 长任务驻留与回访通知：挂机跑、回来接上、完成告诉你

> 状态：`active`（2026-09-10 用户裁决「来搞」启动，P0-LAUNCH；同日立项）
> 立项日期：2026-09-10
> truthDomain: `block-77-resident-tasks`
> 来源：用户在 BLOCK-67 收口后提出「agent 驻留服务器持续干活」需求，主 Agent 给出三档方案，用户裁决「要做到第二档」

## 1. 用户裁决

- 「agent 驻留服务器持续干活 这个如果要实现怎么做呢」→ 主 Agent 给出三档：①任务驻留 + agent 回访制；②①+ 完成通知出（接 BLOCK-70 移动端通道）；③真·驻留 agent（LLM 上服务器，需密钥与审批专项评审）。
- 用户裁决：「第二档 我觉得要做到第二档」（2026-09-10）——即①全量 + ②完成通知（通知渠道的移动推送部分与 BLOCK-70 联动）。

## 2. 现状与缺口

已有（可直接复用）：
- `exec_background` / `process_status` / `process_stop` 已远程化（BLOCK-67 P2）——任务可脱离软件独立跑在服务器，日志留服务器；
- proactive 事件与任务条投影（BLOCK-49/65）——子任务状态变化的 UI 通知面；
- `projectWorkspaceChanged` 事件——文件变更的刷新联动。

缺口（本包补齐）：
1. **没人盯**：长任务挂了/卡了无人知晓；
2. **没人续**：agent 循环在本地，软件一关 agent 就停，回来后没有「交接班」机制；
3. **没人报**：任务完成不会通知用户。

## 3. 范围（四件事）

- **①任务意图卡**：agent 接长任务时，在项目内持久化一张意图卡（干什么 / 成功标准 / 失败处置 / 关联的后台进程 id 与日志路径）——它是跨会话的「交接班凭据」。
- **②回访循环**：软件运行期间，本地按节奏（默认 60s，可配）检查驻留任务状态；异常（退出码非零/卡死/日志停止增长）→ proactive 事件提醒 + agent 可被追问分析原因。
- **③交接班**：软件重新打开后，agent 会话自动获得「未完成任务 + 意图卡 + 最后状态」上下文，主动向用户汇报进度与下一步建议（复用 BLOCK-49 proactive 投影 + BLOCK-67 远程进程查询）。
- **④完成通知**：任务结束 → 应用内通知（必做）；移动推送走 BLOCK-70 的移动页面/隧道通道（联动阶段，BLOCK-70 未启动前先落「服务器状态文件 + 应用内通知」层）。

## 4. 非范围（exclusions）

- 不做③档真·驻留 agent（LLM 运行时上服务器）——涉及 API Key 上服务器与自主审批边界，需单独立项 + 专项 P0 评审。
- 不做 LLM API Key 存储到服务器。
- 不做 R 包环境同步（BLOCK-76 域，另议）。
- 不承诺移动推送的具体交付日期（依赖 BLOCK-70 启动）。

## 5. 关键设计裁决（⏳ 待 P0 评审确认）

- **D1 意图卡形态**：项目内文件（如 `.gewu/resident/<taskId>.json`：task/成功标准/backprocess id/log 路径/创建时间/状态机）vs DB 表——倾向文件（服务器可直读、随项目走、符合「远程真值」），P0 定。
- **D2 回访节奏**：本地定时检查（默认 60s，仅软件运行期；可按任务配）；不做服务器端常驻看门狗（那是③档范畴）。
- **D3 通知渠道分层**：应用内 toast/任务条（必做）→ 移动推送（BLOCK-70 联动，接口预留）。
- **D4 驻留任务生命周期**：created → running → completed | failed | abandoned（连续 N 次回访无进展且进程死）；abandoned 需用户确认后清理。
- **D5 安全边界**：回访循环只读状态 + 建议性提醒，**不自动重启失败任务**（自动续跑属③档自主范畴）；kill/重跑始终需用户确认。

## 6. 阶段划分（P0–P5 串行，每阶段独立提交 + 定向测试）

| 阶段 | 内容 | 出口 |
|---|---|---|
| **P0 评审** | 意图卡格式/回访节奏/生命周期/通知分层裁决落盘 | 评审文档 confirmed |
| **P1 驻留创建链** | agent 工具增「挂机任务」创建（exec_background + 意图卡一次成型），意图卡可列举/读取 | 真实节点挂机任务 + 意图卡落盘 |
| **P2 回访 + 交接班** | 回访循环 + 异常 proactive 提醒 + 重开软件交接班汇报 | 关软件期间完成的任务，重开后 agent 主动汇报 |
| **P3 完成通知** | 应用内通知 + 服务器状态文件；移动推送接口预留（BLOCK-70 联动） | 任务完成应用内可见 |
| **P4 实机验收** | aliyun 全链：挂机 → 关软件 → 重开交接班 → 异常提醒 → 手动停止 → 清理 | 验收证据 `acceptance/block-77/` |
| **P5 收口** | 台账/registry/roadmap/handoff 回写 | 整包 completed |

## 7. 验收门

- 挂机任务在软件关闭期间持续运行（服务器侧证据：日志时间戳跨越关机窗口）。
- 重开软件后 agent 交接班汇报准确（任务状态与服务器实况一致）。
- 异常路径：任务失败 → 回访发现 → proactive 提醒（不自动重启）。
- 本地项目与 SSH 远程项目行为一致（本包能力对两类项目都可用）。
- 治理门禁：`docs:check` + `docs:reconcile` + `ui:audit:check`。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 回访循环与 2s 文件树轮询叠加造成性能压力 | 回访独立 60s 节奏 + mux 复用连接（单次 ~RTT） |
| 意图卡成为第二套任务真相 | 意图卡只描述「意图与归属」，执行真相仍在 process/job 状态机（单一真值红线） |
| 通知打扰 | 分层：仅异常与完成通知；进行中不推 |
| 移动推送依赖 BLOCK-70 未启动 | 接口预留，应用内通知先行，不阻塞本包 |

## 9. 治理边界

- 不动 BLOCK-67 已收口语义；复用其 mux/exec_background 通道。
- 与 BLOCK-70 关系：联动非依赖阻塞（应用内通知先行）。
- 与 BLOCK-76 关系：互相独立（本包管「长任务驻留与回访」，BLOCK-76 管「插件执行架构替换」）。
- 0 新 npm 依赖倾向。

## 10. 进度记录
- 2026-09-10 **P4 实机受阻（dell 嵌套 ProxyJump 隧道间歇性中断——基础设施限制而非代码缺陷）**：phase1 真实模型对话正确调 resident_task_create（模型行为完全规范：创建→transport.network 超时→自重试→resident_task_list 核实 count=0→停下报告等用户裁决，符合 R5），但 dell 经 aliyun ProxyJump（127.0.0.1:6022）的嵌套隧道间歇性中断导致 mux 写入 30s 超时。三次 phase1 尝试均因同一原因失败——exec_bg 成功起进程（.log 0 字节=sleep 无输出属预期）但意图卡 json 落盘步骤被隧道中断打断。withTransportRetry 三次退避重试在持续隧道中断窗口内不够。**已验证的证据**（不依赖 dell 隧道稳定性的部分）：P1 创建链 3/3（aliyun 时期）+ P2 读面 8/8 + P3 provenance + P2 回访探针（dell 死进程卡正确翻转 failed）+ surface 传输重试接线。**待定方案（用户裁决）**：A. 切回 aliyun 跑 P4/P5（隧道单跳稳定）；B. 排查 dell 嵌套 ProxyJump 隧道稳定性；C. 接受 dell 限制收口（登记为已知基建限制）。G0 开发期常态 · 不外推 packaged/Provider/GA.
- 2026-09-10 **P2/P3 代码面完成 + 回访循环实机探针验证**：① resident-revisit.js 回访循环（60s 可配 BIOF3_RESIDENT_INTERVAL_MS；进程存活/退出标记/日志增长三检查；completed/failed 翻转 + notify.custom 异常与完成通知；交接班 A 通道=启动首轮回访提醒）；② agent-runner systemPrompt 注入驻留交接班摘要（双通道 B，无卡零注入）；③ surface createResidentTask 命令包装 .exit 标记 + 日志归位 .gewu/resident/。**实机探针**：dell 放置假 running 卡（死 pid 无 .exit）→ 回访循环判 failed 并回写卡片状态（探针验证一个完整周期）。**实机抓真修二**：① resident-revisit require 路径错层（./workspace-gateway → ../）；② projects 查询漏 await（promise 封装整轮被吞）。**待 P4**：真实 agent 会话链（resident_task_create 经对话调用 + 交接班注入实机核对 + interaction/source ssh 适配人工核实）。G0 开发期常态 · 不外推 packaged/Provider/GA.
- 2026-09-10 **P1 驻留创建链完成（代码面 + 契约测试 3/3 + 回归绿）**：① tool-defs 增 resident_task_create/list/read 三定义（create: command+intent 必填、success_criteria/failure_handling/cwd 可选）；② workspace-tools 本地实现三方法（create: 复用 execBackground 起进程 + fs 落卡 .gewu/resident/<taskId>.json；list/read 纯读）+ routed 双栈接线（ssh → surface.createResidentTask 等）；③ ssh surface 增同名三方法（exec_bg + gateway 写卡/列卡/读卡）+ preflight（full access + 命令黑名单 + intent 必填）；④ registry 导入/HANDLERS/contract 登记（create=execution R2 5000ms、list/read=none R0）。**回归**：契约测试 3/3 + P2 套件 8/8 重跑全绿（后端已加载 resident 工具）。待 P2：回访循环 + 双通道交接班。G0 开发期常态 · 不外推 packaged/Provider/GA.
- 2026-09-10 **启动（planned → active，P0-LAUNCH）+ P0 评审稿落盘**：用户裁决「来搞」（队列实际队头——BLOCK-68 注册表漂移已修：plan 文档 09-09 已 completed 而 registry 仍 planned，随本次一并纠正）。P0 评审稿 `docs/block-77-p0-design-review.md`：代码事实（exec_bg/process_status 面、notify.custom 通道、proactive 投影、无会话上下文注入机制、Gateway 双栈写入）+ R1-R5 细化（意图卡文件形态/60s 回访循环/notify 分层/生命周期含 abandoned/只读不自动重启）。待用户确认后进 P1。G0 开发期常态 · 不外推 packaged/Provider/GA.

- 2026-09-10 **立项（planned）**：用户在「agent 驻留服务器持续干活」三档方案中裁决「要做到第二档」→ 本计划落盘并注册 DOC-REGISTRY（planned 排队）。范围=①意图卡 + ②回访循环/交接班 + ③应用内完成通知（移动推送联动 BLOCK-70）；③档真·驻留 agent 明确排除需另立项。启动待用户裁决。G0 开发期常态 · 不外推 packaged/Provider/GA。
