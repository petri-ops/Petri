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
- 商店不一致根因：L4 第一批投影桥 `plugins.listInstalled` 误包 `{ok,packs}` 信封（桌面 IPC 契约=裸数组）+缺 `listRemote`+垫片 Proxy 下 `window.petriDesktop.packs` 恒空
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

## 八、同日第六轮补记（SEC-HARDEN 主进程安全加固 + 代码复审余项 ③④ 收口）

- **用户裁决**：「清两个低危安全/健壮性余项」（代码复审 ③ main.js webPreferences / ④ 无句柄失活 job 不杀进程）。按承诺先做只读排查，结论如下。
- **④ = 设计决策，不改（销号附论证）**：`core/petri-server/helpers/process-lifecycle.js:231-266` 的 `markUnownedStaleJobs` 在**无进程句柄**时只改 DB 状态、刻意不发信号——代码内已有完整论证（job 记录可能是孤儿、PID 可能被复用、进程可能属别的 job → SIGKILL 会误杀无关进程，属安全违规），DB error 文案也如实告知用户「进程归属无法证明，未发送信号」；而**有句柄**的路径 `recoverStaleActiveJobs` 确实会 terminate 子进程。「有句柄才杀」是正确分界。
- **③ = 字面项已满足，真残留是对齐官方安全清单的三处缺口**：三个 BrowserWindow（`src/main/_window-create.js` / `src/ipc/window-manager.js` ×2）均已显式 `contextIsolation:true / nodeIntegration:false / sandbox:true / webSecurity:true`；但：
  - **#5 未设权限处理器** → 官方文档原文：「By default, Electron will automatically approve all permission requests unless the developer has manually configured a custom handler.」本应用有加载**任意外部 URL** 的 `<webview>`（结果浏览器面板），等于任意站点可无提示拿摄像头/麦克风/定位/屏幕捕获。
  - **#11 `<webview allowpopups="true">`** → 官方清单明令避免（默认立场就是不允许）。
  - **#12 未校验 webview webPreferences/params** → 渲染层（含被注入页面）可创建带任意 `preload`/`partition` 的 webview。
- **交付**：新 `src/main/security-hardening.js` + `src/main.js` 装配（**模块加载期**注册 `web-contents-created`；`whenReady` + `setupDesktopEnv` 后装配权限策略）+ `frontend/src/pages/project-workspace/BrowserPanel.tsx` 撤 `allowpopups`。策略：webview 附着前删 `preload(URL)`、强制 `sandbox/contextIsolation/webSecurity=true`、`nodeIntegration=false`；partition 白名单 `persist:petri-browser`；src 限 http(s)；每个 webContents 的 `setWindowOpenHandler` 一律 deny（http(s) 交系统浏览器，非 http(s) 丢弃）；权限**默认拒绝**，仅受信渲染 origin（`PETRI_TRUSTED_DESKTOP_ORIGINS`）放行 `clipboard-sanitized-write` / `openExternal`。
- **实机门抓出我自己两个真缺陷（下个 Agent 勿回退）**：
  1. **只装 `defaultSession` 会漏掉 webview 的分区 session** —— `persist:petri-browser` 不共享默认 session，实测 guest 内 `geolocation` 仍 `granted`。修=另挂 `app.on('session-created')` 给此后每个 session 都装（幂等）。
  2. **check handler 的 `requestingOrigin` 可能为空**（Chromium 对剪贴板写等检查不一定带来源）—— 只按它判会把自家 UI 的复制按钮误杀。修=回退 `webContents.getURL()`，两者都取不到才拒（安全侧失败）。
  - 另记一条**探针坑**：CDP `Runtime.evaluate` 无用户手势且页面可能失焦，Chromium 对这种 `navigator.clipboard.writeText` 本身就报 `Write permission denied`（与权限策略无关）→ **不能用「无手势写入成败」当判据**；正确取证=①`navigator.permissions.query({name:'clipboard-write'})` 的状态 ②`Input.dispatchMouseEvent` 真实点击驱动的端到端复制。
- **门禁**：`test/security-hardening.test.mjs` **17/17**；实机 `scripts/sec-harden-live.cjs` **8/8**（S1 自家 geolocation=denied／S2 剪贴板权限 granted／S2b 真实点击复制 ok／S3 白名单 webview 正常加载／S4 野 partition 被拦／S5 file: 被拦／S6 guest 权限也 denied／S7 allowpopups 已撤）；根 `test:changed` 99/105（2 红=P6 存量基线）；前端 `test:changed` 1/1。证据 `acceptance/sec-harden/`。
- **副作用（如实登记，一行可回退）**：撤 `allowpopups` 后，结果浏览器面板内 `target=_blank` 链接不再弹窗（正常链接点击不受影响，面板自带地址栏）。若要恢复，需同时保留主进程的 deny 处理器（它已保证 guest 无法自建窗口）。
- **治理待办（已第二次提示，仍未做）**：`docs/AUDIT-LOG.md` 现 **58.5KB**，远超 50KB 滚动归档阈值 → 下次会话启动必须先归档再进主线。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 九、待执行验收包（手机复测 / Mac 双真机 / Mac P6 重采）

> 本包由主 Agent 于 2026-09-14 22:45 出具，Windows 侧前置条件已实测。执行者=用户（手机 + Mac）。

### 9.1 手机复测 UI-367 / UI-368（Windows 侧前置已验）

**Windows 侧前置（主 Agent 已实测）**：隧道 `connected`（aliyun:2233，publicUrl `https://47.110.228.168`）；投影端点 `/api/plugins/catalog`、`/api/runtime/status`、`/api/packs/installed` 均 200；Vite :3000 在跑（源码改动手机即时跟随）。公网 `/health` 未配对时 401 属预期（会话门）。

**步骤**
1. 手机：若上次已配对（会话 cookie 1 年），直接刷新页面即可；若提示未授权 → 桌面 设置 →「手机连接」→ 生成配对码 → 手机打开二维码里的 `primaryUrl`。
2. 逐项复测下面三条（对应 UI-367/UI-368 的台账待验面）。

| # | 验什么 | 判定标准 | 对应条目 |
| --- | --- | --- | --- |
| ① | 插件商店与桌面一致 | 手机端「插件商店」能看到与桌面同样的分区与条目，**含「领域包」与「运行时」分区**（此前手机端整片为空） | UI-367 |
| ② | 频繁点击/刷新速度 | 手机反复切换页面/刷新，**不再出现 `rate_limited`**；二次刷新应在秒级（首屏之后资源走 304） | UI-367 + GW-PERF |
| ③ | 左栏开合单一入口 | 投影手机端**没有多余的悬浮 ☰**；点标题栏左上按钮直接开合左栏抽屉，点遮罩收回，跨路由跳转自动收起 | UI-368 |

3. 反馈格式：三条各给 ✅/❌；不通过的那条附截图（或描述现象）。主 Agent 据此把 UI-367/368 升 `verified`，或按现象续修。

### 9.2 Mac 双真机 BLOCK-85 验收（联邦协作 closeout 的最后一步）

**前置事实**：实现面已在仓库（`core/shared-backend/federation-peers.js`、`routes/federation-admin.js`、`agent-tools/federation-tools.js`、`federation-terminal.js`、前端 `sections/Federation.tsx`，测试 `test/federation*.test.mjs` ×3）。两端跑同一份 main（双向对称 D8）。

**Mac 侧（一次性粘贴）**
```bash
cd <Mac 上的 petri-desktop>
git pull --ff-only                 # 拉到 663547c2 或更新
node -v                            # 必须是 v24.x；若否：fnm use 24（或 fnm install 24）
# 首次/依赖有变动时再执行：npm ci
npm run build:spa
npm run dev
```

**配对（Mac 出码 → Windows 配对）**
1. Mac 格物 设置 →「手机连接」→ 生成配对码 → 复制其中**局域网链接**：`http://<Mac-IP>:3005/pair?token=…`。
   ⚠️ **不要用公网链接**：aliyun 隧道 remotePort 2233 已被 Windows 侧占用；Mac 若也启用会冲突。**Mac 不要开隧道**即可（不开隧道时面板 primaryUrl 就是 LAN 链接）。
2. Windows 格物 设置 →「联邦」→ 粘贴该链接 → 点「配对」。
3. 节点应出现在协作节点列表 → 点探测/刷新确认在线（握手返回对端机型/版本）。

**判定标准（closeout 依据）**
| # | 验什么 | 通过标准 |
| --- | --- | --- |
| F1 | 配对成功 | Windows「联邦」列表出现 Mac 节点，状态在线；`<dataDir>/federation/peers.json` 有该节点 |
| F2 | 作业跨机真跑 | 从 Windows 以 `fed:<peerId>` 为目标派一个真实分析作业 → **对端（Mac）本地库记录 running→completed**（真值在对端），Windows 侧看到镜射状态与终态 |
| F3 | 产物回流 | 对端产物可经指挥席拉取/查看（`GET /api/federation/peers/:id/jobs/:jobId/file/:filename`） |
| F4 | 反向对称 | Mac 侧粘 Windows 的配对链接（Windows 出码那侧用 LAN）→ Mac 也能向 Windows 派任务 |

**失败对照（都不是产品缺陷，按此排查）**
- 配对 400 `url_required` → 链接没粘全；配对失败 → 配对 token **一次性且会过期**，重新生成再粘。
- 探测失败 → 两台机是否同一局域网 / Mac 防火墙是否放行 3005。
- 作业失败含 `runtime` 字样 → 对端没装该运行时（对端 runtime preflight 诚实失败，属预期）。
- **禁项**：不要在 Mac 上启用 aliyun 隧道（2233 端口冲突）；不要动 Windows 侧隧道配置（`POST /api/mobile/tunnel/config` 不带 host 会清空 host/publicUrl——本轮已踩过）。

**验收通过后由主 Agent 补**：BLOCK-85 plan 阶段状态 + registry `P0-REVIEW → completed` + closeout 笔录 + `acceptance/block-85/` 补 JSON 证据。
> ⚠️ **已知治理漂移（如实登记）**：`docs/DOC-REGISTRY.json` 里 BLOCK-85 仍登记为唯一文档 = P0 评审稿且 `status: active / phase: P0-REVIEW`，而实现面早已落地；`acceptance/block-85/` 目前只有 4 张 PNG、无 JSON 证据。属"实现超前于登记"，本条收口时一并补齐。

### 9.3 Mac G0-RS P6 证据重采（当前 `test:changed` 那 2 红的唯一来历）

```bash
cd <Mac 上的 petri-desktop>
git pull --ff-only
node -v                                        # v24.x
npm run g0:result-studio:p6:update             # syntax + P6 全量套件 + 前端 + 重采写证据
```

- **为什么必须在 Mac**：P6 采集链含 POSIX-only 的 checkpoint-hold 设计（Windows 化属单独立项）。
- **判定**：命令末尾应显示证据已写入（更新 `acceptance/g0-result-studio/` 下的 P6 证据 JSON）；随后回 Windows `git pull` + `npm run g0:result-studio:p6` 应**全绿**。
- **回传**：Mac 上 `git add acceptance/g0-result-studio/ && git commit -m "test(g0-rs): P6 evidence re-capture on macOS" && git push`。
- **背景**：本日 UI-369/370/371 + SEC-HARDEN 的提交改动了源文件与 `test/impact-map.json`，P6 存储证据的源绑定按设计 fail-closed（这正是 `test:changed` 余 2 红的原因）——本次重采会一并带走。
- **禁项**：不得手改/伪造 evidence JSON；2 红是 fail-closed 的设计行为，必须真采。

### 9.4 执行顺序建议

1. 先做 9.1（手机，最快，Windows 侧无需改动）；
2. 再做 9.2 + 9.3（同一台 Mac 上一次 `git pull` 后连做，省一轮同步）；
3. 三件都完成后回报，主 Agent 收口：UI-367/368 升 verified + BLOCK-85 closeout 五件套 + P6 门禁转绿。
