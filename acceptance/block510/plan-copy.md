---
capability: block510-tool-call-reliability
status: completed
phase: CLOSED
goal: 工具调用可靠性（用户实证三错误：①exec→unknown_tool ②`set -e cmd` 静默跳过 ③自建 cdp.mjs 封装链式崩）——先理清根因分类与 deepseek/ZCode harness 对标，再实施最小高价值三件（unknown_tool 相近名建议 / exec description 平台与 shell 语义补强 / 失败反馈 set -e pitfall hint），「彻底解决」中 harness 可防的部分本批闭环，模型自建脚本质量域如实划界。
acceptance:
  - 根因三链取证在案（interceptor unknown_tool 无建议 / $SHELL -lc 平台语义未告知模型 / 自建脚本 stderr 已返回属自我纠正域）
  - P1a unknown_tool 相近名建议（编辑距离≤2 或前缀/包含，top3）：HK-01 红→绿回放（禁建议即红 2→恢复 4/4）
  - P1b workspace_exec description 补平台 shell 默认/system_info 平台确认/set -e 警示/自建脚本小步验证（provider-visible）
  - P1c attachShellSemanticsHint 同形 attachCommandNotFoundHint（同步+yield 两失败路径）
  - 邻域零回归：agent-approval 14/14 + tool-defs-assembly 6/6 + harness-workspace-tools 15/15
  - P2 留票不实施：跨平台 shell 矩阵实机回归（win cmd/powershell 语义）、自建封装脚本约定深化
reopen: 新错误样本出现（类别外）或 deepseek 工具调用格式层再暴露新形态
supersedes: 无（G-04 command-not-found hint 的同形扩展）
---

# BLOCK-510 · 工具调用可靠性（2026-11-20 · 研究+P1 实施一体）

> **发令**：用户贴三连错误实录并裁决「这种错误问题很常见，需要系统评估后彻底解决，看看 deepseek harness 或者 zcode 是如何避免这种问题的。理清楚后，彻底解决」。
> **对标**：ZCode `agent-tool-relaxed-execution-policy.md` 核心思想=「本地策略不得提前截断模型工具序列；错误反馈要能支撑模型自我纠正」；左侧会话/任务右键菜单等 face 另案。DeepSeek harness 侧：工具格式错误由 API 层回传模型自我纠正（Petri 的反馈链同构，差距在反馈信息量）。

## 1. 三错误根因分类（取证在案）

| # | 实录 | 根因 | 归属域 | 处置 |
|---|---|---|---|---|
| E1 | `exec（command=ignored）→ unknown_tool` | 模型简写/幻觉工具名；interceptor 只回「未知工具: exec」**无相近名建议**（注册表里有 workspace_exec/workspace_exec_background） | harness 可防 | **P1a 已实施** |
| E2 | `set -e node cdp.mjs hover … → failed` | 命令经 `$SHELL -lc`（mac=zsh）执行；`set -e <命令>` 把命令名当 set 位置参数**静默不执行**——模型 shell 语义误区；工具描述未告知 shell 语义与平台默认 | harness 可防（描述+反馈） | **P1b+P1c 已实施** |
| E3 | 自建 `.petri-agent-tmp/cdp.mjs` 参数错→CDP -32602→poll ENOENT 链式崩 | 模型自建封装脚本自身 bug；stderr 已原样返回（反馈链闭环，模型后续自纠） | 模型自我纠正域 | harness 不越权；P1b description 加「先单独跑通脚本再串长链」指引 |

## 2. 已实施（P1，本批）

1. **P1a unknown_tool 相近名建议**：`agent-tool-interceptor.js` unknown 分支附 top3 建议（编辑距离≤2 或前缀/包含；`options.suggestToolNames` 注入点保留）；registry 新增 `listBuiltinToolNames()`。消息形如「未知工具: exec。相近已注册工具: workspace_exec, workspace_exec_background — 请改用确切名称重试」，并带 `suggestions` 结构化字段。
2. **P1b description 补强**（`tool-defs/workspace.js` workspace_exec）：Shell 语义与平台段——Windows 默认 cmd/可 powershell、macOS/Linux $SHELL；平台相关命令先 `system_info` 确认；`set -e <命令>` 误区警示；自建封装脚本先单独跑通再串链。
3. **P1c 失败 hint**：`attachShellSemanticsHint`（同 `attachCommandNotFoundHint` G-04 同形）——失败且命令匹配 `^set -e\s+\S` 时反馈附 shellSemanticsHint/note；同步+yield 两失败路径均挂。

## 3. 验证

- `test/block510-tool-call-reliability.test.mjs` **4/4**（建议向量/注入点覆盖/description 断言/hint 双路径源级断言）；HK-01 红绿回放=禁建议即红 2 failed→恢复 4/4。
- 邻域零回归：agent-approval **14/14**、block346-tool-defs-assembly **6/6**（description 改动未破装配契约）、harness-workspace-tools **15/15**。
- 证据=acceptance/block510/（本报告+测试留存）。

## 4. P2 留票（另发令，不本批）

- **跨平台 shell 矩阵实机回归**：win（cmd/powershell 语义差异实测）+ linux；本机 mac 已实证。ZCode bash-background-parity 先例可参照。
- **自建封装脚本约定深化**：.petri-agent-tmp 脚本模板/fail-fast 约定（提示工程层，收益边际，先观察 E3 类频率再定）。
- E3 类（模型自建脚本质量）明确**不修 harness**：反馈链已闭环、模型可自纠；越权防护反而截断自我纠正（ZCode relaxed policy 反例教训）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
