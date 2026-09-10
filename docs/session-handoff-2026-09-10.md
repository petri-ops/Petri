# 会话交接文档 — 2026-09-10

> 本文档由 ZCode Agent 在会话结束前生成，供下一位 Agent / 开发者恢复上下文。

## 一、本会话完成的三个工作包

### BLOCK-76-SSH-NATIVE-EXECUTION ✅ completed（P0–P5 当日完成）

**目标**：插件/Skills 执行架构从 BLOCK-57「作业上传+产物拉回」替换为纯 SSH 直跑（产物留服务器）。

**交付**：
- P0 评审 confirmed（R1 沿用 results/jobs 布局 / R3 读面全量塞 P2 / R6 聊天旁路收编）
- P1 直跑内核 `ssh-direct-runner.js`：gateway 编排面上传 + exec_bg 后台直跑 + .exit 终态 + 进程组取消
- P2 读面全量 Gateway 化：tools/file + tools/log + report + revisions artifact/table-page（dell 实机 8/8）
- P3 provenance R 包清单平移（captureREnv）+ 聊天终态远程化（过渡拉回拆除）
- P4 全链验收 10/10（deg_table/run.log/report 全经 Gateway 读服务器真值，本地零拉回）
- P5 BLOCK-57 作业机制按 D5 清单拆除（job-supervisor verbs/uploadBundle/pullBundle 等）

**抓真修三**：
1. `src/ipc/diagnostic.js` 相对 require 路径错层（BLOCK-9.1 遗留，导出链完全坏死）→ 一行修复 + `test/ipc-relative-requires.test.mjs` 机械门禁
2. `MAX_ARG_STRLEN` 128KB/参数导致 gateway 名义 1MB 写入 >98KB 即 E2BIG → 全链 64KB 分块
3. `require` 错层/漏 await 两个自伤 → `withTransportRetry` 3 次退避重试

**登记**：DOC-REGISTRY completed / AUDIT-LOG 整包收口行 / plan §10 五条进度 / review doc

### BLOCK-77-RESIDENT-TASKS 🔴 active（P0–P3 完成，P4 受阻）

**目标**：长任务驻留与回访通知——挂机跑、回来接上、完成告诉你。

**已完成**：
- P0 评审 confirmed（R6 交接班=双通道：proactive 任务条 + agent 会话注入）
- P1 驻留创建链：`resident_task_create/list/read` 三工具三层注册 + 意图卡 `.gewu/resident/<taskId>.json`（契约测试 3/3）
- P2 回访循环 `resident-revisit.js`：60s 可配，进程存活/.exit/日志增长三检查，completed/failed 翻转 + notify 异常与完成通知；实机探针验证（dell 死 pid 卡正确翻转 failed）
- P3 provenance 平移（captureREnv 服务器 R 包清单）+ 聊天终态远程化 + 交接班双通道 B（agent-runner systemPrompt 注入）

**P4 受阻**：dell 嵌套 ProxyJump 隧道间歇性中断——模型行为规范（三次调用 resident_task_create、自重试、list 核实、停下报告），但 mux 写入在隧道中断窗口内 30s 超时。**用户裁决切 aliyun 跑 P4**（脚本已切，尚未执行）。

**P4 剩余**：`scripts/block77-p4-live.cjs phase1`（aliyun 建项目 + 真实对话挂机）→ 关软件 → `phase2`（重开交接班 + 异常路径 + 手动停止）。

**P5 剩余**：整包收口（registry completed / AUDIT-LOG / plan 回写）。

### 其他

- **BLOCK-78/79**：并行会话完成（本会话未触碰），均 completed + verified
- **🟢 清债**：前端全量 vitest 974/974 首次全绿（4 项修复，AUDIT-LOG 三条 🟢 闭环）
- **SKILL 沉淀**：`gewu-dev-infra/SKILL.md` 新增「Windows/中文实机脚本纪律」6 条规则

## 二、关键技术决策与教训

| 决策/教训 | 详情 |
|---|---|
| 意图卡文件形态 | `.gewu/resident/<taskId>.json`，与本地项目 results/jobs 同构（R1 用户裁决） |
| 交接班双通道 | A: proactive 任务条；B: agent 会话 systemPrompt 注入 digest（R6 用户裁决） |
| MAX_ARG_STRLEN | Linux 单参数 128KB，gateway 名义 1MB 载荷 >98KB 即 E2BIG，全链 64KB 分块 |
| Windows argv 32KB | thin per-call 大参数 ENAMETOOLONG，mux stdin 是唯一通道 |
| .ps1 ASCII-only | PowerShell 5.1 无 BOM 按 ANSI 解析，中文注释炸 here-string |
| CDP Input.insertText | CodeMirror 场景不达（焦点丢失误落聊天框），改 cm.focus()+execCommand |
| dell 嵌套 ProxyJump | 隧道间歇中断（mux 写入黑洞），3 次退避重试扛不住持续窗口——切 aliyun |

## 三、当前仓库状态

- **分支**：main
- **工作区**：干净
- **未推送**：0（全部已推）
- **active 工作包**：BLOCK-77（P4 待跑）
- **排队**：BLOCK-68（注册表漂移已修）/ AGENT-WORKBENCH / G0-RS / G0-SDC / BLOCK-70
- **🟢 未决**：DIST-STALENESS 1 条（G1+ 纪律保持登记）

## 四、BLOCK-77 P4 恢复指引

1. 确认 dev 栈在跑（`npm run state` + 3001/9222 端口）
2. 确认 aliyun SSH 可达（`ssh aliyun 'echo ok'`）
3. 跑 `node scripts/block77-p4-live.cjs phase1`（aliyun 建项目 + 真实模型对话挂机）
4. 关软件：`powershell block76-clean-stack.ps1` → `cmd start start-dev-stack.cmd`
5. 跑 `node scripts/block77-p4-live.cjs phase2`（交接班双通道 + 异常路径 + 手动停止）
6. P5 收口：registry completed / AUDIT-LOG / plan 回写 / closeout 四门禁

## 五、文件索引

| 文件 | 用途 |
|---|---|
| `core/biof3-server/helpers/remote-execution/ssh-direct-runner.js` | 直跑执行器 |
| `core/biof3-server/helpers/remote-execution/job-output-reader.js` | 产物统一读取器 |
| `core/biof3-server/helpers/remote-execution/resident-revisit.js` | 回访循环 + 交接班摘要 |
| `core/biof3-server/agent-tools/workspace-ssh-surface.js` | ssh surface（驻留创建 + 传输重试） |
| `scripts/block77-p4-live.cjs` | P4 全链验收脚本（aliyun 版，两阶段） |
| `scripts/lib-block75-os.cjs` | EnumWindows 窗口定位（BLOCK-75 遗产） |
| `test/block77-resident-tasks.test.mjs` | 驻留工具定义契约测试 |
| `test/ipc-relative-requires.test.mjs` | 抽取家族路径漂移门禁 |
| `docs/block-76-ssh-native-execution-plan.md` | BLOCK-76 canonical plan |
| `docs/block-77-resident-tasks-plan.md` | BLOCK-77 canonical plan |
| `docs/block-77-p0-design-review.md` | BLOCK-77 P0 评审稿 confirmed |
