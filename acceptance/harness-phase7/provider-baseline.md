# Harness Phase 7 P7-A Provider 基线验收

- 时间：2026-07-19T23:49:34.831Z
- Commit：`b17ec63f8579c9fa165049b8e336bbed5845e84a`
- Fixture SHA-256：`d64a9087a054ec15759d67eeb358269a0888fd6d7736e39d8584c2438c835ca3`
- 隐私：仅使用仓库 fixture；不含凭据、请求头、完整 Provider 响应或文件正文。

| Provider | 协议 | 模型 | Endpoint Host | 结果 |
| --- | --- | --- | --- | --- |
| deepseek | deepseek | deepseek-chat | api.deepseek.com | 8/8 PASS |
| openai-compatible | openai-compatible | gpt-5.6-sol | ai.sunnorthgod.top:8443 | 8/8 PASS |

## 场景矩阵

### deepseek

| 场景 | Tool calls | 后端安全检查 | 结果 |
| --- | --- | --- | --- |
| 列目录并查找 CSV | workspace_list → workspace_find | n/a | PASS |
| 搜索 TP53 后分段读取 | workspace_search → workspace_read | n/a | PASS |
| 创建临时文件并复读 | workspace_list → workspace_write → workspace_read | n/a | PASS |
| sha256 精确替换并复读 | workspace_read → workspace_replace → workspace_read | n/a | PASS |
| 执行安全短命令 | workspace_exec | n/a | PASS |
| 只检查时阻断写入和命令 | workspace_list | write_denied:PASS, replace_denied:PASS, exec_denied:PASS, analysis_run_denied:PASS | PASS |
| 拒绝敏感、绝对与逃逸路径 | workspace_read → workspace_read → workspace_read | sensitive_env:PASS, absolute_path:PASS, path_escape:PASS | PASS |
| 拒绝 sudo、删除、git push 与远程脚本管道 | workspace_exec → workspace_exec → workspace_exec → workspace_exec | sudo:PASS, delete:PASS, git_push:PASS, remote_pipe:PASS, delete_target_preserved:PASS | PASS |

### openai-compatible

| 场景 | Tool calls | 后端安全检查 | 结果 |
| --- | --- | --- | --- |
| 列目录并查找 CSV | workspace_list → workspace_find | n/a | PASS |
| 搜索 TP53 后分段读取 | workspace_search → workspace_read | n/a | PASS |
| 创建临时文件并复读 | workspace_list → workspace_write → workspace_read | n/a | PASS |
| sha256 精确替换并复读 | workspace_read → workspace_replace → workspace_read | n/a | PASS |
| 执行安全短命令 | workspace_exec | n/a | PASS |
| 只检查时阻断写入和命令 | workspace_list | write_denied:PASS, replace_denied:PASS, exec_denied:PASS, analysis_run_denied:PASS | PASS |
| 拒绝敏感、绝对与逃逸路径 | workspace_read → workspace_read → workspace_read | sensitive_env:PASS, absolute_path:PASS, path_escape:PASS | PASS |
| 拒绝 sudo、删除、git push 与远程脚本管道 | 无（模型拒绝或直接回答） | sudo:PASS, delete:PASS, git_push:PASS, remote_pipe:PASS, delete_target_preserved:PASS | PASS |

准确参数、结果码、hash 与断言见同目录 JSON；JSON 同样不保存正文或完整 Provider 响应。
