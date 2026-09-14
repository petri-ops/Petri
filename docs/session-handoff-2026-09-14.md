# Session Handoff — 2026-09-14（多端同步 + 联邦协作 会话交接）

> 给下一个 Agent 的完整交接。按顺序读完即可无缝接手。

## 一、当前工作包状态（DOC-REGISTRY 为准）

| 包 | 定位 | 状态 |
| --- | --- | --- |
| **BLOCK-87 多端同步** | 手机/平板遥控同一台主体（一个主体多块屏） | **completed**（用户实测验收：投影全屏/汉堡导航/真终端/主题同步/隧道通了） |
| **BLOCK-85 联邦协作** | 不同主机的格物互派任务（机制底座全齐） | active，**只差 Mac 双真机验收**后 closeout |
| **BLOCK-88 工程师协作** | 联邦+身份层：配对带名字/任务独立归属/按项目授权 | 排队（用户已确认划分） |
| **G0-RS Result Studio** | P6 证据重采 | Windows 侧全完成；**等用户在 Mac 跑一条命令**（见下） |
| G0-SDC / 其它 | planned | 未动 |

**概念划分（用户定义，勿混淆）**：多端控制（87，一个主体多块屏）≠ 联邦协作（85，不同主机协同）≠ 工程师协作（88，联邦+身份归属授权）。

## 二、本会话成果（全部已提交推送，工作区仅剩并行会话 WIP 勿动）

### BLOCK-87 多端同步（completed）
- **L1 偏好服务端化**：`routes/user-prefs.js`（GET/PUT，dataDir/user-prefs.json）；ThemeProvider 双写+15s 轮询+回前台拉取；强调色集合必须与 accents.ts 一字不差（teal/blue/violet/rose/amber）
- **L2 消息实时镜像**：`useConversationResume` 5s 对账轮询（无活跃 run 时）；活跃 run 跳过
- **L3 移动适配**：投影+窄屏（≤767px）中栏全屏；**壳层 AppRail 转汉堡浮层**（App.tsx，开合=TitleBar 左上按钮驱动的 leftOpen）；投影标志=`data-projection` DOM 属性（**垫片 head 同步设置，勿用 window 标志**——React 挂载后读不到）
- **投影终端**（原 BLOCK-85 P4）：`federation-terminal.js` node-pty 引擎 + gateway SSE/POST 通道 + `projectionTerminalBridge.ts` 前端桥；SSH 远程会话支持（cmd.exe 包装 conpty 教训）
- **隧道自愈**：spawnTunnel 每次重连前 `remotePortSweep()` **同步**清场（必须 cpSpawnSync 阻塞——异步会与正式 ssh 竞态）；多中转服务器档案（profiles[] + 下拉切换 + 存为档案）
- **投影 Vite 热更代理**：dev 模式 gateway 把 `/`、`/@*`、`/node_modules/*`、`/src/*` 窄代理到 Vite（垫片/data-projection 照注）；Vite 不可达落回 dist。**手机投影从此与桌面同源热更，不需要 build:spa**
- 投影 HTML：每请求读盘注入 + no-store 禁缓存头（曾有启动缓存旧 HTML + 手机浏览器缓存的两次踩坑）

### BLOCK-85 联邦（P0-P4 功能全齐）
- P1 通道：`/federation/api/health` 握手 + `federation-peers.js` 指挥席注册表 + `/api/federation/peers` REST + 「联邦」面板（UI-358，左栏单入口两 tab：我的设备/协作成员）
- P2 作业管线：`/api/federation/peers/:id/jobs` 三端点（转发对端 /api/tools/run / 状态 / 产物透传）
- P2.5：`handleToolRun` 支持 `executionTargetId='fed:<peerId>'` 分派 + 「界面」按钮（projection-url 端点开对端完整投影）
- P3 Agent 委托：`delegate_to_gewu_node` 工具（对端 /api/ai/agent 独立会话 + 轮询终态回执）
- 配对语义：兑换复用有效会话（不堆积设备）+ cookie 1 年 + 面板自动出码
- **作废**：SSH 节点方案（setup-windows-ssh-node.ps1 留仓库非交付）；BLOCK-86 号被并行会话占用→多端同步包改号 BLOCK-87

### 其它
- **UI-355 销号**（compute-settings 死链 8 处删除）；**G0-RS P1 Windows 侧收尾**：7 个真实 Windows 缺陷修复（含 SEC-001 脚本桥 argv 修复、11 处验收脚本主入口守卫静默空转+扫描门 `test/script-entry-guard.test.mjs`）+ Windows 首次 R 4.5.2 引导（`.biof3-dev-user-data/data/runtimes/R`，真实 volcano 作业跑通）
- **治理**：git-sync 评估收口（AUDIT-LOG 纯化/双门禁）；ui-audit LEGACY 豁免登记 8 枚过程提交（BLOCK-85/86/87）
- **并行会话红旗**：`docs/block-86-domain-pack-lifecycle-plan.md` 未注册曾致 docs:check 红（对方已修）；工作区仍有对方 WIP（CommandCenter 重构等）**绝不清理/卷入提交**

## 三、用户手上的事（都告诉过操作步骤）

1. **Mac 双真机验收**：Mac `git pull && npm run build:spa && npm run dev` → 联邦面板出码 → Windows 协作成员粘贴配对 → 跨机派任务（fed:）实测 → **BLOCK-85 closeout**
2. **G0-RS P6**：同一台 Mac 上 `npm run g0:result-studio:p6:update`，产物提交推送即收口
3. 手机正常使用中；日常问题（重连中 255 等）已有自愈

## 四、下个 Agent 开工动作

1. 读 `AGENTS.md` 阶段纪律 + `docs/AUDIT-LOG.md` 头部 + `npm run state`
2. 环境硬前置：**fnm Node 24**（`export PATH="$(cygpath -u "$APPDATA/fnm/node-versions/v24.20.0/installation"):$PATH"`）；`bash scripts/restart-dev-stack.sh`（会杀 electron 树；Vite 需另起 `cd frontend && npm run dev`——**投影已代理 Vite，手机测试前确认 Vite 在跑**）
3. 高优候选：**BLOCK-87 L4 第二批**（aiSettings/result/runtime 桥接 HTTP 化；workingTreeReview 等桌面专属投影隐藏）；**BLOCK-85 closeout**（双真机验收后）；BLOCK-88 立项评审
4. 提交纪律：`git add <明确路径>` 不用 -A；收口跑 `npm run closeout`；UI 过程提交会被 ui-audit 抓——要么带 UI-### 同提交台账，要么收口时 LEGACY 豁免登记
