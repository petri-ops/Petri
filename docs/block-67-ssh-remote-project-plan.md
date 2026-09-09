# BLOCK-67 — SSH 远程项目：项目本体在远程服务器的完整工作区形态

> 状态：`active`（2026-09-09 用户裁决启动；**P0 设计评审 confirmed**——八项裁决经用户裁决：D1–D5/D7/D8 按原案确认，**D6 修订为「Windows 指挥席」**（实测 ssh/tar 客户端就绪 + spawn argv 跨平台无障碍 + BLOCK-63 先例；macOS 转后续兼容面不专门验证）；节点资产：用户将本机 ED25519 公钥加入 aliyun authorized_keys，P1–P3 以 aliyun 单节点验收，dell 后续再议。当前进行 P1 工作区骨架）
> 立项日期：2026-09-09（用户裁决「需要立项」）
> truthDomain: `block-67-ssh-remote-project`
> 来源：用户需求「创建的项目就是 ssh 连接远程服务器的项目，对话、文件树渲染都要有」（对标 ZCode SSH 远程连接形态）

## 1. 用户裁决与目标形态

**裁决原文要点**：
1. 完整项目形态，**不是** BLOCK-57 的轻量形态（本地项目 + 作业飞出去）。
2. **体感与使用体验和本地保持一致**：创建项目时项目本体就是远程服务器上的目录；对话、文件树渲染都要有，且与本地项目同构。

**目标形态（用户视角）**：
- 新建项目时可选「SSH 连接」：选目标主机（已注册目标或 `~/.ssh/config` 发现）+ 远程路径 → 项目创建完成，项目卡带远程标识（host 徽标）。
- 打开远程项目后：文件树渲染远程目录（展开/图标/排序/新建/重命名/删除与本地一致）、文件预览与编辑保存直写远程、对话（composer → agent loop）直接在远程工作区上读写与执行、终端是远程 shell、审阅是远程 git。
- **体感一致 ≠ 用户感知不到远程**：网络延迟与断线必须诚实呈现（连接状态条/操作失败说明），不掩盖；一致的是「操作方式与信息呈现的同构」，不是假装零延迟。

## 2. 与 BLOCK-57 的关系：复用通道，不混形态

| 维度 | BLOCK-57（completed） | BLOCK-67（本包） |
|---|---|---|
| 项目本体 | 本地目录 | **远程目录（ssh://alias/path）** |
| 飞过 SSH 的东西 | 作业包（script+params）+ 产物拉回 | 文件树元数据 / 文件内容 / 工具调用 / 终端流 / git 操作 |
| ExecutionTarget | 作业级参数（composer chip） | 项目创建时定死 workspace 形态；作业默认执行面 = 项目自身 host |
| 触发方式 | 用户在 composer 选执行目标 | 用户在创建项目时选 SSH 连接 |

**复用资产（BLOCK-57 已实机验证）**：
- `core/biof3-server/helpers/remote-execution/` 六文件：ssh-config 只读解析 / ssh-transport（BatchMode argv 数组 + tar-over-ssh）/ node-agent（daemonless bash，固定 verbs）/ error-classifier / target-registry / remote-job-runner。
- aliyun + dell 双节点实机闭环（部署钉扎/探测/日志流/sha256 对账/取消收敛）。
- 产物 manifest + hash 拉回对账（Artifact Truth 跨机同构）。

**边界**：本包不重做通道层；BLOCK-57 的 P2 Slurm / P4 广度仍维持用户裁决「不做」。远程项目与本地项目的 ExecutionTarget 语义不叠加成第二套模式（见 D7）。

## 3. 代码事实基线（本地假设清单 = 缺口所在）

| 层 | 现状（已读源核实） | 远程项目需要 |
|---|---|---|
| 项目模型 | `projects.workspace_path` = 本地目录 | workspace 形态扩展：`local` \| `ssh`（+ host alias + remote path，additive 列） |
| 文件树/预览 | `file:*` / file-dialog IPC 直读本地 fs | ls/read/write/stat 走 SSH（node-agent 扩 verbs），树元数据缓存 |
| 对话工具面 | `agent-tools/workspace-tools.js` 8 工具：`workspace_list / read / write / replace / find / search / exec / exec_background`，全部本地路径语义 | 同一工具面按项目 workspace 形态路由到 ssh backend（模型可见契约不变或 additive） |
| 终端 | 本地 pty（BLOCK-54 多 Tab） | ssh pty 直通（`ssh -t` 挂进既有 pty 面板） |
| 审阅 | `git-adapter` child_process 本地 git（BLOCK-29/41 链） | 远程 git 经 SSH exec（status/diff/log/stage/commit/branch 只读先行） |
| 执行产物 | tool_jobs/jobDir 本地落盘 | 作业在远程项目 host 执行，产物 manifest+hash 拉回本地 jobDir（复用 BLOCK-57 收尾） |

**单一真相红线（不可破）**：agent loop、会话、tool_jobs 状态机、Artifact Truth、copilot DB **留在本地**，远程只是工作区数据面。不把 loop 派驻远程、不在远程建第二套 job/artifact/会话真相（治理 Guardrail）。

## 4. 架构草案

```
┌─ 本地指挥席（不变的部分）────────────┐       ┌─ 远程主机（项目本体）──────────┐
│ UI（文件树/预览/对话/终端/审阅）      │       │ 项目根 /path/to/project         │
│ agent loop / copilot DB / tool_jobs │       │  ↑ node-agent verbs 扩展：      │
│ Artifact Truth / provenance         │       │    fs_list/fs_read/fs_write/    │
│           ↓                         │       │    fs_stat/fs_mkdir/fs_mv/      │
│  Workspace Gateway（新）             │  SSH  │    fs_rm/fs_glob/fs_grep/       │
│  按 workspace 形态路由：             │◄─────►│    exec/exec_background/stream  │
│   local → 本地 fs（现路径，零改动）  │  隧道  │  git_status/-diff/log（只读先行）│
│   ssh   → ssh-transport + agent     │       │  产物目录（manifest+hash）       │
└─────────────────────────────────────┘       └─────────────────────────────────┘
```

- **Workspace Gateway** 是唯一新抽象：一个接口（list/read/write/stat/mkdir/mv/rm/glob/grep/exec）× 两个后端（local / ssh）。本地后端即现有实现平移接入，远程后端走 BLOCK-57 通道。
- **树缓存**：目录级元数据 read-through 缓存（条目名/类型/size/mtime），展开即拉、失效按需重验；预览按需拉取（大文件分块/截断沿用现有 preview 契约）。
- **写入**：write-through，远程是唯一真值；本地不留会漂移的副本。
- **终端**：`ssh -t alias` 挂进既有终端 Tab 体系（BLOCK-54 的 Map 会话管理复用）。

## 5. 关键设计裁决（P0 设计评审清单，待用户确认后进 P1）

- **D1 执行形态 = thin per-call SSH（推荐）**：loop 本地、每个工具调用一次 SSH exec（node-agent verb）。备选「loop 派驻远程」被单一真相红线否决（要建远程会话/作业真相）。延迟靠缓存与批量化缓解，不做守护进程长连接（与 BLOCK-57 D1 同哲学，P4 可选优化再议）。
- **D2 体感预算**：文件树单目录展开 P50 ≤ 1.5s（真机实测校准）；预览首帧 ≤ 2s；超预算走骨架屏/进度态，不白屏。实测不达标再引入预取/批量化，不提前优化。
- **D3 真值与缓存**：远程唯一真值；树缓存 read-through 只读；写操作 write-through + 保存前 mtime 冲突检测（他端已改则提示，不静默覆盖）。
- **D4 凭据与安全**：沿用 BLOCK-57 —— 仅 SSH key + BatchMode、known_hosts strict、BioF3 不存密码；远程命令一律 argv 数组 + 路径 shlex 引用，禁止字符串拼 shell；node-agent verbs 白名单固定，不接受自由命令字符串（exec verb 参数同样数组化）。
- **D5 断线语义**：连接态显式呈现（已连接/重连中/已断开状态条）；断线时读操作显示诚实错误 + 重试，写操作绝不本地暂存后补写（防静默漂移）；重连后树缓存全量失效重验。
- **D6 平台边界**：~~指挥席 macOS 优先~~ → **修订（2026-09-09 P0 用户裁决）：Windows 指挥席**。依据：本机实测 System32 OpenSSH 10.2 + tar 就绪、`spawn('ssh', argv)` 跨平台无障碍、`os.homedir()/.ssh/config` 解析正常；BLOCK-63 电脑控制已有 Windows 指挥席先例。macOS 转后续兼容面，本包不专门验证。
- **D7 与 ExecutionTarget 的关系**：远程项目的作业默认执行面 = 项目自身 host（tools-executor 远程分支复用）；本地项目行为一行不变；远程项目不再叠加 composer 执行目标 chip（防止双模式回潮，BLOCK-30 教训）。
- **D8 产物链**：远程执行的科学作业产物按 BLOCK-57 manifest+hash 拉回本地 jobDir，Artifact Truth 仍以本地拉回后为准（跨机可复现红利延续）。

## 6. 阶段划分（P0–P5 串行，每阶段独立提交 + 定向测试）

| 阶段 | 内容 | 出口 |
|---|---|---|
| **P0 设计评审** | 以 §5 八项裁决为底，落评审文档（传输细节/缓存失效/断线恢复/安全面/范围切分），用户确认后进 P1 | 评审文档 confirmed |
| **P1 工作区骨架** | Workspace Gateway 双后端 + 项目模型 additive（workspace_kind/host/remote_path）+ SSH 项目创建流（目标选择/远程路径校验/探测）+ 文件树/预览/编辑保存远程化 | 真实节点上文件树展开、预览、编辑保存与本地同构；本地项目零回归 |
| **P2 对话工具面** | 8 个 workspace_* 工具按 workspace 形态路由 + 环境上下文注入（模型知道 OS/shell 真相，复用 BLOCK-33 system_info 语义）+ 作业产物拉回（D8） | 真实对话在远程项目上完成一次读→改→执行→产物进结果库闭环 |
| **P3 终端 + 审阅** | ssh pty 终端 Tab + 远程 git 只读链（status/diff/log）先行，写操作（stage/commit）随后 | 远程项目可看 diff、可提交、可开终端 |
| **P4 实机验收** | 真实节点全链：创建→浏览→编辑→对话分析→终端→审阅→断线恢复→重连重验；性能预算实测（D2）；本地项目回归面 | 验收证据 `acceptance/block-67/` |
| **P5 收口** | 台账 UI 编号登记 + registry/roadmap/handoff 回写 | 整包 completed |

## 7. 验收门

- **体感一致六面**：文件树展开 / 文件预览 / 编辑保存 / 对话执行 / 终端 / 审阅，逐一与本地项目对照过目。
- **性能预算**：D2 指标真机实测达标（不达标则如实记录并按预算条款处置，不降门禁）。
- **零回归**：本地项目全链（创建/树/预览/对话/终端/审阅/作业）行为不变；不开远程形态时代码路径与现在逐字节同语义。
- **断线恢复**：杀 sshd / 断网两态下操作诚实失败、重连后状态恢复、无静默数据漂移。
- **安全面**：远程命令 argv 数组化抽查 + node-agent verb 白名单测试 + known_hosts strict 行为验证。
- 治理门禁：`docs:check` + `docs:reconcile` + `ui:audit:check` 收口必跑。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 每操作 SSH 延迟破坏体感 | 目录级缓存 + 展开即拉；实测不达标再批量化/预取（D2 预算驱动，不提前优化） |
| 写冲突/静默漂移 | 远程唯一真值 + write-through + 保存前冲突检测（D3）；断线绝不本地暂存（D5） |
| 远程命令注入面 | argv 数组 + shlex + verb 白名单（D4）；审计抽查入验收门 |
| 双模式回潮（BLOCK-30 教训） | workspace 形态在创建时定死、不可运行时切换；远程项目不叠加执行目标 chip（D7） |
| 大仓库树卡顿 | 懒展开（逐目录拉取）+ 缓存；不做一次性全量树 |
| 通道层缺陷传导 | 复用 BLOCK-57 已实机验证组件，不重写；新 verbs 走零网络单测 + 真节点两级验证 |
| 体量失控 | 严格按 P1 文件面 → P2 对话 → P3 终端/审阅切分；审阅写操作若超预算降级为只读先行并如实登记 |

## 9. 治理边界

- 单一真相红线不破：不建第二套 executor/job/artifact/workflow/loop/项目状态真相（§3）。
- 体量为排队清单最大包之一；排队现状：BLOCK-64 / BLOCK-65 已在排队，**启动顺序与是否插队由用户裁决**。
- 0 新 npm 依赖倾向（SSH 走系统 ssh 命令、pty 已有）；如确需依赖（如 ssh2）在 P0 评审单独裁决。
- 不动：BLOCK-57 已收口语义、G1+ 阶段事项（packaged/Provider/GA）、Result Studio 边界。
- 前端改动同步 `docs/ui-productization-audit.md`（UI 编号随实现登记）。

## 10. 进度记录

- 2026-09-09 **P3 终端+审阅收口（实机 4/4 allPass）**：① 终端：`terminal:session-start` 增 ssh 分支——node-pty 直挂 `ssh -tt <alias>` 远端 cd remote_path 进登录 shell；**Windows 实机教训两则**：ssh.exe 作为 conpty 直接 shell 会让 node-pty 的 conpty_console_list_agent（getConsoleProcessList → AttachConsole failed）崩掉整个主进程，改经 cmd.exe /c 包装；前端链（preload startSession 第三参 / electron.d.ts / useTerminalTabs sshRef / BottomTerminal / project-workspace ssh 项目透传）additive。② 审阅：git-adapter 增 `remoteSsh` 模式（同一 argv 面经 `ssh <alias> git` 远端执行，remote 路径不本地 resolve；同步 run + 异步 runAsync 双通道），working-tree-review 的 resolveGitAdapter 对 ssh 项目注入 remoteSsh 适配器——status/diff/log/show 只读链先行，写操作同 argv 通道随后可用。**实机**：`scripts/block67-p3-live.cjs` 4/4 allPass（acceptance/block-67/p3-live.json + 截图×3）——SSH 项目创建 / ssh pty 挂通远端 shell 回显 / 终端 pwd=/root/gewu-block67-demo（远程工作目录语义实证）/ 远程 git status+diff 数据面（README.md 修改 + remote-dirty-line 在 diff 中）。进 P4 实机验收。
- 2026-09-09 **P2 对话工具面收口（P2a–P2d，实机 5/5 allPass）**：① P2a node-agent 扩 find/grep/exec/exec_bg/ps_pid/kill_pid verbs（模型命令 base64 单参入 bash -c 无外层拼接，输出 cap 64K/32K）；② P2b `agent-tools/workspace-ssh-surface.js`——8 个 workspace_* 工具+后台进程三件套按 workspace_kind 路由（契约同构、校验回调单源注入、命令黑名单同门、路径边界 fail-closed、结果带 remote 标注诚实语义差异）；③ P2c system_info ssh 项目远程环境真相（探测失败诚实 remote_probe_failed）+ D7 tools-executor 作业默认执行面钉项目 host（alias 未注册自动注册，防 BLOCK-30 双模式回潮）+ resolveProjectRunLayout ssh staging 回落（remote-projects/<id>，D8 产物拉回落本地 jobDir，Artifact Truth 留本地）；④ P2d **实机抓真修**：interceptor `preflightWorkspaceTool` 本地路径校验把 ssh 项目整个拦截（路由 wrapper 无执行机会，真实模型对话诚实暴露 workspace_unavailable）→ 补 sshSurface.preflight 远程语义门。**P2 出口达成**：`scripts/block67-p2-live.cjs` 真实模型对话 5/5 allPass（acceptance/block-67/p2-live.json + 截图×2）——REST 创建 ssh 项目+主窗远程树 / 一次对话完成 读README首行→workspace_write 追加标记（节点侧 cat 对账 write-through）→workspace_exec 远程 python 打印标记→system_info 报远程 Linux。零网络测试：fs verbs 11/11 + ssh surface 9/9 + p2c 5/5 + gateway/routes 9+7 + block57 回归 21。进 P3 终端+审阅。
- 2026-09-09 **P1e 实机验收 allPass（P1 整段收口）**：用户将本机 ED25519 公钥加入 aliyun 后，节点级 Gateway 全链（部署 2.2s / list 545ms / read 573ms / mv/rm/冲突检测）+ dev Electron CDP 实机 `scripts/block67-p1-live.cjs` 6/6 断言 allPass（`acceptance/block-67/`：创建面板+目标候选 / 校验并创建 2.8s 进工作台 / 远程树+懒展开 / 预览首帧 1884ms / write-through 保存节点对账 / 409 冲突+节点侧保留）。**D2 实测达标**：树展开 P50 ~1.18s（≤1.5s）、预览 ~1.1s（≤2s）。**实机抓真修两处**：① 前端保存链漏传 expectedMtimeMs（D3 未接线，他端改动被静默覆盖）→ 树条目 modifiedAt 透传 + 保存基线滚动；② 预览 GET 双 SSH 往返超预算 → 省 stat。**验收脚本教训**：home isInitialEntry 自动跳最近项目，shadow history.length 使「返回首页」走 PUSH 才能落工作台视图。P1 出口达成（真实节点文件树/预览/编辑保存与本地同构；本地项目零回归由路由测试与 vitest 覆盖）。进 P2 对话工具面。
- 2026-09-09 **P1 代码面完成（P1a–P1d 四提交，实机验收押后 = P1e）**：① P1a node-agent 扩 fs verbs（fs_stat/list/read/write/mkdir/mv/rm；base64 路径传输保持 argv 白名单，`=` 纳入白名单 + fs_write 载荷上限 1MB/参数上限放宽至 2MB）；② P1b Workspace Gateway（`helpers/workspace-gateway.js` 唯一新抽象：list/read/write/stat/mkdir/mv/rm × local/ssh 双后端 + safeRemoteJoin 边界 + D3 mtime 冲突检测）+ projects 表 additive（workspace_kind/ssh_host/remote_path，ssh 项目不落本地 workspace_path）+ createProject fail-closed 校验；③ P1c files.js 树/读/写 ssh 分支（条目契约与本地同构/Content-Type 按扩展名/409 冲突/502 断线诚实 retryable）+ `PUT /api/workspaces/:id/file` REST 写（仅 ssh，local 沿用 IPC）+ `routes/ssh-projects.js`（GET targets 复用 target-registry + POST validate：ensureAgent 部署 + fs_stat 目录验证）+ api-data ssh 创建透传；④ P1d 前端（UI-321 in_progress）：home SSH 创建面板（目标 datalist + 路径校验 + fail-closed 文案）+ 项目卡 SSH·host 徽标 + ActiveWorkspaceFile.workspaceKind 全链透传 + 预览保存 ssh 走 REST 直写（saveError 诚实错误面）+ project-store/types 映射。**门禁**：零网络 bash 实测 6/6 + gateway 9/9 + 路由级 7/7 + block57 回归 21/21（含 AGENT_ARG_RE 变更面）+ tsc 0 + 定向 vitest 8/8 + docs/ui 门禁 PASS；**顺手清存量债**：block57 两测试修 Windows pathname 路径 bug、impact-map 补登记 block69/ui320（test:changed 恢复可用）；P6 证据绑定测试红为并行会话 acceptance 证据存量漂移（如实归属，非本包文件面）。**P1e 待办**：用户将本机 ED25519 公钥加入 aliyun authorized_keys 后，dev Electron 实机跑 创建→树展开→预览→编辑保存 与本地同构对照 + D2 性能预算实测，证据落 acceptance/block-67/。
- 2026-09-09 **P0 设计评审 confirmed**：八项裁决逐项核实代码事实（ssh-transport 全 argv spawn / node-agent verb 白名单 / error-classifier 断线分叉 / tools-executor 远程分支键控 / pullBundle manifest+hash 现成）后呈用户裁决——D1–D5/D7/D8 原案确认；**D6 修订为 Windows 指挥席**（实测 ssh.exe/tar.exe 就绪 + BLOCK-63 先例）。节点资产实测：aliyun:22 TCP 可达但本机公钥未授权（Permission denied (publickey)）、aliyun-6022 超时、dell LAN 不可达——用户裁决将本机 ED25519 公钥（`desktop-n94blo7\admin@DESKTOP-N94BLO7`）加入 aliyun，P1–P3 以 aliyun 单节点验收。P0 出口达成（评审确认），进 P1。
- 2026-09-09 **启动（planned → active，P0-LAUNCH）**：用户裁决启动 BLOCK-67。当前唯一 active 工作包（串行纪律：BLOCK-72 已收口、无其他 active）。P0 设计评审开工：§5 八项裁决逐项核实代码事实 + D6 平台矛盾点（plan 写 macOS 优先、实机为 Windows，Windows 侧有 BLOCK-63 先例）显式呈用户裁决；真实节点资产 aliyun+dell（BLOCK-57 注册目标）。环境纪律沿用：fnm Node 24.20 / 显式路径 git add / 并行会话 BLOCK-70 文件面零触碰。
- 2026-09-09 **P0（planned 立项）**：用户裁决「需要立项，直接走完整项目不要走 BLOCK-57 轻量，SSH 体感与使用体验呈现和本地保持一致」→ 本计划落盘并注册 DOC-REGISTRY（planned 排队）。评估随立项交付：与 BLOCK-57 边界（§2）/ 代码事实基线六层缺口（§3）/ 架构草案 Workspace Gateway 双后端（§4）/ P0 设计评审八项裁决清单（§5）/ P0–P5 阶段划分（§6）。下一步：用户裁决启动顺序后进 P0 设计评审确认。G0 开发期常态 · 不外推 packaged/Provider/GA。
