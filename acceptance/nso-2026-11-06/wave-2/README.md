# NSO Wave-2 证据目录（BLOCK-360 · 2026-11-06）

> plan：`docs/block-360-nso-w2-plan.md`（§4 交付与移交）。环境：darwin-arm64 / Node v24.16.0。
> 工作树含两组他方在制（均零触碰）：会话起始 22M+10?? 在制批；并发写入者的模型偏好 UI（12 项，10:01 起）。

## 交付（红绿先行，红测证据见各契约首跑输出）

| 项 | 契约 | 红（修前） | 绿（修后） | 提交 |
| --- | --- | --- | --- | --- |
| 全局 IPC sender 信任门 | `test/nso-w2-ipc-trust.test.mjs` | 模块缺失 | 7/7 | 2d5bce4f |
| workspace 根反查 | `test/nso-w2-workspace-roots.test.mjs` | 未登记 root 可写 | 4/4 | 2d5bce4f |
| IPC 双向集合相等门 | `test/ipc-channels-registry.test.mjs` | glob 预演抓到 desktop-shell 两处手写通道 | 8/8 | 2d5bce4f |
| exec 令牌收窄（F-04） | `test/nso-w2-exec-token.test.mjs` | 4/4 红：env 令牌 printenv 可读回；严格模式拼令牌可执行 rm；风险不进结果 | 4/4 + 相邻 6 套件 62/62 | 2d5bce4f |
| DB 策略单源 + 迁移定序 + 退出收敛 | `test/nso-w2-db-single-source.test.mjs` | 模块缺失 | 8/8 | 741d095e |
| MCP registry 降级可见 | `test/nso-w2-mcp-health.test.mjs` | getRegistryHealth 缺失 | 3/3 + MCP 26 套件 184/0/9skip | 64a6c99f |

## 收口门禁（当前树，`closeout-current-tree.log`）

closeout 在 test:changed 门 FAIL（未 SKIP、未放宽）：1973 测 / 1954 过 / 6 红 / 7 取消。红项归因：
- 在制批绑定：`block325 model-surface`、`g0-rs-p6`（P6 源文件含在制批 3 个）
- 兄弟仓 C-46：`p4r-invariants`（1 红 + 7 取消）
- 并发写入者的 UI 台账改动：`BLOCK-332` ×2
- 存量环境项：`NEXT-03`（W0 全量分片已红）
- **本波自查抓到并已修复**：`BLOCK-326 ③`——W0 改写 state 槽位语义后，在「无 active 工作包、仅常驻计划」时打印「当前无 active 工作包」，违反 BLOCK-326 不漏报不变量；改为「串行槽位空闲；常驻计划见 🔵 行」，契约 5/5 复绿。

## 移交（未完成，不宣称完成）

- W2-5 执行边界 capability token：撞「外部 MCP 主体档位协商」未决设计点（BLOCK-346 T5 同源 reopen；AUDIT-LOG 🟡 已恢复）。
- W2-7 revision/manifest 链哈希：数据模型变更（新列 + 回填 + 导出格式），单独成批。

## Jev 决策接点（cloud，未降级）

doc:suggest → uiAudit+planDoc（W2 无 UI 面改动，ui:audit:check 硬规则通过，uiAudit 不适用）；output:judge → fit=3.35 PASS；next:suggest → NSO-W4（0.62）。
