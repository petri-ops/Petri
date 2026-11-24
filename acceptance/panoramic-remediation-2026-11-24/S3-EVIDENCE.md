# BLOCK-511 · S3 本机边界与加固证据（2026-11-24）

## HK-01 红→绿（全部先红后绿）

| 子项 | 修复前红 | 修复后绿 | 关键断言 |
|---|---|---|---|
| 3.1a Origin 边界 | `block511-origin-null-boundary` 2/7（null 变更无 token 放行） | 7/7 + block405/g0-chf0/m5a 共 40/40 | null/file:// 变更无 token 403、正确 token 放行、GET/无 Origin/可信 Origin 不变、未配置 token fail-closed |
| 3.1b MCP 路由 | `block511-mcp-route-origin-guard` 1/2 | 2/2 + block239/block258 共 14/14 | 10 条变更路由全挂 requireTrustedDesktopOrigin |
| 3.1c env 剥离 | `block511-child-env-sanitizer` 3/3（新模块先测后接） | 3/3 + block67/m5a/harness 共 43/43 | 凭据类剥除、其余透传、日志只写变量名；接入 client-manager 与 workspace-tools |
| 3.2 文件读取 | `working-tree-review-file-content` 4/7 | 7/7 + hunk-apply/block169 共 15/15 | 绝对路径/../符号链接越界全拒绝；realpath 校验抽 path-guard 子模块（主文件 789→775） |
| 3.2 open-path | `block511-open-path-exec-guard` 1/3 | 3/3 + nso-w2 共 14/14 | 30 类脚本/可执行扩展名 + 无扩展名可执行位拒绝；普通数据文件放行 |
| 3.3 命令风险 | `block511-command-risk-visibility` 1/4 | 4/4 + block160/nso-w2 共 13/13 | 换行/$()/; /&& 风险可见、find -delete/xargs rm、逐段首 token 剥 sudo/env 赋值 |
| 3.4 async 错误 | `block511-async-handler` 4/4（先测后接） | 4/4 + MCP 12/12 | rejection 转 next(err)、全局 5xx JSON、headersSent 不重复写 |

## 改动摘要

- `core/petri-server/bootstrap.js`：`rejectUntrustedOrigin` 对非 http(s) Origin 变更请求按 token 收口（复用 `local_request_token_required`），三条既有语义不变。
- `core/petri-server/routes/mcp-client.js`：10 条变更路由挂 `requireTrustedDesktopOrigin`；connect/disconnect 用 asyncHandler 包装。
- `core/shared-backend/child-env-sanitizer.js`（新）：凭据变量按名剥离单源；`client-manager.js`（含 cfg.env 合并后剥离 + 只记变量名日志）、`workspace-tools/internals.js` 接入。
- `src/ipc/working-tree-review/path-guard.js`（新）：realpath 最近祖先包含校验；主文件薄接线且净减 2 行（789→775，code-size 基线 --write 重打）。
- `src/ipc/file-dialog.js`：可执行关联扩展名拒绝集 + 无扩展名可执行位拦截；白名单移除脚本类扩展名。
- `command-risk-rules.js` 加 `firstTokens()`（逐段剥 sudo/env 赋值），`agent-tool-policy.js` 动态维度改用它；`workspace-tools/internals.js` 风险正则 m 标志 + 扩锚点 + find -delete/xargs rm。命中处置不变（默认放行+可见）。
- `helpers/async-handler.js`（新）+ `server-main.js` 全局错误中间件（所有路由之后）；model3d capability、mcp connect/disconnect 包装。
- **3.5 web_fetch 重绑定：遗留（plan §3.2 登记）**——逐跳校验链路保持，不削弱现有防护、不引新依赖。

## 出口门禁（S3）

- S3 指定 + 新测试 82/82 绿（block405 / g0-chf0 / env-coordinator-trusted-origins / block239 / block258 / block247 / qoder-l1l2 / 6 个新 HK-01 / working-tree-review）。
- quality:secret / quality:arch / quality:lint(0 error) / quality:types / quality:knip:check / docs:check / ui:audit:check / hygiene:check / gate:code-size / gate:tracked-consistency（新测试 stage 后）全绿。
- S3 出口 `test:changed`：全量升级模式暴露 10 存量红（tool model-surface 118→120 / BUNDLE_REGISTRY / M6-A 门基线 / P6 源绑定），本包零触碰对应文件，如实归属；`new-production-area/engine.js` 为 test-affected 元测试字符串 stdout 噪声（无真实文件），非真实 FAIL_CLOSED。

## 决策工具

- `test:suggest -- --supply=cloud`（S3 规划前）：suggestions=[]（零建议，非故障）。
