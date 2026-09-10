# BLOCK-76 — 插件执行架构替换：纯 SSH 直跑、产物留服务器（拆除 BLOCK-57 双真值机制）

> 状态：`active`（2026-09-10 用户裁决「按顺序推进」启动，P0-LAUNCH；同日立项）
> 立项日期：2026-09-10
> truthDomain: `block-76-ssh-native-execution`
> 来源：用户裁决——BLOCK-67 SSH 远程项目成型后，「作业包上传 + 产物拉回本地结果库」的双真值机制成为历史包袱，产物应以服务器为真值

## 1. 用户裁决

- 「跑完把产物按 manifest+sha256 校验拉回本地结果库……这个是历史产物，我们通过 ssh 连接成功 就不需要这块的内容了，你看着先把这部分清理掉」（2026-09-10）。
- 主 Agent 评估后指出：BLOCK-57 机制是 SSH 远程项目里插件/Skills 的**执行底座**（D7 自动钉 host + 作业上传 + 产物拉回），直接删除会使远程项目跑分析直接失败。用户三选一裁决：**「立项架构替换」**——立项新工作包实现纯 SSH 直跑（产物留服务器、结果页读远程），完成验收后才拆除 BLOCK-57 机制。

## 2. 背景与动机

- 现状架构（D7/D8，已验收）：SSH 远程项目里跑插件 → tools-executor 自动钉项目 host → 作业包（脚本+参数）上传 → 服务器执行 → 产物 manifest+sha256 拉回**本地** staging jobDir → 结果库/结果页读本地。
- 痛点：数据与产物真值都在服务器，却要在本地维护一份「拉回副本」——双真值、本地磁盘占用、结果页读的其实是本地副本（与「服务器为真值」的远程项目定位矛盾）。
- 目标：插件/Skills 执行改走**纯 SSH 直跑**——脚本经 BLOCK-67 mux 通道在服务器项目内执行，产物**留在服务器**，结果页/指挥中心/provenance 直接读远程真值；历史本地结果库作为只读兼容层保留。

## 3. 目标形态（P0 评审后细化）

- SSH 远程项目里跑插件/Skills：脚本（含 Skills 编排的插件链）经 mux 在服务器项目目录内执行；执行过程（日志/状态）沿用现有作业状态机投影。
- 产物留服务器：写入服务器项目目录下的结果布局（具体路径 P0 定，候选 `<remotePath>/.gewu-results/<jobId>/` 或沿用 `results/jobs` 语义），**不再拉回本地**。
- 结果页/指挥中心/Artifact Truth：读面改造为走 Workspace Gateway（fs 读远程产物）；provenance 继续记录执行环境（R 包清单等）。
- 本地项目：一切不变（本地执行 + 本地结果库）。

## 4. 关键设计裁决（⏳ 待 P0 评审确认）

- **D1 执行形态**：脚本经 mux `exec` 在服务器执行（复用 BLOCK-67 通道，含超时/yield 语义平移）；不再走 jobDir tar 上传。
- **D2 产物真值迁移**：远程真值 + 本地历史兼容（旧作业结果仍在本地结果库可读；新作业只写远程）。单一真值红线重新表述为「远程项目产物真值在服务器」。
- **D3 读取面改造**：结果页/结果窗/指挥中心/工作流的产物读面走 Gateway；缩略图/大文件性能预算（D2 体感预算沿用）。
- **D4 R 包环境**：服务器预装原则不变 + provenance 清单留痕（沿用 BLOCK-57 P3）；可选 renv lockfile 同步另议（不在本包承诺内）。
- **D5 拆除清单（P5 才执行）**：拆 remote-job-runner 的作业上传/拉回/poll 分支与本地 staging 布局；**保留** target-registry（UI-326/327 向导与 D7 依赖）、validate/connect 端点、mux 通道、`__mux` 及 fs/exec verbs。
- **D6 本地项目零影响**：本地执行 + 本地结果库路径一字不动。

## 5. 非范围（exclusions）

- 不做 R 包环境自动同步/安装（renv lockfile 另议）。
- 不动 Skills 清单格式与编排语义（只换执行底座）。
- 不做本地结果库的历史数据迁移（旧结果只读保留）。
- 不外推 packaged/Provider/GA（G0 纪律）。

## 6. 阶段划分（P0–P5 串行，每阶段独立提交 + 定向测试）

| 阶段 | 内容 | 出口 |
|---|---|---|
| **P0 评审** | 以 §4 裁决清单为底，落评审文档（产物布局/读面改造范围/历史兼容语义），用户确认后进 P1 | 评审文档 confirmed |
| **P1 执行链改造** | tools-executor 增「SSH 直跑」分支（mux exec + 服务器 results/jobs 布局），SSH 项目插件作业切新链；聊天/MCP `runPluginToolRemote` 一并收编新内核 | 真实节点上插件作业服务器直跑成功 |
| **P2 读面改造（全量）** | 全部读本地产物的端点一次切 Gateway：tools/file、tools/log/stream、tools/report、result-studio revisions artifact/table-page/source、interaction、harness script/delivery/replay、storage gc/preview-budget | 结果页/结果窗/报告/交互查看器在远程项目全部展示服务器产物 |
| **P3 真值语义 + 兼容** | provenance 环境留痕平移；本地历史结果库只读兼容；Artifact Truth 契约文档更新 | 新旧结果并存可读 |
| **P4 实机验收** | 真实节点全链：远程项目跑插件 → 产物落服务器 → 结果页展示 → provenance 清单正确 | 验收证据 `acceptance/block-76/` |
| **P5 拆除 + 收口** | 按 D5 清单拆除 BLOCK-57 作业机制（保留 target-registry/validate/mux）；全量回归；台账回写 | 整包 completed |

## 7. 验收门

- 远程项目插件/Skills 全链：跑 DESeq2（或等价）→ 产物在服务器 → 结果页展示 → provenance R 包清单正确。
- 本地项目零回归（本地执行 + 本地结果库不变）。
- 拆除后回归：BLOCK-57 全量相关测试退役/迁移清单 + BLOCK-67 全量回归绿。
- 治理门禁：`docs:check` + `docs:reconcile` + `ui:audit:check`。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| Artifact Truth 契约变更波及面大（result-studio/工作流/指挥中心） | P0 评审圈定读面清单；分阶段改造；旧结果只读兼容 |
| 结果页读远程大文件性能 | D2 预算实测驱动；必要时缩略/分页 |
| 历史作业兼容语义混乱 | 本地结果库只读保留；新旧按项目形态天然分区 |
| 拆除误伤在用组件 | D5 拆除清单逐项核销；UI-326/327/D7 依赖组件（target-registry/validate/mux）明确保留 |

## 9. 治理边界

- 单一真值红线重述：SSH 远程项目的产物真值迁至服务器后，本地结果库转为历史只读层，不再产生第二写入真相。
- 启动前置：无硬前置；按单工作包串行纪律排队（BLOCK-75 亦在队列）。
- 0 新 npm 依赖倾向（复用 mux/Gateway；如需依赖单独裁决）。

## 10. 进度记录

- 2026-09-10 **P1 执行链代码面完成（实机验证待节点运行时裁决）**：① 新增 `core/biof3-server/helpers/remote-execution/ssh-direct-runner.js`——gateway 写编排面（>768KB 输入走 base64 分块追加通道）+ `exec_bg` 后台直跑（`runtimeBin run-script.X "$(pwd)"; echo $? > output/.exit`）+ `ps_pid`/.exit 双信号轮询（active/terminal/unknown）+ 日志 offset 增量（服务器 run.log 真值）+ 进程组取消（setsid 会话 `kill -- -pid`，经 gateway exec）+ output/ 清单。② tools-executor 接线：handleToolRun 捕获 ssh 项目行 → `runSshDirectToolJob` 独立终态链（result_json 增 `workspaceKind:'ssh'`+`outputPath` 相对路径+transport gateway-ssh-direct，R4）；provenance 执行目标标 `ssh-native`。③ mcp/registry `runPluginToolRemote` 收编：ssh 项目作业切直跑内核；聊天渲染过渡期拉回 output/（`B76_CHAT_TRANSITIONAL_PULLBACK` 常量门，P2 读面切换时拆除）。④ 门禁：runner 零网络定向 7/7（`test/ssh-direct-runner.test.mjs`）+ 三文件语法 0 + impact-map 新增 block76 规则。**实机出口被节点运行时阻塞**：aliyun 无 Rscript、python3 无 numpy/pandas（插件目录 4 个 python 插件均需 pandas/scikit-learn/matplotlib 级依赖）——现有插件在真实节点上无法达成成功终态。解除方案（用户裁决）：A. aliyun pip3 install 运行时依赖（python 插件线）；B. aliyun 装 R + R 包（全目录覆盖，体量大）；C. 注册一个零依赖 python 冒烟插件（产品目录污染风险）。P1 代码面先行提交，实机验证随裁决补跑。G0 开发期常态 · 不外推 packaged/Provider/GA。

- 2026-09-10 **P0 设计评审 confirmed（用户三项裁决）**：评审稿 `docs/block-76-p0-design-review.md`（现状八步数据流代码事实 + R1-R6）。用户裁决：**R1 产物布局沿用 `results/jobs` 语义**（result-studio outputPath 相对 workspace 天然同构，读面零分叉）；**R3 读面全量塞 P2**（一次性切完全部本地读面端点，含报告/交互/回放/存储治理，否决分期建议）；**R6 聊天/MCP 旁路 P1 收编**。R2（gateway 写脚本 + exec_bg 后台直跑）/R4（result_json 增量字段 workspaceKind+相对 outputPath，旧绝对路径只读兼容零迁移）/R5（拆除清单化：拆 job-supervisor 链与 uploadBundle/pullBundle，留 target-registry/validate/mux/ensureAgent）随评审稿整体确认。**推论一并确认**：P5 后「本地项目选远程执行目标」的 BLOCK-57 原语义退役（要远程算力应建 SSH 项目）。P0 出口达成，进 P1。
- 2026-09-10 **启动（planned → active，P0-LAUNCH）**：用户裁决「按顺序推进」（队列首位；无硬前置）。P0 评审开工：代码事实核实（D7 钉 host=handleToolRun 强制钉回项目 host；staging 回落 remote-projects/<id>；结果库=tool_jobs.result_json 绝对路径+磁盘文件，无独立 results 表；读面端点清单 tools/file·log·report + result-studio 全家 + harness 回放；Gateway read 无上限/write 1MB cap；聊天旁路 runPluginToolRemote）。G0 开发期常态 · 不外推 packaged/Provider/GA。
- 2026-09-10 **立项（planned）**：用户在「清理 BLOCK-57 机制」议题上三选一裁决「立项架构替换」→ 本计划落盘并注册 DOC-REGISTRY（planned 排队）。主 Agent 评估已明确：直接删除会使 SSH 远程项目插件/Skills 执行失败（D7 依赖），故采用「先建新链、验收后拆旧」的软着陆路径。启动待用户裁决。G0 开发期常态 · 不外推 packaged/Provider/GA。
