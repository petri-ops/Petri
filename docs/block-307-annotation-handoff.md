# BLOCK-307 批注交互 · 交接文档（2026-10-28）

> 目的：把「批注」这条线完整交给下一个 Agent 继续。本文件是**唯一入口**——先读这里，再按 §7 恢复状态。
> 阶段纪律：G0 开发期（不外推 packaged / Provider / GA / 远程发布）。单工作包串行。

---

## 0. 一句话现状

已完成并提交 **BLOCK-303/304/305/306/307** 五个包（箭头真形态、prompt 路径溯源、形状透明淡染、标题栏菜单修复、批注交互四条），全部 closeout 十三门 PASS + 实机证据落 acceptance/。
**当前 HEAD = `90139858`**，工作区干净。

用户在同一条线上**追加了三条新反馈，尚未开工**（§3）——这是下一位 Agent 的开工面。

---

## 1. 交付结果速览（本会话）

| 包 | UI 台账 | 内容 | 证据 |
| --- | --- | --- | --- |
| BLOCK-303 | UI-603 verified | 箭头真形态（两点 path + 贴合方向头部，三态所见即所得）；所有形状 draft 不再有「外部虚线框」中间态 | 契约 25/25、ancceptance/block-302/ |
| BLOCK-304 | UI-604 verified | 「加入任务」prompt 显式带工作区相对路径 + 读取指引；箭头行报真坐标 | annotations.test 2 例 + 探针 D5 |
| BLOCK-305 | UI-605 verified | 形状批注内部 12% 透明淡染（可见区域内内容），draft 同透明 | acceptance/block-303/（alpha=0.12 双态断言） |
| BLOCK-306 | UI-606 verified | 标题栏「更多工具」菜单弹出窗口右外修复（left 遗留偏移）+ 图标加号→⋯ + 小屏钳高 | acceptance/block-304/ |
| BLOCK-307 | UI-607/608/609 verified | ①✓/× 真实鼠标失效修复 ②text 开框 ③批注拖拽移动（PATCH） ④工具条列左+图片居中 | acceptance/block-305/（实机 8/8） |

改动的核心文件（下一位 Agent 必读）：

- `frontend/src/components/annotations/AnnotationOverlay.tsx` — 覆盖层：采点、渲染三态（saved / draft / pending）、就地输入框、拖拽移动手势
- `frontend/src/components/annotations/AnnotationBar.tsx` + `AnnotationBar.module.css` — 工具条（**左栏布局问题在这里**，见 §3.3）
- `frontend/src/components/annotations/AnnotationHost.module.css` — 宿主行排布局（bar 左列 + canvas 居中）
- `frontend/src/components/annotations/useAnnotationSession.ts` — 会话状态（drawing/kind/color/pending/undo/moveGeometry）
- `frontend/src/hooks/useArtifactAnnotations.ts` — 数据层（add/remove/moveGeometry）
- `frontend/src/lib/annotation-client.ts` — REST 客户端（含 `updateAnnotationGeometry`）
- `core/shared-backend/result-annotation-store.js` — store（含 `updateGeometry`）
- `core/petri-server/routes/result-studio/annotations.js` — 路由（含 `PATCH /:id/geometry`）
- `frontend/src/lib/annotations.ts` — 契约镜像（kind 词表、`arrowHeadPoints`、`smoothFreehandPathD`、`defaultAnnotationComment`、`buildAnnotationTaskPrompt`）

---

## 2. 批注现状的数据契约（改动前必看）

一条批注只能有一种定位方式（后端 fail-closed）：

| 字段 | 适用 | 说明 |
| --- | --- | --- |
| `rect` `[x,y,w,h]` 0..1 | region / ellipse / text / mosaic | 归一化矩形；**文本批注也走 rect**（拖拽或单击产生的框） |
| `path` `[x,y][]` | freehand（≥2 点）、**arrow（恰好 2 点：起点→终点）** | 相邻重复点由渲染层去重；箭头两点为 BLOCK-303 新增 |
| `anchor` | text-selection（工作区源码行锚点） | **不可拖拽**（后端 400 `anchor_not_movable`），也没有图面坐标 |

- 渲染分派：box 层（rect 族，需排除 freehand 与两点箭头）→ 箭头 SVG 层 → 画笔 SVG 层 → draft → pending。
- 拖拽移动走 `PATCH /api/result-studio/annotations/:id/geometry`，**只更新 rect/path/updated_at**，comment/color/scope 身份不变，无撤销入栈（用户未裁决撤销需求）。

---

## 3. 待办三条（用户 2026-10-28 最新反馈，尚未开工）

### 3.1 拖拽有延迟 ⚠️ 主要体感问题

**现象**：拖已存批注时，图形跟手有可感知延迟（不是完全不跟手，而是拖影/滞后）。

**根因（已定位，见 `AnnotationOverlay.tsx:290` `handleMoveDragPointerMove`）**：
每个 `pointermove` 都执行 `setMoveDrag({ ...current, dx, dy, moved })` → **整棵 overlay 重渲染**（所有 box、箭头 SVG、画笔 SVG、`moveOffsetFor` 逐项计算）。dev 模式下 React 18 StrictMode 双渲染会把这个开销放大，表现为跟手滞后。

**修法（推荐，改造点集中）**：
1. 拖拽期间**绕过 React**：`startShapeMove` 里用 `event.currentTarget`（box 的 DOM 节点）或提前存的 ref 直接写 `el.style.transform = translate(${px}px, ${px}px)`；SVG 元素写 `el.setAttribute('transform', ...)`。
2. 位移量只记在 `useRef`（`dragStateRef`），**不 setState**；`moveDrag` 这套 state 可整体删除。
3. `pointerup` 时用 ref 里累计的 `dx/dy` 归一化 → 一次 `onMoveAnnotation(id, geometry)`（现有提交逻辑可原样复用，见 `commitMoveDrag`）。
4. 加 `will-change: transform`（css 模块内，token 不涉及颜色可过 theme 门）。
5. 顺带把 `surfaceMoveHandlers`（`AnnotationOverlay.tsx:340`，每次渲染新建对象）用 `useMemo` 固化成一份。

验收断言（可直接复用现有探针的 C 段）：CDP 5 段 `mouseMoved` 拖 25%/20%，REST 读回 rect 落在平移后区间；再人工目测「跟手无滞后」。

### 3.2 箭头批注拖不动 ⚠️ 真 bug

**现象**：用户说「任何确定的批注都应该可以拖拽移动」——实测矩形/椭圆/文本/马赛克/画笔可拖，**箭头拖不动**（其实点也点不到）。

**根因（已定位，见 `AnnotationOverlay.module.css:214/218`）**：
```
.freehandLayer { pointer-events: none; }
.freehandLayer [data-testid='annotation-freehand-stroke'] { pointer-events: stroke; }
```
箭头渲染成 `<g data-testid="annotation-arrow-stroke">` 的 `line + polygon`，**没有 pointer-events 规则** → 继承父层 `none` → 永远收不到 pointerdown/click（`startShapeMove` 与 `onSelect` 都失效）。

**修法**：css 模块追加
```css
.freehandLayer [data-testid='annotation-arrow-stroke'] {
  pointer-events: all;
  cursor: move;
}
```
（`g` 上的 `pointer-events: all` 在 Chromium 对子元素生效；若想更精确可只给 `line`/`polygon` 设 `pointer-events: visibleStroke`/`visibleFill`。）

**同时确认**（用户「任何批注都能拖」的逐项清单）：
- region/ellipse/text/mosaic → box 层 `pointer-events: auto` ✅
- freehand → `pointer-events: stroke` ✅
- arrow → **修完才 ✅**
- text-selection（源码行锚点）→ 按契约不可拖（无图面坐标），保持 400，界面如实提示即可

### 3.3 左侧工具栏布局错乱 ⚠️ 截图已给

**现象（截图）**：左列窄条里，7 个形状按钮被压成 ~24px 宽，**文字逐字竖排**（「矩形」变成「矩/形」两行）；颜色三圆点一行；「加入任务」孤立在下方。

**根因（已定位，见 `AnnotationBar.module.css:53` `.kinds` 与 `AnnotationHost.module.css`）**：
BLOCK-307 把 `.bar` 改成 `flex-direction: column; width: 104px`，但 `.kinds` 仍是 `display: inline-flex`（横排）+ 无 `flex-wrap` + 按钮默认 `flex-shrink: 1` → 7 个按钮被压缩到 104px 内、每个约 24px，`white-space` 默认换行 → 逐字竖排。`.addToTask { margin-left: auto }` 在列向布局下也无意义。

**修法（推荐）**：
```css
/* 左列模式下：形状组 2 列网格、按钮不换行、bar 稍微放宽 */
.bar:not([data-mode='text']) { width: 152px; }
.bar:not([data-mode='text']) .kinds {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--petri-space-1);
  width: 100%;
}
.bar:not([data-mode='text']) .kind {
  min-width: 0;
  padding: 0 var(--petri-space-1);
  white-space: nowrap;
  text-align: center;
}
.bar:not([data-mode='text']) .swatches { width: 100%; }
.bar:not([data-mode='text']) .addToTask { margin-left: 0; width: 100%; }
```
注意：`[data-mode='text']`（工作区文本锚点面）保持**全宽横排**，上面规则已用 `:not()` 隔离。
另：`.bar:not([data-mode='text']) .hint { display: none }` 已存在（列窄放不下长提示）——若 152px 后想恢复提示，需评估换行。

**验收**：DOM 断言（可照抄 `scripts/block304-annotation-touch-live.cjs` 的 D 段）——每个 `.kind` 的 `clientWidth >= 60` 且 `scrollHeight <= clientHeight*1.2`（未换行）；bar 宽度 ≤ 170；图片相对 canvas 居中偏移 ≤ 40px。

---

## 4. 验证基础设施（下一位 Agent 直接用）

### 4.1 已就绪的探针脚本（都可直接跑）

| 脚本 | 覆盖 | 用法 |
| --- | --- | --- |
| `scripts/block298-pending-preview-live.cjs` | pending 预览（画完保持可见） | `node scripts/...` |
| `scripts/block299-inline-composer-live.cjs` | 就地输入（终点锚定/不填写默认文案/text 点击） | 同上 |
| `scripts/block300-lightbox-portal-live.cjs` | 灯箱 portal 全屏置顶 | 同上 |
| `scripts/block301-settings-rail-live.cjs` | 设置页隐藏左栏 | 同上 |
| `scripts/block302-arrow-form-live.cjs` | 箭头真形态 + prompt 路径 | 同上 |
| `scripts/block303-transparent-fill-live.cjs` | 形状透明淡染（alpha 断言） | 同上 |
| `scripts/block304-annotation-touch-live.cjs` | **本轮四条**（✓ 真实点击/text 拖拽开框/拖拽移动 PATCH/布局）——**改拖拽与布局后必须重跑** | 同上 |

证据目录：`acceptance/block-298/ ~ block-305/`（每包一个 json，部分带 clip PNG）。

### 4.2 dev 栈状态与两个必须知道的坑

- **现行状态（2026-10-28 复核，四端口全绿）**：vite `:3000` ✅、后端 `:3001` ✅（由 Electron 主进程 supervisor 拉起）、Electron 主实例 `:9222` ✅、测试实例 `:9223` ✅。
- **⚠️ 坑 1：`run_in_background` 的后台 bash 任务结束时，其进程树会被连带回收**。本会话实测两次：`restart-dev-stack.sh` 作为后台任务跑完后主实例 Electron 被杀（`9222` 变 000）；手动用 `run_in_background` 起的 `node core/petri-server/server.js` 在被 stop 后端口即空。结论：
  - **不要**用 `run_in_background` 起 dev 栈的长活进程；
  - 起 Electron 用**前台** bash 调 PowerShell `Start-Process`（分离，`scripts/restart-dev-stack.sh:163` 同款），命令见下；
  - 后端 `:3001` **交给 Electron 主进程自己的 supervisor**，不要手起（手起会与主实例 spawn 抢端口；若已手起，先用 `taskkill` 清掉 3001 再起主实例）。
- **⚠️ 坑 2：`start-test-instance.sh` 只杀 9223 监听者，不碰主实例**（脚本内有注释与幂等清场），但 `restart-dev-stack.sh` 会 `taskkill /IM electron.exe /F`（含主实例）——所以「只补起主实例」不要跑整个 restart 脚本。

补起主实例（保持 3000/3001/9223 现状不动）：
```bash
cd /d/1.WorkDir/petri
occ=$(netstat -ano | grep ':3001' | grep LISTENING | awk '{print $5}' | head -1)
[ -n "$occ" ] && MSYS_NO_PATHCONV=1 taskkill /PID "$occ" /F   # 仅当 3001 是手起进程
export PETRI_DB_PATH="$(pwd)/.petri-dev-user-data/data/petri.db"
export PETRI_LOCAL_DATA_DIR="$(pwd)/.petri-dev-user-data/data"
FNMR="/c/Users/Admin/AppData/Roaming/fnm/node-versions/v24.20.0/installation"
NODE_EXE="$(cygpath -w "$FNMR")
ode.exe"; WROOT="$(cygpath -w "$(pwd)")"
powershell -NoProfile -Command "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; Start-Process -FilePath '$NODE_EXE' -ArgumentList 'node_modules\electron\cli.js','.','--dev','--remote-debugging-port=9222' -WorkingDirectory '$WROOT' -WindowStyle Minimized -RedirectStandardOutput '$WROOT\.dev-stack-live.log' -RedirectStandardError '$WROOT\.dev-stack-err.log'"
# 健康判定：cdp 9222/list 有 page + api 200 + vite 200（同 restart-dev-stack.sh 的 READY 判据）
```
- 后端重启后**新路由才生效**（PATCH `/geometry` 需重启；纯前端改动靠 vite HMR 即可）。
- 日志：`.dev-stack-live.log` / `.dev-stack-err.log`（主实例）、`.petri-test-instance.log`（测试实例）。

### 4.3 CDP / React 事件踩坑清单（本会话血泪，避免重复踩）

1. **`setPointerCapture` 会劫持后续 click 的派发目标** → 覆盖层上的 ✓/× 永远收不到 click。修法=延迟到首次 `pointermove` 再 capture + `finish` 显式 `releasePointerCapture`（已在 BLOCK-307 落地）。
2. **`pointerdown` 里 `preventDefault()` 会阻断浏览器 mousedown/click 兼容序列** → 同址二次失效。别再往 pointerdown 里加 preventDefault。
3. **CDP trusted 鼠标在 text 采点分支存在输入管线差异**（pointerdown/click 有时不派发）；走**拖拽**（pressed→moved×N→released）最可靠。文本开框因此统一成拖拽管线。
4. 探针里**跨 JS 调用取 rect 会漂移**（页面滚动/布局位移）——坐标必须在**同一 evalJs 上下文内**现取现派发。
5. `Page.captureScreenshot` 偶发 20-30s 超时；先 `Page.enable` 再截，失败就跳过（探针已做降级）。
6. `.bar` 的 computed `backgroundColor` 在 `color-mix` 下是 `color(srgb … / 0.12)` 形态，正则解析要兼容（探针里 `alphaOf()` 已处理）。
7. 导航后要摘「上次未正常结束」横幅（找文本 `知道了` 点掉），否则挡住探针点击。

---

## 5. 治理纪律（收口必跑，缺一即不得宣布 verified）

```bash
cd frontend && npm run test:files -- src/components/annotations/ src/lib/ src/styles/theme-token-contract.test.ts
node --test test/block219-result-annotations.test.mjs      # 契约（改后端必跑）
npm run test:changed                                       # 影响范围（新增脚本/证据目录要登记 impact-map）
npm run docs:reconcile && npm run closeout                  # 十三门
```

收口顺序（本会话反复用，照抄）：
1. UI 台账 `docs/ui-productization-audit.md` 加/改条目（`in_progress` → 实机证据齐才 `verified`）
2. `test/impact-map.json` 登记新探针脚本 + 证据目录（**漏登记 test:changed 直接 exit 2**）
3. `npm run docs:reconcile` → `npm run closeout`（**PASS 才算**）
4. `docs/AUDIT-LOG.md` 追一行 ✅ 收口行（**注意：追加时别吃掉 `## 广播规则` 段头**——本会话两次踩到，audit:compact 的结构断言会拦）
5. `git add <精确路径>` → commit（标题带 `UI-###` 与 `BLOCK-###`）→ `git push origin main`

---

## 6. 其它未竟项（不属本线，但台面上有）

- **UI-594/595/596 实机腿待补跑**（Jev 连续多轮单一建议，confidence=1.00）：复用 block298~305 探针配方。
- **UI-501 / 503 / 504 / 457 待用户过目**（视觉验收）。
- **R 运行时 657MB**：用户已裁决暂缓，不许主动推。
- **批注移动撤销**：未入 undo 栈（用户未裁决；若要加，动作类型需扩 `AnnotationUndoAction`）。
- **`annotation.moveGeometry` 无乐观更新**：失败时才回滚（当前实现是「等响应再落状态」）——若 §3.1 改成绕过 React 的拖拽，建议在 pointerup 时先本地落状态再发请求，失败回滚，以减少一次往返的可感知延迟。

---

## 7. 恢复步骤（新会话开场照做）

```bash
cd /d/1.WorkDir/petri
git log --oneline -3                    # 确认 HEAD ≥ 90139858
git status --short                      # 应为干净（除 .petri-* 本地产物）
npm run state                           # 会话状态一键恢复（分支/WIP/未决项）
sed -n '1,120p' docs/block-307-annotation-handoff.md   # 本文件
sed -n '1,60p' docs/AUDIT-LOG.md        # 活跃广播与最近处理记录
```

然后按 §3.1 → §3.2 → §3.3 顺序做（拖拽延迟与箭头不可拖属同一处代码，建议一个包一起改；布局单独一个包也可）。
建议包号 **BLOCK-308**（UI-610 拖拽跟手 + 全形状可拖；UI-611 左栏布局），一个包两处 UI 也可以，按用户口径裁决。

---

## 8. 一句话给下一位

批注这条线的**数据契约、渲染、就地输入、拖拽、prompt 溯源、探针配方全部就绪**；剩下的是「手感（跟手）+ 一处 pointer-events 漏配 + 一处列布局 CSS」，都是小改动，但**每处都要用 block304 探针 + 人工目测双证**再宣布 verified。
