# UI-035、UI-054～UI-064 真实验收记录

日期：2026-07-23

主模块：W-03 Agent 会话与 W-06 项目文件工作台

环境：macOS Electron 开发壳、真实 OpenAI-compatible Provider、本地 R/Python runtime、项目 `data`

## 结论

本轮 12 个 UI 条目全部达到 `verified`。验收不是只跑单元测试：使用合成表达矩阵执行真实长任务，实际触发 DESeq2 失败、脚本修复重跑、Provider 空答复恢复、双模型 fallback、用户取消与会话重开，并在日间和夜间主题检查摘要卡、文件树及面包屑。

## 可追溯运行证据

| 场景 | taskId | 真实结果 |
|---|---|---|
| 长科学任务 | `56b09e01-58ff-49b6-9999-f7b51b1f13a0` | 134 秒、28 轮、32 次工具调用；expression-qc 成功；DESeq2 首次因小矩阵 `vst()` 失败，Agent 修改独立 R 脚本后重跑成功；22 个产物落盘并自动打开结果面板 |
| 取消与恢复 | `89a8152b-4c4b-43dc-b673-eee64e8583ea` | 4 轮、24 次工具调用期间点击停止；task 与 agent 状态均为 `cancelled`；阶段结论、工具快照和用户取消消息落库，切换再重开会话可恢复 |
| 双模型 fallback | `771730db-17d7-4a52-a764-891b529a64a0` | 13 轮、29 次工具调用；主 Profile 请求异常后真实切换 `deepseek-chat → model-1784618894530`，备用 Provider 接管并完成最终核验结论 |

另有两次真实 Provider 最终整理样本：一次连续空答复后保留全部证据并给出明确处置；一次在第 2 次无工具整理恢复，assistant meta 记录 `attempts=2, recovered=true`。

## 逐项验收

- UI-035、UI-057、UI-059：28 轮任务仅展示公开阶段结论；完整调用证据留在处理详情；消息落库后可恢复。
- UI-054：真实触发空最终答复与自动整理重试，成功和失败两条分支均有 Provider 证据。
- UI-055：任务不因固定 iteration 上限停止，持续到目标产物成立。
- UI-056：摘要卡在日间/夜间主题显示项目状态、任务、最近分析、R/Py 和资源事实，信息层级紧凑。
- UI-058：深层目录、CSV 与 R 文件类型图标、选中态及窄右栏在日间/夜间主题均正常。
- UI-060：真实覆盖工具失败诊断、最终整理失败处置和双 Provider fallback。验收中发现并修复 Electron 保存设置后分析服务缓存不刷新的跨进程问题；现在按设置文件 mtime 自动失效，无需重启即可应用模型切换。
- UI-061：完全访问模式直接运行本地分析和命令行，无确认卡；可修复失败由 Agent 自主处理。
- UI-062：深层文件只显示 `data > ui-acceptance > counts.csv` 单层顶栏；没有重复文件标题、系统打开、下载或刷新按钮。
- UI-063：真实取消进入持久终态；重开仍可见阶段和工具记录。补充修复持久消息与内存 stopped snapshot 重复渲染。
- UI-064：Provider 工具定义为 16 项，`discover_capabilities`、`act_generic`、`open_result` 均不存在；`run_tool` 成功事件直接打开结果。

## 本轮新增回归

- `test/ai-settings-cache.test.mjs`：外部进程写入模型设置后，分析服务缓存自动重新读取。
- `conversationRunStore.test.ts`：完成或取消消息持久化后清除内存快照，避免重开会话重复展示。
- Model Gateway fallback、前端类型检查、完整 Node/前端测试与构建继续作为提交门禁。

验收期间临时启用的 fallback 已恢复为用户原配置：`model_fallback_enabled=false`、空 bindings；未读取、记录或提交任何 API Key。
