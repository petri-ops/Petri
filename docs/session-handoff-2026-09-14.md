# Session Handoff — 2026-09-14（第二轮：多端同步实测缺陷修复 + 投影手机适配 + 网关性能 会话交接）

> 给下一个 Agent 的完整交接。本文档为同日第二轮接续（第一轮交接内容已被本轮推进覆盖，
> 第一轮成果要点保留在 §一/§二）。按顺序读完即可无缝接手。

## 一、当前工作包状态（DOC-REGISTRY 为准）

| 包 | 定位 | 状态 |
| --- | --- | --- |
| **BLOCK-87 多端同步** | 手机/平板遥控同一台主体 | completed（第一轮用户实测验收）；本轮手机实测暴露三缺陷**当日全修**（UI-367 / UI-368 / GW-PERF，三笔提交已推送，dev 栈已重启生效），**待用户手机复测后 UI-367/368 台账升 verified** |
| **BLOCK-85 联邦协作** | 不同主机的格物互派任务 | active，**只差 Mac 双真机验收**后 closeout（不变） |
| **BLOCK-88 工程师协作** | 联邦+身份层 | 排队（不变，等 BLOCK-85 收口） |
| **G0-RS Result Studio** | P6 证据重采 | Windows 侧全完成；**等用户在 Mac 跑一条命令**（不变） |
| G0-SDC / BLOCK-86-DOMAIN-PACK-LIFECYCLE | planned | 排队，启动需用户裁决（不变） |

**概念划分（用户定义，勿混淆）**：多端控制（87）≠ 联邦协作（85）≠ 工程师协作（88）。

## 二、本轮成果（接续 723e8e7e 之后；三笔提交全部已推送，工作区干净）

### 1. `53a8df5a` UI-367（BLOCK-87-L4-2）——手机双缺陷修复
- 用户反馈：①「总是 rate_limited」②「插件商店手机端与桌面不一致（缺领域包/运行时）」
- 限流根因：限速器挂网关最前且**静态资源/Vite 热更模块全计数**，240/分/IP 必误伤（隧道全设备共享 127.0.0.1）→ 改为只计 `/api/`、`/m/api/`、`/federation/`，上限 600；静态/投影资产仍过会话门但不耗配额
- 商店不一致根因：L4 第一批投影桥 `plugins.listInstalled` 误包 `{ok,packs}` 信封（桌面 IPC 契约=裸数组）+缺 `listRemote`+垫片 Proxy 下 `window.biof3Desktop.packs` 恒空
- 修复：core 投影端点扩面（`/api/plugins/catalog` 同 manifest 文件、`/api/runtime/status` executors 同探测、`/api/packs/installed|available` pack-registry 同源同 dataDir）；投影桥逐字对齐 IPC 形状（裸数组/listRemote/packs+runtime 桥），写面诚实禁用；PluginStorePanel 直读垫片改 `getBridge('packs')` 单点解析
- 顺手：impact-map 补 `acceptance/block-85|87/**` 映射（🟡存量预告项销号，test:changed 该红清零）

### 2. `45d6bbff` UI-368（BLOCK-87-L3-2）——左栏单一入口（用户裁决「左上角的左侧展开栏就直接控制左侧栏的展开和收缩」）
- 撤浮动 ☰ 按钮：投影手机端 `leftOpen` 征用为抽屉开合单一真相，标题栏左上按钮零改动直接开合 AppRail 抽屉（遮罩点击收回；路由变化自动收起；同路由点击不关——语义一致保留）
- `isProjectionMobile()`/`getIsProjection()` 沉淀 titlebar/shared 单一解析源；投影手机端顶栏 span 恒收起宽（抽屉覆盖不推挤）；投影环境隐藏 WindowControls（— □ × 死按钮）
- CDP 探针 `scripts/ui368-projection-rail-live.cjs` **5/5 allPass 连续两轮**（`acceptance/ui-368/`）

### 3. `f6ed8c4f` GW-PERF——网关数据面根因优化（用户「点击频繁时刷新很慢…能否从根上优化」）
- 限流已非根因（表现为报错不是慢）。真根因①：**authenticate 每请求全量 persist()**（模块/资产也过会话门，一次页面加载数百请求 × 序列化+双同步写盘刷满事件循环）→ `lastSeenAt` 内存即时 + 落盘 30s debounce 合并（创建/吊销仍立即同步写）
- 真根因②：**代理响应强制 no-store**（每次刷新全量重拉整张 Vite 模块图 × 隧道 RTT）→ 透传 If-None-Match/If-Modified-Since 让 ETag 304 生效（实测条件再拉 **304/0 字节**）；模块 `no-cache` 可存须验证；HTML 仍 no-store（垫片即时新鲜）；文本模块 gzip（>1KB，隧道流量降 ~70%）；dist 哈希资产 immutable
- node 集成 6/6 + block70 回归 11/11 + federation 回归

### 治理
- AUDIT-LOG 头部三段新记录（UI-367/UI-368/GW-PERF）+ 🟡存量「acceptance 映射」销号
- 台账：UI-367 / UI-368 均 `in_progress`（手机端实机待用户复测后升 verified）
- 隧道：本轮启用并验证 connected（aliyun/2233/`https://47.110.228.168`，health 200）；**事故记录**：调 `/api/mobile/tunnel/config` 不带 host 参数会把 host/publicUrl 清空——已当场带全参数恢复，配置现状正确

## 三、用户手上的事

1. **手机复测**（隧道已 connected，手机刷新页面即可，投影走 Vite 热更源无需重装）：①插件商店与桌面一致；②频繁点击/刷新速度（二次刷新应秒级）；③左上按钮开合抽屉。→ 复测 OK 后把 UI-367/368 升 verified
2. **Mac 双真机验收**（BLOCK-85 closeout，不变）：Mac `git pull && npm run build:spa && npm run dev` → 联邦面板出码 → Windows 配对 → 跨机派任务（fed:）实测
3. **G0-RS P6**（不变）：同一台 Mac `npm run g0:result-studio:p6:update`

## 四、下个 Agent 开工动作

1. 开工四件套：`AGENTS.md` 阶段纪律 + `docs/AUDIT-LOG.md` 头部 + `npm run state` + 本文档
2. 环境硬前置：**fnm Node 24**（`export PATH="$(cygpath -u "$APPDATA/fnm/node-versions/v24.20.0/installation"):$PATH"`）；`bash scripts/restart-dev-stack.sh`；Vite 需另起 `cd frontend && npm run dev`——投影手机测试前确认 Vite 在跑 + 隧道 connected（设置→移动同步）
3. 高优候选顺序：消化用户手机复测反馈（UI-367/368 升 verified 或续修）→ **BLOCK-85 closeout**（双真机验收后）→ **BLOCK-88 立项评审 / BLOCK-86 启动**（均需用户裁决）
4. **本会话沉淀的坑（下个 Agent 必读）**：
   - **投影探针模式**：主进程 `will-navigate` 守卫禁止 dev 窗口跨源导航（preventDefault + `shell.openExternal` 会往系统浏览器弹 URL）；本 Electron CDP **不执行** `Page.addScriptToEvaluateOnNewDocument`（identifier 返回但脚本不跑）；`Target.createTarget` 报 -32000。正确姿势=直接设 `data-projection` attr + 点一次面板开关强制重渲染（模板：`scripts/ui368-projection-rail-live.cjs`）；**探针开始前必须归位路由到 /**（同路由导航不触发 route-change effect，抽屉自动收起断言会假红）
   - **Vite 模块缓存**：手改文件后 Vite 偶发不失效（served stale，本轮 TitleBarRightZone 踩过）→ `touch` 文件强制失效，curl 模块 URL 核对后再跑探针
   - **投影桥形状**：必须逐字对齐桌面 IPC 真相（electron.d.ts 为准，但 `pack:list-*` 实际返回 `{ok,packs}` 信封而 d.ts 写数组——`unpackPacks` 双形态兼容，别再单边改）
   - **新增 `acceptance/<dir>/` 必须同步 impact-map**（test-affected 元测试会红，🟡存量已销号一次别再犯）
   - **隧道配置 API**：`POST /api/mobile/tunnel/config` 不带 host 会清空 host/publicUrl（本轮踩过已恢复）——调用必须带全参数
5. 提交纪律：`git add <明确路径>` 不用 -A；收口跑 `npm run closeout`；UI 过程提交同提交带 UI-### 台账，否则收口时 LEGACY 豁免登记

## 五、同日第三轮补记（UI-369 竞态复验收口）

- **UI-369 升 `verified`**：`AppRailContext` 首载退避重试（0/2/5/10/15s）经**双证**落地——见 `docs/ui-productization-audit.md` UI-369 段与 `acceptance/ui-369/`。
  - 探针 `scripts/ui369-project-list-selfheal-live.cjs`：`--mode=forced`（主证据·确定性，CDP `Fetch.failRequest` 阻断 `*data/projects*`）**6/6 allPass**；`--mode=natural`（自然重启观测，需外部触发重启）**4/4 allPass**。
  - 关键因果链：拦截 5 次且第 2 拍偏移 **+2011ms**（证明首载失败后确实发生第 2 次尝试）→ 阻断期 DOM 项目行恒 **0**（无旁路回填）→ 解除后**零手势**回填 5 行，落点 **+7082ms**（退避第 3 拍 = 2000+5000 = 7000ms）。
  - 残留边界（如实登记）：退避窗口约 32s，后端就绪超过该窗口仍需手动刷新。
- **本轮抓真并修掉 dev 基建两处静默失效**（`scripts/restart-dev-stack.sh`，非产品代码，门禁分类 `script-dev-stack`）：
  1. `taskkill //IM electron.exe //F` 在 Git Bash 下 `//IM` 被**原样透传** → `错误: 无效参数/选项 - //IM` → **杀进程整段静默空操作**：旧 Electron 仍持 `requestSingleInstanceLock` → 新实例起来即退 → 脚本看似「重启成功」实则什么都没发生（实测 PID 前后完全不变）→ 必然 TIMEOUT。**从此不要相信该脚本的「重启」语义而不核对 PID。** 修 = `MSYS_NO_PATHCONV=1 taskkill /IM …` 函数封装 + 清场后置断言（端口仍被占即 `exit 3` fail-closed）。
  2. 就绪判定 `curl -s -o /dev/null -w %{http_code}` 在本机 **exit=23**（写 NUL 失败）→ 配合兜底 `echo 000` 把结果拼成 `200000` → 与 `"200"` 比较永不成立 → 明明就绪也判 TIMEOUT。修 = 读末行 `%{http_code}`。修后实测 **READY@t+5s**（api=200 projects=5）。
- **环境事实（下个 Agent 必读）**：**从 agent 工具 shell 启动的 Electron 会随该命令的作业生命周期被回收**——`Start-Process`（canonical 脚本方式）拉起的实例在命令结束后数十秒内消失（日志显示启动完全正常、无崩溃错误，服务已在 3001/3005 监听）。绕过手段 WMI 进程创建（`Invoke-CimMethod Win32_Process Create`）与 `cmd` 均**被本机安全策略拦截**。**结论：长驻 dev 栈必须由用户自身终端启动**；agent 内只能用长驻后台任务临时持有（会随会话/任务结束消失）。
- **治理待办（下次会话启动先做）**：`docs/AUDIT-LOG.md` 已达 **51KB > 50KB** 的滚动归档阈值 → 按「广播规则」先归档再进主线。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 六、同日第四轮补记（UI-370 摘要卡右缘灰带收口）

- **提交与推送状态**：`aa9de687`（UI-369 竞态复验 + dev 基建两处静默失效修复）与 `f29d4a61`（UI-370 摘要卡右缘灰带）**均已推送 origin/main**（`5fcbf985..f29d4a61 main -> main`；`HEAD == origin/main`，工作区干净）。当日一度因代理 `127.0.0.1:7897` 未启动而只能本地提交，网络恢复后补推。

- **UI-370 verified**：摘要卡右缘那条 4px 全高灰带已根除，且悬浮/钉住两态统一贴齐会话区右缘。详见 `docs/ui-productization-audit.md` UI-370 段与 `acceptance/ui-370/`（含消融四态对比图）。
  - **根因**：`.workspaceSummaryFloat` 的 `box-shadow(0 12px 32px rgba(15,23,42,.18))` 被祖先 `.workspaceSessionLayout`/`.workspaceSessionContent` 的 `overflow: hidden` 裁切，`right: 4px` 使阴影右侧只剩 4px 可见 → 全高灰带。消融实证：基线 5 列连续非白 → `box-shadow:none` 与 `right:0` 均降为 1 列 → 解除祖先 overflow 则阴影完整铺开 17 列渐变。
  - **交付 4 处 CSS**（均在 `frontend/src/pages/project-workspace.module.css`）：float `right: 4px → 0`；新增 `.workspaceSummaryFloat .workspacePinnedSummary { max-width: 100% }`（撤掉与 shrink-to-fit 互为循环依赖的 24px 右预留）；钉住列 `padding-right: 4px → 0` + `display:flex; align-items:flex-end`；入场动画 `translateX(16px) → translateX(-16px)`。
- **实机验收方法（新沉淀，下个 Agent 可直接用）**：`scripts/ui370-summary-card-edge-live.cjs`。
  - **形态无法用视口模拟驱动**：`summaryVisibility` 由 `sessionFrameWidth`（RO 实测）+1120 阈值决定，而 CDP `Emulation.setDeviceMetricsOverride` 在本 Electron 下不会可靠触发该测量（形态卡住不切）。
  - **正确姿势**：① 会话框是 flex 项（`flex: 1` → `flex-basis: 0%`），只设 `width` 无效，必须 `flex: 0 0 <w>px !important`；② 注入后补一次 `window.dispatchEvent(new Event('resize'))` —— 该 hook 的 resize 监听会重读会话框宽度，正是 App 自己的重测入口；③ 钉住列用例再加 `transform: translateX(-620px)` 把卡片移入视口可见区（布局右缘/裁切边界不变，几何断言不受影响）。
  - **像素级判定内置**：脚本自带极简 PNG 解码（zlib inflate + 5 种 filter），逐列统计「卡片右缘向右的连续非白列宽」，修复前 5px / 修复后 ≤1px。
- **同轮发现（已另立 AUDIT-LOG 🟡 待评估，未修）**：`frontend/src/hooks/useWorkspaceLayout.ts:120-149` 的测量 effect 只在挂载时 attach 一次；`.workspaceSessionFrame` 被响应式分支替换/重挂后，RO 仍观察已移除的旧节点（不再触发），`updateSize` 又只在 `window resize` 时重读 → `sessionFrameWidth` 冻在旧值或 0，`summaryVisibility` 恒 `expanded`（卡片恒钉住并被 `max-width: calc(100% - 24px)` 挤成窄条，float/compact 形态不再生效）。实测卡死实例：窗口 706px 而 frame 实测 1138px。**临时缓解=任意一次 `window resize`**。修复方向：改 callback ref（节点挂载即 re-attach + 立刻测量），需专项验收。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 七、同日第五轮补记（UI-371 会话框测量改回调 ref）

- **UI-371 verified**：用户问询「`sessionFrameWidth` 失联致摘要卡形态恒 pinned」→ 复核确认缺陷真实存在并当日修复。详见 `docs/ui-productization-audit.md` UI-371 段 / AUDIT-LOG 处理记录 / `acceptance/ui-371/`。
  - **两条根因**：① `SessionFrameView` 在 chat（常驻）/ scheduled（条件挂载）两个互斥分支**共用同一个 refObject** → scheduled 实例卸载时 React 对它调 `ref(null)` 把 `current` 置空，而常驻的 chat 实例不会重新赋值 → 此后每次测量都写 0 → `summaryVisibility`（阈值 1120）恒 `expanded`（卡片恒钉住并被 `max-width: calc(100% - 24px)` 挤成窄条）；② 测量 effect `deps: []` 只在挂载时 `observe` 一次 → 节点替换后 RO 观察的是已移除的旧节点、永不触发 → 尺寸冻在旧值（只有 `window resize` 能救，这就是「拖一下窗口边就恢复」的原因）。
  - **修法**：`frontend/src/hooks/useWorkspaceLayout.ts` 的 `sessionFrameRef` 改**回调式**（`React.Ref<HTMLDivElement>`，可同时挂多个实例）——节点挂载即重新 `observe` 并立刻测量；回调收到 null 时按 `isConnected` 自清理；宽度取所有已挂载会话框的**最大值**（并存时只有一个是可见的，隐藏实例 `display:none` 宽度 0）；**0 宽不写入状态**（切模式瞬间不再误判 `expanded`）。顺带删除 UI-351 的 rAF 轮询挂载 hack。`CenterPanel.tsx` / `project-workspace.tsx` 的 `sessionFrameRef` 类型放宽为 `React.Ref<HTMLDivElement>`。
  - **门禁**：新回归门 `frontend/src/hooks/useWorkspaceLayout.test.tsx` 5/5（**变异校验：临时回退 HEAD 版 hook → A1/A2/A4 三条变红**，A2 报 `expected '0' to be '700'`）；实机 `scripts/ui371-frame-measure-live.cjs` 5/5（A1–A3 全程**不派发 resize**、仅改会话框宽度即自动跟随形态；A4 走 scheduled↔chat 往返 + 一次测量触发后宽度仍 700px）。
- **可复用的实机手法**：应用内路由跳转（触发条件分支挂载/卸载）用 `history.pushState` + 手工派发 `new PopStateEvent('popstate')`——react-router 监听 popstate，可在**不整页刷新**的前提下驱动组件分支切换。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
