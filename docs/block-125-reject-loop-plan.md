---
capability: reject-loop-fix
goal: 审阅面板拒绝改动后，agent 在下一轮对话能真实看到拒绝清单并据此调整——reject→agent 回路在全部运行拓扑（主实例/测试实例/独立后端）下闭环
acceptance:
  - 红绿先行：目录解析优先级契约（LOCAL_DATA_DIR 优先 / USER_DATA_DIR 回退 / 双缺失 null）先落失败测试再实现
  - 读写两侧收敛同一共享目录（BIOF3_LOCAL_DATA_DIR），存量 11 条 system-prompt-rejects 契约零回归
  - 实机走查：测试实例 CDP 拒绝 → :3001 下一轮 agent 回答引用被拒文件，证据落 acceptance/block-125/
reopen: 用户裁决拓扑策略回摆（如测试实例改独立后端）时重审
status: completed
---

# BLOCK-125 — C-17a reject→agent 回路修复（拓扑脑裂清偿）

> 立项：2026-09-26（队列逐推模式第一项；用户裁决「按顺序逐个推进」）。当日收口 completed：红绿 15/15 绿 + 实机走查 allPass（agent 精确引用被拒文件+hunk+建议，acceptance/block-125/reject-loop-live.json）。
> 并行隔离：UI-448 会话（SimpleChat/SideChatDock/CenterPanel 面）同窗活跃，其提交 4b0916cc 亦声明本包在制面零触碰——双向隔离留痕；code-size working-tree-review.js +9 行台账重打待静默窗（并行 WIP 占用台账文件，BLOCK-118 先例如实归属）。

## 1. 根因（实测坐实）

| 拓扑 | 写侧（Electron main IPC） | 读侧（后端 agent-runner） | 通？ |
| --- | --- | --- | --- |
| 打包生产（单实例） | `<userData>/working-tree-review/rejects` | `BIOF3_USER_DATA_DIR=<userData>`（backend-proc-manager.js:186 注入） | ✅ |
| 主 dev 实例 | `.biof3-dev-user-data` | dev-electron spawn 时由 main 注入同目录 | ✅ |
| 测试实例（复用 :3001） | **`.biof3-test-user-data`**（实例自己的 userData；实证=已有一条匿名 .gitignore 拒绝记录躺在那） | :3001 后端由主实例 spawn→读 dev-user-data；**手起裸后端无 `BIOF3_USER_DATA_DIR`→整个跳过** | ❌ |

读侧入口：`agent-runner.js:293` 只认 `process.env.BIOF3_USER_DATA_DIR`；写侧：`src/ipc/working-tree-review.js:153/265` 硬编码 `app.getPath('userData')`。

## 2. 修法（结构性，非补丁）

读写两侧收敛到**全拓扑已共享的 `BIOF3_LOCAL_DATA_DIR`**（主实例/测试实例/独立后端三端均已设置——测试实例脚本 :73-85 显式指向 dev data 目录）：

- 新 helper `resolveWorkingTreeRejectRoot(env)`（system-prompt.js 导出）：`BIOF3_LOCAL_DATA_DIR` 优先 → `BIOF3_USER_DATA_DIR` 回退 → null。
- 写侧：`working-tree-review.js` 两处 `app.getPath('userData')` 改经 helper 解析（IPC main 进程 env 由 env-coordinator 同根设置）。
- 读侧：`agent-runner.js` 注入段改经 helper 解析。
- 30 天 TTL 临时信号，存量条目（1 条匿名测试记录）不做迁移，如实留痕自然过期。

## 3. 验收

1. 契约：`test/reject-loop-root.test.mjs`（解析优先级/写读收敛/存量 11 契约零回归）。
2. 实机：测试实例 CDP 点拒绝 → 共享目录落盘 → :3001 下一轮 agent 回答引用被拒文件（acceptance/block-125/）。
3. 门禁：定向 + test:changed + closeout 相关门。

## 4. 边界

- rejects 注入为全局（非项目级，limit 10）——BLOCK-16 既有语义，不动。
- 纯后端+Electron main 改动，零前端文件，无 UI 台账条目。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
