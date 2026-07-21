# UI-034 实机视觉验收

日期：2026-07-21
结论：`verified`
主模块：`W-03`

## 验收环境

- 当前 `main` 开发壳，Electron + Vite SPA，未使用 Provider 或用户科学任务生成视觉 fixture。
- fixture 覆盖运行中、等待确认、成功、失败、拒绝、耗时、截断、termination reason 与实际副作用摘要。
- rc.7 安装候选另做启动与真实只读工具调用抽查：R/Python/SPA 分别监听 3001/3004/3002；DeepSeek `deepseek-v4-flash` 实际触发 `workspace_list`（5–6 ms）与 `workspace_find`（8 ms、结果已截断），状态与开发壳卡片语义一致。

## 视觉矩阵

| 场景 | 证据 | 结果 |
| --- | --- | --- |
| 浅色宽窗、完整状态集合 | `dev-light-wide.png` | 通过 |
| 深色宽窗 | `dev-dark-wide.png` | 通过 |
| 深色窄窗、长工具名 | `dev-dark-narrow.png` | 通过 |
| 右侧栏折叠 | `dev-right-collapsed.png` | 通过 |
| task SSE 回放恢复 | `dev-replay-restored.png` | 通过 |

截图确认：长工具名不撑破卡片；成功/失败/拒绝颜色与图标可区分；等待确认不冒充已执行；耗时、截断、termination reason 与副作用摘要不被正文吞没；回放后终态不重复、不降级。

同一组截图底部还显示真实供应商/模型选择器 `DeepSeek · deepseek-v4-flash`，作为 UI-033 聊天选择器的实机证据之一。

## 门禁

- 前端 ToolResult parser/activity：7/7。
- 后端 P7-D 与脱敏回归：已纳入根测试和 `harness:phase7`。
- `npm run ui:audit:check`：通过。

`packaged-*.png` 是本轮修复前的本地探索截图，不作为 rc.7 验收依据，也不纳入提交。
