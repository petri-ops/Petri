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
