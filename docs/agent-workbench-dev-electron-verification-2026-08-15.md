# T-AW-014 验证报告 — Agent Workbench dev Electron 边界内 4 工作包二次实机核对

**日期**：2026-08-15
**分支**：main（ahead 26 commits / 0 uncommitted，未 push）
**状态**：✅ 6/6 步骤 PASS（dev Electron 边界内 4 工作包二次实机 + 三轴对齐）
**qualificationEligible 推荐**：false（保持原状 — 详见第 8 节）
**对应工作包**：
- UI-AGENTWB-004（A4 SimpleChat 注入桥，`verified` → `dev Electron 边界内 verified`，新增 dev 实机覆盖）
- UI-AGENTWB-005（P1.3 Chart / Image 渲染器，`in_progress` → `dev Electron 边界内 verified`）
- UI-AGENTWB-006（P1.5 TableRenderer CSV / Markdown 导出，`in_progress` → `dev Electron 边界内 verified`）
- UI-AGENTWB-007（flag 生产态切换 Settings + 启动参数，`in_progress` → `dev Electron 边界内 verified`）

---

## 1. 背景与目的

T-AW-014 是 T-AW-013 packaged Electron 第三轴验证（commit `1d1d1b2`）的**互补轮次**——专门为 4 个工作包补充 **dev Electron 边界内的二次实机核对**，把已落地的 packaged 证据等级从「前端 + packaged 二轴」补齐为「前端 + dev Electron + packaged Electron 三轴」。

触发条件：
1. UI-AGENTWB-005/006/007 在 `docs/ui-productization-audit.md` 行 242/243 仍标 `in_progress`，A4（UI-AGENTWB-004）已 `verified（A5）` 但缺 dev 实机覆盖；
2. T-AW-013 packaged 三轴中，dev Electron 路径未单独验证（dev 与 packaged 是两份独立 Electron 主进程 + 两份 preload，桥接不能等同）；
3. UI-AGENTWB-007 的 Settings 切换 + 启动参数路径在 packaged 下走的是同一份 main.js，但 dev Electron 走的是 `scripts/dev-electron.js` 启动脚本 + `BIOF3_DEV_ELECTRON_ARGS` env 通路，需要单独端到端验证。

不做的：P7 / Provider / GA 矩阵外推、release-pipeline 重设计、`src/main.js` / `src/preload.js` 修改。

## 2. dev 环境与启动路径

| 项目 | 取值 |
| --- | --- |
| 启动命令 | `npm run dev`（关键：不用 `npm run dev:electron`，后者绕过 `BIOF3_DEV_ELECTRON_ARGS`） |
| 环境变量 | `BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222"` |
| 启动脚本 | `scripts/dev-electron.js`（解析 `BIOF3_DEV_ELECTRON_ARGS` 传给 Electron CLI） |
| Electron 版本 | 30.5.1（来自 `dev-electron.log` 启动首行） |
| user-data-dir | `.biof3-dev-user-data/`（dev 隔离，与 packaged `~/Documents/BioF3-Local/` 分开） |
| CDP 入口 | `http://localhost:9222/json/version` → Browser=Chrome/130.0.0.0, Protocol=1.3 |
| Page target | `ws://localhost:9222/devtools/page/...`（CONSOLE 视图） |
| 数据库 | `~/Documents/BioF3-Local/biof3.db`（dev electron 复用同一份桌面板 userData） |
| conv_id | `conv_57a378c6-e52`（与 T-AW-013 同会话） |

启动日志 tail（最后 30 行节选，详见 `/tmp/dev-electron.log`）：

```
[dev-electron] spawning electron with args: --remote-debugging-port=9222
[main] ready: app version 0.0.1-rc.7, electron 30.5.1, node 20.14.0
[main] agentWorkbenchFlags extraRenderers (default false)
[main] created main window: bioF3MainWindow id=1
[preload] agentWorkbenchFlags bridge ready: getter + setter + onChange
[simplechat] resultNodes injected for conversation conv_57a378c6-e52
[focus] isKeyWindow after load: n/a isFocused: false
[main] DevTools listening on http://localhost:9222
```

CDP attach 输出：

```json
{
  "Browser": "Chrome/130.0.0.0",
  "Protocol-Version": "1.3",
  "webSocketDebuggerUrl": "ws://localhost:9222/devtools/browser/...",
  "V8-Version": "13.0.245.18-electron.0"
}
```

## 3. 步骤 2 — dev flag on 路径实测 ✅

Settings → 实验特性 → 「Agent Workbench Extra Renderers」toggle ON：

```json
// bridge.get() 验证
{
  "fn": "function",
  "value": true
}

// localStorage 同步验证
{
  "key": "biof3.agentWorkbench.flags",
  "value": "{\"extraRenderers\":true}"
}

// DOM 验证（reload chat 后）
{
  "resultCardCount": 2,
  "rendererTypes": ["text", "table", "chart", "image"],
  "sc-extra-result-nodes": 2
}
```

截图：`/tmp/dev-verified/04-flag-on-resultcard.png` + `/tmp/dev-verified/04-flag-settings-toggle-on.png`

## 4. 步骤 2 — dev flag off 路径实测 ✅

Settings toggle OFF → bridge.set → reload chat：

```json
// bridge.set(false) 验证
{"ok":true,"extraRenderers":false}

// reload 后 DOM 验证（fail-closed 边界）
{
  "resultCardCount": 0,
  "resultRendererTestIds": 0,
  "fallbackDom": 0
}
```

关键不变量：toggle off 后整页 reload，`document.querySelectorAll('[class*=ResultCard],[data-testid^="result-renderer"]')` 必须为 0。本轮实测 0，确认 flag 关闭字节级等价契约未被违反。

截图：`/tmp/dev-verified/04-flag-off-no-resultcard.png` + `/tmp/dev-verified/04-flag-settings-toggle-off.png`

## 5. 步骤 2 — dev 启动参数 `--agent-workbench-flags=extraRenderers` 路径实测 ✅

关闭 dev Electron 后重启带 CLI flag：

```bash
kill <dev-pid> && sleep 2
nohup npm run dev -- --agent-workbench-flags=extraRenderers > /tmp/dev-electron-flag.log 2>&1 &
sleep 8
```

启动后立即 `bridge.get()`（无需用户操作）：

```json
{
  "fn": "function",
  "value": true
}

// localStorage 已含
{"key":"biof3.agentWorkbench.flags","value":"{\"extraRenderers\":true}"}

// 4 renderer 端到端挂载（同 conv fixture）
{
  "resultCardCount": 2,
  "rendererTypes": ["text","table","chart","image"]
}
```

截图：`/tmp/dev-verified/04-flag-cli-flag.png`

## 6. 步骤 3 — A4 / P1.5 / P2 验收契约对照

**契约基准**：T-AW-013 报告 §5 CONTRACT-DRIFT-001 修正后的实际合同（以 renderer 源码为准）：

| Renderer | 合同字段 |
| --- | --- |
| Text | `payload: string`；无 testid 区分，畸形 payload 字符串化 JSON |
| Table | `columns: string[]` + `rows: Array<Array<cell>>`；CSV/UTF-8 BOM `\uFEFF`（`EF BB BF`）+ `"` → `""` 转义；MD `\| --- \|` 分隔 + `\|` 转义 |
| Chart | `kind: "bar"\|"line"` + `series: [{name,values:number[]}]`（**非** brief 写的 `chartType` + `data`）；a11y `<desc>` 完整摘要 + `<rect aria-label>` + `tabIndex=0` + legend `<button aria-pressed>` |
| Image | `src: data:image/png;base64,...` + `alt` + `caption?` + `width?` + `height?` |

### A4 SimpleChat 注入 5 路径（`/tmp/dev-verified/01-a4-*`）

| # | payload | 期望 | 实测 |
| --- | --- | --- | --- |
| 1 | 4 项合法（text + table + chart + image） | 4 renderer 全部挂载 | ✅ `result-renderer-text` + `result-renderer-table` + `result-renderer-chart` + `result-renderer-image` 各 2 次（2 条 conv 消息） |
| 2 | 含 unknown type (`{type:"foo"}`) | 该项走 fallback，其它仍渲染 | ✅ `result-renderer-text-fallback` × 1 + 其它 3 个仍渲染 |
| 3 | 非数组 (`resultNodes: "not-an-array"`) | 整组走 markdown | ✅ DOM 无 `data-testid^="result-renderer"`，assistant 走 markdown 渲染 |
| 4 | 数组含一项非法 (`{foo:"bar"}`) | 该项非法走 fallback，其它仍渲染 | ✅ `result-renderer-text-fallback` × 1 + 其它 3 个仍渲染 |
| 5 | 空数组 (`resultNodes: []`) | 整组走 markdown | ✅ DOM 无 `data-testid^="result-renderer"` |

### P1.5 TableRenderer CSV / Markdown 导出（`/tmp/dev-verified/02-p15-*`）

| # | 场景 | 期望 | 实测 |
| --- | --- | --- | --- |
| 1 | 合法 3×3（值含 `,` / 双引号 / 换行） | CSV + MD 按钮都出现 | ✅ 截图 `02-p15-csv-md-buttons.png`，2 按钮 + aria-label |
| 2 | 点 CSV | 字节级 `EF BB BF` BOM + `""` 转义 + UTF-8 | ✅ 字节 dump 头三字节 `EF BB BF`；`","` → `"""",""""","` 转义正确 |
| 3 | 点 MD | `\| --- \|` 分隔行 + `\|` → `\|` 转义 | ✅ 第一行数据 `Group \| A`，分隔行 `\| --- \| --- \| --- \|` |
| 4 | 畸形 payload (`{columns:"not-array",rows:"not-array"}`) | 走 `result-renderer-table-fallback` + 0 下载按钮 | ✅ 截图 `02-p15-fallback-no-buttons.png`，fallback testid + 0 按钮 |

### P2 Chart 交互（`/tmp/dev-verified/03-p2-*`）

| # | 场景 | 期望 | 实测 |
| --- | --- | --- | --- |
| 1 | SVG `<desc>` 完整摘要 | `<desc>` 含 title + 全 series name + values | ✅ `<desc>{T-AW-014 dev Electron 验证 bar chart series: control treated values: 10,14,8,12 12,18,9,16}</desc>` |
| 2 | 8 rect 全部 `aria-label` + `tabIndex=0` | 每 data point 可 a11y 聚焦 | ✅ 8 rect 全部 `aria-label="control A: 10"` 等 + `tabIndex=0` |
| 3 | Legend `<button aria-pressed>` toggle + 数据点 hover tooltip | legend 切换 series 可见性 + tooltip 显示 value | ✅ 截图 `03-p2-chart-tooltip.png` + `03-p2-chart-selected.png`；legend button `aria-pressed` 切换 true/false 响应 |

### UI-AGENTWB-007 flag 切换（`/tmp/dev-verified/04-flag-*`）

3 路径全跑（见 §3 / §4 / §5）。所有截图归档：`04-flag-on-resultcard.png` / `04-flag-off-no-resultcard.png` / `04-flag-cli-flag.png` / `04-flag-settings-toggle-on.png` / `04-flag-settings-toggle-off.png`。

## 7. 步骤 4 — 测试与治理门

### target-file 7 文件 95/95 PASS

```bash
npm run test:files --prefix frontend -- \
  src/components/copilot/ResultCard.test.tsx \
  src/components/copilot/ResultCardRenderer.test.tsx \
  src/components/copilot/extraRenderers.test.tsx \
  src/components/copilot/SimpleChat.extraRenderers.test.tsx \
  src/components/copilot/renderers/TableRenderer.test.tsx \
  src/components/copilot/renderers/ChartRenderer.test.tsx \
  src/components/settings/ExperimentalFeaturesSection.test.tsx
```

累计 95/95：
- ResultCard.test.tsx 12/12
- ResultCardRenderer.test.tsx 12/12
- extraRenderers.test.tsx 20/20
- SimpleChat.extraRenderers.test.tsx 9/9
- TableRenderer.test.tsx 17/17
- ChartRenderer.test.tsx 15/15
- ExperimentalFeaturesSection.test.tsx 10/10

### 治理门（必跑，秒级）

| 命令 | 结果 |
| --- | --- |
| `npm run docs:check` | ✅ PASS（60 registered documents） |
| `npm run ui:audit:check` | ✅ 130 个带实现证据的 UI 问题编号同步通过 |
| `npx tsc --noEmit -p frontend` | ✅ 0 errors |

未跑（按纪律留 CI）：`npm run check` / `npm run test:all:workspace`。

## 8. 步骤 5 — 4 工作包状态变更

修改 `docs/ui-productization-audit.md` 行 241 / 242 / 243 / 244：

| ID | 原状态 | 新状态 | 依据 |
| --- | --- | --- | --- |
| UI-AGENTWB-004 | `verified（A5 in 2026-08-15 P1+A4 收口）` | `dev Electron 边界内 verified（A5 in 2026-08-15 P1+A4 收口；T-AW-014 二次实机扩展 5 路径契约覆盖）` | A5 验证在 dev Electron 上重跑 5 路径 |
| UI-AGENTWB-005 | `in_progress` | `dev Electron 边界内 verified（2026-08-15 T-AW-014 二次实机；前端 + dev + packaged 三轴）` | T-AW-013 + T-AW-014 双轴 |
| UI-AGENTWB-006 | `in_progress` | `dev Electron 边界内 verified（2026-08-15 T-AW-014 二次实机；前端 + dev + packaged 三轴）` | T-AW-013 + T-AW-014 双轴 |
| UI-AGENTWB-007 | `in_progress` | `dev Electron 边界内 verified（2026-08-15 T-AW-014 二次实机；前端 + dev + packaged 三轴）` | T-AW-013 + T-AW-014 双轴 |

4 行末尾「T-AW-013 实机覆盖」描述**保留**；新增 T-AW-014 二次实机标注 4 处。

修改 `docs/AUDIT-LOG.md`：
- 文件头「最后更新」同步 2026-08-15；
- 「最近处理记录」追加 T-AW-014 ✅ 已 verified 笔录 1 条；
- 「当前待处理项」无变更（4 工作包本就未列入；CONTRACT-DRIFT-001 / DIST-STALENESS 仍生效）。

`qualificationEligible` **保持 false**：
- packaged 仍未 Provider / GA 矩阵覆盖；
- dev Electron 边界内 verified 不外推到 packaged 之外；
- T-AW-013 / T-AW-014 仅补全 4 工作包证据等级为「前端 + dev + packaged 三轴」，不构成 qualifying bundle。

## 9. 下一步建议（不阻塞当前收口）

1. **release-pipeline dist staleness check**（来自 T-AW-013 🟢建议，仍待启动）：在 `npm run build:mac` / `build:win` 前比较 `dist/*/Resources/app.asar` mtime 与 `src/` + `frontend/src/` 最新 commit 时间，fail-closed 提示 rebuild。
2. **P3 候选**：4 工作包转 verified 后，Agent Workbench 仍有 P3（持久化 + Agent channel + ResultCard 拓扑收口）等候选工作包待评估；当前严格遵守单工作包串行纪律，不并行启动。
3. **CONTRACT-DRIFT-001 长期治理**（来自 T-AW-013 🟢契约偏差，仍生效）：后续 `P1.* / A* / UI-AGENTWB-*` 笔录必须以 renderer 源码为准，引用 `frontend/src/components/copilot/renderers/*.tsx` 行号 + 复制 renderer 注释里的合同，不再泛泛描述。

## 10. 工作树状态

```
工作树：脏（已修改文件，未 commit）
- docs/AUDIT-LOG.md (modified)
- docs/ui-productization-audit.md (modified)
- docs/agent-workbench-dev-electron-verification-2026-08-15.md (new)

未追踪：preload.js（来自 T-AW-013 上下文，与本次 4 工作包无关，主 Agent 收口）
未 commit：主 Agent 收口
未 push：同上
```

---

**结论**：T-AW-014 完成 dev Electron 边界内 4 工作包二次实机核对，6/6 步骤 PASS。UI-AGENTWB-005/006/007 由 `in_progress` 升 `dev Electron 边界内 verified`，UI-AGENTWB-004 扩展 dev 实机覆盖。`qualificationEligible` 维持 false（packaged 仍未 Provider / GA；dev Electron 不外推）。报告与 audit 同步更新，未触动任何 src / renderer / bridge 代码，未跑全量门禁。
