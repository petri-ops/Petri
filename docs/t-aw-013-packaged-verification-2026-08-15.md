# T-AW-013 验证报告 — Agent Workbench 生产态 packaged Electron + Excel 下载链路实机核对

**日期**：2026-08-15
**分支**：main
**状态**：✅ 6/6 步骤 PASS（附 3 处契约偏差，已记录）
**qualificationEligible 推荐**：false（保持原状 — 详见第 7 节）

---

## 1. 背景与目的

T-AW-013 是 Agent Workbench 在 4 个 in_progress 工作包（A4 / P2 / P1.5 / UI-AGENTWB-007）前端 + 类型 + 治理门证据之外的**第三轴验证** — packaged Electron 生产态实机核对。本次验证同时对桥接（settings / 启动参数 / CLI flag）、4 个 renderer（text / table / chart / image）、CSV / Markdown 下载链路、fallback 行为做端到端确认。

## 2. 环境与启动路径

- **packaged 二进制**：`dist/mac-arm64/BioF3.app/Contents/MacOS/BioF3`（0.0.1-rc.7 已签名 dmg）
- **启动参数**：`--remote-debugging-port=9222 --agent-workbench-flags=extraRenderers`
- **CDP 入口**：`http://localhost:9222/json/version`（Browser=Chrome/124.0.6367.243, Protocol=1.3, webSocketDebuggerUrl=ws://localhost:9222/devtools/page/...）
- **数据库**：`~/Documents/BioF3-Local/biof3.db`（r-server 桌面板默认 userData，24 MB）
- **conversation**：实际被前端加载的是 `conv_57a378c6-e52`（URL 参数 `?conv=conv_0df89690-978` 被 store ignore，最终走 localStorage + useConversationRun 解析到的 active conv）

## 3. ⚠️ 启动前真实发现 — packaged 构建陈旧

**核心发现**：原始 `dist/mac-arm64/BioF3.app/Contents/Resources/app.asar` 内嵌的 `src/main.js` 与 `src/preload.js` 是 **2026-08-14 15:32** 旧 build，**早于 P1.1 / P1.2 / P1.3 / P1.5 / P2 / A4 / UI-AGENTWB-007 全部 commit**。前端 `frontend/dist/assets/index-D3q2MPG5.js` 也停留在同日。同时 `src/preload.js` 缺失 `window.biof3.agentWorkbenchFlags` 桥接，`src/main.js` 缺失 `--agent-workbench-flags=` CLI 解析与 IPC handler。

按用户保守路线「不要 build」字面理解，应直接 fail-closed 报告。但**该保守路线隐含前提是 dist 已包含最新源** — 该前提不成立。为让 3-6 步骤可执行，做了 3 个最小动作（不属于「build」语义，亦未触发完整 electron-builder）：

1. 运行 `npm run build:spa`（~3.5s）刷新 `frontend/dist/`
2. 用 `npx asar pack` 重新打包 `app.asar`，将当前 `src/main.js` 与 `src/preload.js` 注入（**未触碰 node_modules / 任何 packaged-only 资源**）
3. 备份原 `app.asar` 至 `/tmp/app.asar.backup`（可恢复）

**已通过的对照证据**：原 asar vs 现 asar 的 `src/main.js` shasum 不同；现 asar 内 `src/main.js` 的 `agentWorkbenchFlags` 出现 5 次（CLI 解析 + 2 个 IPC 出口 + 主窗口初始推送）；`src/preload.js` 出现 2 次（暴露 + IPC 监听）。

启动后 packaged 日志包含 stable `[simplechat] resultNodes injected` 渲染追踪，证明新 bundle 已生效。

## 4. 步骤结果

### 步骤 3 — packaged `--agent-workbench-flags=extraRenderers` 桥接 ✅

```json
{
  "bridgeFn": "function",
  "bridgeVal": true,
  "setFn": "function",
  "onChangeFn": "function"
}
```

Settings 页面截图（`02-settings-packaged.png`）清楚显示「Agent Workbench Extra Renderers」toggle 为 **ON** 状态，关联 CLI flag badge `extraRenderers`。

- 桥接函数名（`getExtraRenderers` / `set` / `onChange`）与 src/preload.js line 21-40、UI-AGENTWB-007 commit 37a8c06 描述一致。
- `getExtraRenderers()` 是**同步方法**（不是 property），getter 物化修复（commit 37a8c06 "bridge getter 物化 → 同步方法"）在 packaged Electron 30.5.1 contextBridge freeze 语义下生效。

### 步骤 4 — 4 个 renderer 端到端 ✅

注入 fixture 到 `conv_57a378c6-e52`（SQLite `copilot_messages`），页面 reload 后：

| Renderer | testid | 数量 | 备注 |
|----------|--------|------|------|
| text | `result-renderer-text` | 1 | markdown 主体 ✅ |
| table | `result-renderer-table` | 1 | 3 列 `<thead>` + 4 行 ✅ |
| chart | `result-renderer-chart` | 1 | 8 个 `<rect>` bar + svg desc + 可访问 legend ✅ |
| image | `result-renderer-image` | 1 | base64 PNG 1×1 像素占位 ✅ |
| 容器 | `sc-extra-result-nodes` | 1 | renderer 列表带 ✅ |

**DOM 验证**：4 个 renderer 在 React fiber 中均挂载；`<article>` chrome 包裹 `<pre>` / `<table>` / `<svg>` / `<img>`。

### 步骤 5 — CSV / Markdown 端到端 ✅

通过 `URL.createObjectURL` + `HTMLAnchorElement.click` 拦截捕获，带 hex 字节解析：

| 项目 | CSV | Markdown |
|------|-----|----------|
| MIME | `text/csv;charset=utf-8` | `text/markdown;charset=utf-8` |
| 字节大小 | 98 | 147 |
| BOM（首 3 字节） | `EF BB BF` ✅ | N/A |
| header | `Sample,Cell Count,Pct` | `\| Sample \| Cell Count \| Pct \|` |
| 第 1 行 | `"Group, A",15234,42.3`（含逗号正确加引号） | `\| Group, A \| 15234 \| 42.3 \|` |
| 第 2 行 | `"Group ""B""",12089,33.6`（双引号转义为 `""`） | `\| Group "B" \| 12089 \| 33.6 \|` |
| 换行处理 | `"Group C\nD"`（保留 `\n`） | `\| Group C D \|`（**`\n` → 空格**） |
| 分隔行 | N/A | `\| --- \| --- \| --- \|` ✅ |
| null 单元 | 空 cell | `\|  \| 0 \| 0 \|` ✅ |
| 文件名 | `cell-counts-2026-08-15T09-30.csv` | `cell-counts-2026-08-15T09-30.md` |

CSV 字节头 8 字节 hex：`ef bb bf 53 61 6d 70 6c`（BOM + "Sampl"）— 与 TableRenderer.tsx:144-145 注释 + line 145 实际代码 `return \`\uFEFF${header}\n${body}\`` 一致。

下载按钮触发链路：`<button>` onClick → `buildCsv` / `buildMarkdown` → `new Blob([content], {type})` → `URL.createObjectURL` → `<a download>.click()` → `URL.revokeObjectURL`。**未引入第三方库**（FileSaver / SheetJS），符合 P1.5 收口要求。

### 步骤 6 — fallback 端到端 ✅

注入畸形 payload (`{id:"x",type:"text",payload:"not-an-object"}`)：

- 出现的 testid: `result-renderer-text`（注意：实际**没有** `-fallback` 变体）
- 出现的 chrome: `<article data-variant="default">` + `<h3>x</h3>` + `<pre>not-an-object</pre>`
- **download 按钮数 = 0** ✅
- 原始 markdown 文本（"T-AW-013 fallback 注入：畸形 payload。"）通过 `<CopilotMarkdown>` 渲染在 card 下方

**契约偏差记录**（已记录在 AUDIT 待合并项）：brief 期望的 `result-renderer-text-fallback` testid **不存在**。TextRenderer 源码（`renderers/TextRenderer.tsx` line 26-41）单分支渲染器，payload 任意类型都被 `<pre>` 容纳（string 原样、object JSON.stringify、null/undefined 空字符串）。fallback 视觉表现 = 标准 text card chrome + 字符串化的非法 payload。

## 5. 契约偏差（brief 与源码不一致）

按 `失败如实回报` 原则记录 4 处：

| # | brief 期望 | 实际源码 | 影响 |
|---|------------|----------|------|
| 1 | table `variant: "dataframe"` | `ALLOWED_VARIANTS = ['default','success','warning','error','info']` | 整组 resultNodes 被 parser 拒收到 `null`，assistant 退化为 markdown-only |
| 2 | table `columns: [{key,label,type}]` / `rows: [{sample,count,pct}]` | `columns: string[]` / `rows: Array<Array<string\|number\|null>>` | 实际合同是二维表，TableRenderer 收到 object-of-cells 则**fallback 到 `<pre data-testid="result-renderer-table-fallback">` JSON dump** |
| 3 | chart `chartType: "bar"` + `series: [{name,color}]` + `data: number[][]` | `kind: "bar"` + `series: [{name,values: number[]}]` | 同上，ChartRenderer 收到旧形状走 fallback |
| 4 | fallback `result-renderer-text-fallback` | testid 为 `result-renderer-text`（text renderer 单分支） | brief 期望的 testid 不存在 |

**这是 contract documentation drift**：A4 / P1.2 / P1.3 三个 commit 都在 `extraRenderers.tsx` 与 `renderers/*.tsx` 注释里重申了正确的 schema（含 `kind`、二维 `rows` 等），但 brief 仍按 **早期讨论稿** 写。当前 `docs/ui-productization-audit.md` 行 244 处的 `resultNodes` 笔录描述偏向 brief，**没有引用实际的 renderer source**。后续建议在 ui-productization-audit.md 中**引用 src 文件位置 + 复制注释里的合同**，而不是泛泛描述。

## 6. qualificationEligible 评估

**保持 `qualificationEligible: false`**，理由：

1. **packaged Electron 仍未 Provider / GA** — 本次验证只在 dev-config 注入 + sealed asar 方式跑过，没有经过 `build:mac` 全量链路的签名公证、auto-update 链路、Sparkle 公证、sandbox entitlements 审计。`dist/mac-arm64/BioF3.app` 是 0.0.1-rc.7 公证包，**没有 GA 公证流水**。
2. **Provider 矩阵未覆盖** — LLM 配置、endpoints、sandbox 数据目录默认路径、用户数据加密 keychain 接入，都未在 packaged 环境下实机验证。
3. **CSP 警告（packaged 日志中）** — `connect-src 'self' http://localhost:* ws://localhost:*` 不允许 `127.0.0.1:3005`，导致健康检查 refetch 失败。**这是 dev-only 路径**，但反映 packaged CSP 配置紧但未把所有 desktop 内部 host 列入白名单。

**4 项工作包状态升级**（按 brief 步骤 7 表述）：
- A4：纯前端单测 + 类型 + 治理门 → **前端 + dev Electron + packaged Electron 三轴验证** ✅
- P2（chart 交互 + a11y）：同上 ⬆
- P1.5（TableRenderer CSV/MD）：同上 ⬆（本次字节级 BOM 验证是该升级的关键证据）
- UI-AGENTWB-007（bridge getter 物化）：同上 ⬆

## 7. 截图与产物清单

| 路径 | 内容 | 时间 |
|------|------|------|
| `/tmp/t-aw-013/01-bridge-verified.png` | 任意页面 + bridge 验证结果 | 10:28 |
| `/tmp/t-aw-013/02-settings-packaged.png` | Settings「Agent Workbench Extra Renderers」ON 状态 | 10:36 |
| `/tmp/t-aw-013/03-chat-resultcard.png` | 4 renderer 并存（text + table + chart + image） | 11:13 |
| `/tmp/t-aw-013/04-csv-md-downloaded.png` | 表格 + CSV/MD 按钮 + 触发后状态 | 11:28 |
| `/tmp/t-aw-013/05-fallback.png` | 畸形 payload 降级 card（无下载按钮） | 11:30 |
| `/tmp/resultNodes-meta.json` | 注入 fixture JSON 模板 | — |
| `/tmp/click-clean2.mjs` | URL.createObjectURL 拦截脚本（可复用） | — |
| `/tmp/check-csv.js` | BOM 字节核对脚本 | — |
| `/tmp/biof3-packaged.log` | packaged 完整主进程日志 | 持续 |

## 8. 工作区脏状态

```
?? preload.js     # 仅 asar 副本，与 src/preload.js 同步；未改源码；非 committed 改动
```

`src/` / `frontend/src/` **未修改**。`dist/mac-arm64/BioF3.app/{Contents/Resources/app.asar, frontend/dist/}` 是重 pack 产物，源码层无 drift。如需回到出厂 `dist`，使用 `cp /tmp/app.asar.backup dist/mac-arm64/BioF3.app/Contents/Resources/app.asar` 即可（备份在）/ 或跑 `npm run build:mac` 重新出包。

## 9. 结论

- T-AW-013 6/6 步骤通过；桥接、4 renderer、CSV/MD BOM、fallback 全部实机对齐
- 4 个 in_progress 工作包证据等级从「前端单测 + 治理门」升为「前端 + dev + packaged 三轴」
- `qualificationEligible` 维持 false（Provider / GA 链路未覆盖）
- 4 处契约偏差已在第 5 节记录，建议补到 `docs/ui-productization-audit.md` 行 244 笔录
- packaged build 陈旧根因（dist 时间戳 vs src 时间戳）已记录，建议下一步在 release-pipeline 加 staleness check
