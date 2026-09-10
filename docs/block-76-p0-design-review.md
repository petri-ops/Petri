# BLOCK-76 P0 设计评审 —— 纯 SSH 直跑产物留服务器（评审稿 v1）

> 状态：`评审中`（2026-09-10 落盘；用户确认各裁决后进 P1）
> 归属工作包：`docs/block-76-ssh-native-execution-plan.md`（§4 D1–D6 的细化与确认）
> 事实基线：本文所有「现状」均为 2026-09-10 HEAD 代码事实（已逐文件核实）

## 1. 现状架构（代码事实）

SSH 项目插件作业当前数据流（触发 → 展示）：

1. **D7 钉 host**：`handleToolRun`（tools-executor.js:2264-2294）查 `projects.workspace_kind/ssh_host`，经 `targetRegistry.getByAlias` 就地注册默认目标，**显式传别的 target 也强制钉回项目 host**，写 `tool_jobs.execution_target_id`。
2. **本地 staging**：`resolveProjectRunLayout`（project-run-layout.js:116-124）——SSH 项目 `workspace_path=NULL`，jobDir 回落 `~/Documents/BioF3-Local/remote-projects/<projectId>/results/jobs/<jobId>`（run-script.R/py、params.json、上传输入、output/、report-template、_biof3-theme.R）。
3. **上传执行**：`resolveRemoteTargetForJob`（tools-executor.js:1344-1369）探测 + 运行时解析 → `runRemoteToolJob`（:1376-1499）→ `remoteRunner.submit` = `uploadBundle`（tar-over-ssh，排除 output/）→ node-agent start，远端目录 `$HOME/.biof3-agent/jobs/<jobId>`。
4. **运行期**：`streamLog` 偏移续传镜像到本地 `output/remote-runner.log`；30s `pollStatus` 心跳；cancel 走 agent cancel。
5. **拉回**：终态后 `pullOutputs` 拉 output/ + transfer-manifest sha256 逐文件对账（fail-closed）。
6. **登记**：`createJobRunFinalizer` → `transitionToolJobToCompleted` 把 **含本地绝对路径的 result_json**（jobDir/outputDir/resultDir/outputs[]/files[]/provenance）写 `tool_jobs` 表——**没有独立 results 表，结果库=tool_jobs.result_json + 磁盘文件**。
7. **展示（读面）**：
   - `GET /api/tools/file/:jobId/:filename`（handlePrivateFileRead，tools-executor.js:955-1021）——结果页 `ResultArtifactShell.tsx:241`、结果窗 `WindowResultPage.tsx:70-116` 的产物来源；
   - `GET /api/tools/log|stream/:id`（tools-metadata.js:216-255，读本地镜像日志）；
   - `POST /api/tools/report/:jobId`（读本地 outputDir 拼报告，副本落 results/exports）；
   - result-studio：`/revisions/:id/artifact|table-page|source`（读 `<workspace>/<outputPath>`，**outputPath 相对 workspace 根** + sha256 校验）、`/interaction`（snapshotPath 绝对路径）、storage gc/preview（扫 workspace_path）；
   - 指挥中心：`/api/tools/history` 纯 DB，不直接读产物文件。
8. **聊天/MCP 旁路**：`mcp/registry.js:1297-1407 runPluginToolRemote`——聊天同步远程直跑 + `execution_target_id` 补记，与主链并存（第二入口）。

Gateway 现状（BLOCK-67）：ssh 后端支持 list/stat/read/write/mkdir/mv/rm + find/grep/exec/exec_bg/ps_pid/kill_pid；`read` 无大小上限（整文件 base64，60s 超时；fs_read 支持 offset/len 分段但无人用）；`write` 1MB cap；前端预览预算 `MAX_PREVIEW_BYTES=16MB`。

## 2. 评审裁决（R1–R6，⏳ 待用户确认）

### R1 产物布局：沿用 `results/jobs` 语义（推荐）⏳

- **推荐 B**：远程产物写 `<remote_path>/results/jobs/<toolJobId>/output/`——与本地项目**同构**。决定性理由：result-studio Revision 的 `outputPath` 本就是相对 workspace 根的相对路径，读面只需把「workspace 根的 fs」换成 Gateway 后端，本地/SSH 一套语义零分叉；且用户在服务器项目树里能看到与本地一致的结果目录。
- 备选 A `<remote_path>/.gewu-results/<jobId>/`：独立命名空间更「干净」，但 result-studio 相对路径语义要对 SSH 项目特判，读面分叉，且 D5 拆除后旧 `.biof3-agent/jobs` 与新树并存两种远程布局。
- jobDir 中间物（run-script/params/上传输入）写 `<remote_path>/results/jobs/<jobId>/` 同目录（不建隐藏树）；不再使用 `$HOME/.biof3-agent/jobs/<jobId>`。

### R2 执行链：gateway 写脚本 + `exec_bg` 后台直跑（D1 细化）✅ 技术面无分歧

- 脚本/params/输入经 Gateway `write`（>1MB 的上传输入走分块或 exec 管道——P1 实测定，插件主链脚本均为 KB 级）；
- 执行用 BLOCK-67 P2a 的 `exec_bg`（detached nohup 语义）+ `ps_pid` 存活探测 + `kill_pid` 取消——平移现有 detached/心跳/取消语义；
- 日志：`fs_read` offset 续读服务器端 `output/run.log`（exec_bg 重定向），本地 `remote-runner.log` 镜像**降级为纯缓存**（见 R4）；
- 保留 `ensureAgent`（fs/exec verbs 的载体）与 mux 通道；退役 agent 的 job-supervisor 子命令依赖（start/status/manifest/exitinfo）。

### R3 读面改造分期（D3 圈定）⏳

- **P2（必备展示链）**：`/api/tools/file/:jobId/:filename`（含 WindowResultPage/ResultArtifactShell）、`/api/tools/log/:id`、result-studio `/revisions/:id/artifact|table-page|source`——覆盖结果页/结果窗主链。
- **P3（真值语义+兼容）**：`/api/tools/report/:jobId`（远程聚合报告）、`/interaction` 交互快照、harness scientific-task 的 script/delivery/replay、storage gc/preview-budget 的 SSH 适配。
- 备选「全量塞 P2」：单阶段体量翻倍、验收面膨胀，不推荐。

### R4 真值语义与日志（D2 细化）✅ 技术面无分歧

- `result_json` 新增 additive 字段：`workspaceKind:'ssh'` + `outputPath`（相对项目根）——**不再写本地绝对路径**；旧作业绝对路径原样保留，读面按 workspaceKind 分流（无标记=本地历史，走既有 fs 链——天然只读兼容，零迁移）。
- 单一真值红线重述：SSH 项目产物真值在服务器；本地 staging 目录在 P5 后不再承接 SSH 作业产物（可作缓存在 P5 评估清理）。
- 日志真值在服务器 run.log；本地 mirror 仅运行期缓存（断线重连续读），不参与终态对账。

### R5 拆除边界（D5 清单化，P5 执行）✅ 边界已核清

- **拆**：`runRemoteToolJob`/`adoptRemoteRunningJob`/启动重附扫描/`killLocalToolJob` 远程分支、`uploadBundle`/`pullBundle`/`remoteJobDirPath`、agent job-supervisor 子命令（start/status/log/manifest/exitinfo）及其远端 `$HOME/.biof3-agent/jobs` 布局、`pullOutputs`+transfer-manifest 对账链。
- **留**：target-registry + execution_targets 表、`routes/ssh-projects.js` targets/connect/list/validate（UI-326/327 向导在用）、mux 通道、node-agent fs/exec verbs、`ensureAgent`、error-classifier、`process-lifecycle.excludeRemoteTargets`（本地孤儿扫描仍需跳过远程作业）。

### R6 聊天/MCP 旁路收编 ⏳

- `runPluginToolRemote`（聊天同步远程直跑）在 P1 一并切新执行内核（同一 SSH 直跑实现），不留两条远程执行真相——否则 P5 拆旧后聊天路径断。
- 备选「保留旧链仅插件页切换」：制造双真相，违背单一真值红线，不推荐。

## 3. 风险与实测项（进 P1 前置 acknowledges）

- **大产物读面性能**：gateway read 整文件 base64 无上限——>16MB 产物沿用 `MAX_PREVIEW_BYTES` 预算诚实降级，全量下载体验 P2 实测驱动（必要时 offset/len 分段流）。
- **>1MB 上传输入**：gateway write 有 1MB cap——大输入文件（counts.csv 等）P1 需分块通道或 exec stdin 管道，实测定。
- **exec_bg 孤儿语义**：本地孤儿扫描已排除远程作业（excludeRemoteTargets）；新链 ps_pid 轮询语义在 P1 与心跳表对齐。

## 4. 确认记录

- 2026-09-10 落盘评审稿 v1（代码事实核实完毕）；R1/R3/R6 + 整体进 P1 待用户确认。
