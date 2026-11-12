# BLOCK-437 · 拖入源范围门 + 真实栈实测修复

> 背景：M5-3（drag 登记根）此前被判为「需产品裁决的 U 类」，理由是判据 `adjudicateDragPath` 要求
> `registeredRoots` 命中，而 `fs/import-from` 的源路径按设计在项目根之外。本轮按最佳实践给出**可用的默认策略**
> 并落到真实路由，同时把上一轮「只跑单测、没实测」的缺口补上。

## 目标与验收标准

| ID | 目标 | 验收标准（可机械核验） |
| --- | --- | --- |
| G1 | 关闭 `fs/import-from` 的任意路径拷贝面（渲染层若被 XSS 影响可读走 `~/.ssh`、钥匙串等） | 新增 `adjudicateDragSource` 判据 + 真实路由接线；越界/设备路径/相对路径/NUL/缺失全部拒绝，合法源 200 且落地 |
| G2 | 默认策略不破坏正常拖入 | 默认允许根 = 家目录 + `os.tmpdir()` + `/tmp` + `/Volumes` + 项目工作区；`PETRI_DRAG_SOURCE_ROOTS` 可覆盖（`*` 放开） |
| G3 | 补上真实栈实测 | 无窗后端 + 临时库 + 本机 HTTP 跑通；证据落 `acceptance/m-blueprint-2026-11-11/m6a/real-stack-smoke.txt` |
| G4 | 体积棘轮合规 | `routes/files.js` 764 > 基线 708 → 抽 `helpers/content-type.js` + `helpers/drag-source-roots.js`，回落 **682**（`gate:code-size` PASS，不改基线） |

## 关键设计（含实测修正）

1. **判据分层**：`adjudicateDragPath`（已登记根内，拖出/拖放）与 `adjudicateDragSource`（任意位置拖入）语义不同，不合并。
2. **realpath 归一**：判定用 `fs.promises.realpath(source)`，允许根也 `realpathSync` —— macOS 上
   `/tmp → /private/tmp`、`os.tmpdir() → /var/folders/…` 是两棵树，不归一会**误拒**合法源（实测第一版即踩到）。
3. **`/tmp` 显式纳入**：`os.tmpdir()` 在 macOS 不等于 `/tmp`，两者都要在默认根里。
4. **设备路径拒绝**：`/dev` `/proc` `/sys` 不是用户文件，读走没有业务意义，直接 403。
5. **不做 `bytes` 上限**：`fs/import-from` 明确「无 1MB 上限、目录递归」，套用 `MAX_DRAG_BYTES=20MB` 会破坏既有设计。
6. **兼容性**：`PETRI_DRAG_SOURCE_ROOTS='*'` 显式放开，给特殊工作流留出口并在响应 hint 里写明。

## 实施清单

- `core/petri-server/agent-tools/security-boundaries.js`：新增 `adjudicateDragSource` / `DRAG_SOURCE_MAX_NAME` 并导出。
- `core/petri-server/routes/files.js`：`fs/import-from` 在 `fs.promises.cp` **之前**判定源范围；新增 `dragSourceAllowedRoots`（env 覆盖 + realpath 归一）。
- `test/m5a-production-wiring.test.mjs`：新增 2 项（判据 8 种情形 + 接线锚点/顺序断言），总数 15/15。

## 验收门（当次读数）

`node --test test/m5a-production-wiring.test.mjs` / `quality:lint`（改动文件 0 error）/ `quality:arch` /
`gate:silent-catch` / `gate:code-size` / `gate:arch-cycles` / `quality:knip:check` / `docs:check` /
`docs:reconcile` / `test:changed` / `closeout` / 实机冒烟脚本。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 补记（2026-11-12 · 对「5 项证据边界」的复核与补测）

用户质疑「为什么不测」后逐项复核，结论：**5 项中 3 项本机可测，上一轮把「我没做」写成了「做不了」**。已补测：

| 项 | 结论 | 证据 |
| --- | --- | --- |
| Electron 渲染面 | **部分验证（4/4 PASS）**：`start-test-instance.sh` 默认离屏 + `npm run verify -- app-health` → CDP target / `?test=1` 页面 / 标题 `Petri` / `#root` 已挂载；跑完 trap 杀 3000·3001·9223，三端口已 free | `acceptance/dev-verify/app-health-live-darwin.json` |
| MCP 实际连接 | **已实连**：自建零依赖最小 MCP stdio server（initialize/tools/list）→ 注册 → connect 返回 `toolCount:1`、`status=connected`；注入硬化 `args` 含 `;` → `MCP_ARGS_SHELL_METACHAR`；未设白名单 env 时任意已装命令仍可用（回归面） | `m6a/verification-matrix.json` |
| zip 失败清理 | **已在真实解压器验证**：手写 stored zip 构造 `../evil.txt` 穿越条目 → 被拒、`destDir` 已清理、无越界写入；对照合法 zip `entries=1` 落地 | 同上 |
| gen-ui 帧导航 | **仅单测**（4 类分级 + userinfo）；真实触发需页面内有 gen-ui 卡片 iframe 导航 → 补腿=新增 dev-verify flow 注入卡片并断言 `genUi:sandbox-hijacked` | 同上 |
| 真实模型 loop | **G0 不可测**（需 Provider 凭据/计费，属 G1+）；mock provider 的 30 轮 loop 与 1000 轮 fixture 已覆盖 | `m2/m4` 证据 |

教训：标注「证据边界」前必须先区分「违反了阶段纪律」与「我只是没做」。

G0 开发期常态 · 不外推 packaged/Provider/GA。
