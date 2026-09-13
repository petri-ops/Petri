# BLOCK-70 — 手机远程同步（Mobile Sync）：扫码 → 手机浏览器直达工作区

> 状态：**completed（2026-09-13 P0–P4 全部收口：真机实测用户确认「挺好 成功啦」；P5 候选另行裁决）**
> 立项日期：2026-09-09
> truthDomain: `block-70-mobile-sync`
> UI 台账：UI-319（实现同提交登记）
> 来源：用户 2026-09-09 想法原文（§1）+ 截图澄清（§1.1）+ aliyun 中继裁决（§1.2）
> 取证来源：本机 ZCode 安装（`D:\Program Files\ZCode` Electron app.asar）静态解剖 + 项目代码调查 + `docs/next-steps-roadmap.md` 研究候选池（openclaw 解剖结论）

## 1. 用户提案与澄清

**原始提案**："ZCode 通过手机扫码就可以在远程同步当前的智能体任务、会话结果等各种信息，这是怎么实现的？我们能不能加这个能力？"

**修订 1 澄清（截图裁决）**：ZCode「移动端远程控制」弹窗左侧为「手机扫码连接」（扫码 → 手机浏览器直接打开该工作区），右侧为 Bot Channel（微信/飞书/Lark/Telegram）。用户明确：**要左侧的浏览器直连，不是右侧的 bot 聊天通道**。

**aliyun 中继裁决（修订 1 追加）**：用户确认以既有 aliyun 服务器（BLOCK-57 注册目标，公网）作为远程中继——**真远程段用用户自有服务器，不建项目运营的云服务**。

拆解为三条需求：
1. **扫码直达**——桌面端展示二维码，手机相机扫码 → 浏览器直接打开 Gewu 工作区页面（无需装 App、不走聊天软件）
2. **远程可见**——手机页面实时看到智能体任务、会话、结果（对齐 ZCode「手机已连接」体感）
3. **真远程**——不在同一 WiFi 也能用（aliyun 反向隧道）

**与候选池既有裁决的关系**：2026-09-06 研究候选池曾登记"参考不收：多通道消息网关"。本包由用户显式提议推进，**该默认立场由用户裁决推翻**——且修订 1 后范围进一步收窄为「浏览器直连」单路线，bot 通道整体降为远期候选（§6 P5）。

## 2. ZCode 机制取证结论（本机静态解剖，修订 1 更新）

左侧「手机扫码连接」= **云端 relay（中继）+ WebSocket RPC** 架构，全链路：

1. **会话建立**：桌面端主进程 `StartWebRemoteControl` IPC → 出站连接 `wss://zcode.z.ai/ws` 中继，注册 `deviceSid` + `passHash`（持久化 auth storage，重启可复用配对）
2. **二维码**：内容 = 云端托管移动页 URL（`{origin}/remote/v4`）+ 配对凭证 query（deviceSid/passHash/timestamp/deviceMid/deviceName/theme）——**手机打开的是 ZCode 云端页面**，不是桌面机直连
3. **数据面**：桌面 ⇄（出站 WSS）⇄ 云 relay ⇄（HTTPS/WSS）⇄ 手机浏览器；RPC 信封 `{type:"data", payload, client_ts, server_ts}`，带 50 条出站缓冲/超时丢弃/断连宽限计时器/`reconnect-workspace` 重连语义
4. **能力面**：`SyncWebRemoteControlWorkspaces` + `SyncWebRemoteControlTasks` 同步工作区与任务真相；手机可**控制**当前工作区（切工作区/看任务/回到任务流，`initialTaskId` 任务桥）；单 relay 会话同时只支持一个手机页面（`singlePageNote`）
5. **关键事实**：桌面不开任何入站端口——"扫码就能在任何网络看到"靠的是 **ZCode 自建云中继**。右侧 Bot Channel（微信 iLink / 飞书 / Telegram）与浏览器直连是并列的两条通道（iLink 取证见修订 0 版 plan，git 历史）

**对 Gewu 的推论**：同样体感 = 「本地直连 HTTP（同 WiFi）」+「用户自有服务器做反向隧道（真远程）」两段组合，不需要自建云服务。

## 3. 可行性结论

**可行，且 aliyun 中继方案已由用户裁决**：

- **路线 A（主路线）——移动浏览器直连**：
  - **A1 同 WiFi 直连（P1）**：后端增加 LAN 监听（`0.0.0.0` 独立端口，默认关闭）+ 一次性配对 token + 二维码（内容 = `http://<LAN-IP>:<port>/m#<token>`）+ 轻量移动 Web UI（复用既有 REST/SSE 数据面）。手机扫码即看，零第三方、零新基建
  - **A2 aliyun 反向隧道真远程（P3，用户已裁决方向）**：桌面端 `ssh -R 127.0.0.1:<port>:127.0.0.1:<local>` 出站连 aliyun，隧道钉在 aliyun **回环地址**（不开公网端口、不要求 sshd `GatewayPorts`）；aliyun 上放 nginx/Caddy 静态配置做 HTTPS 入口（Let's Encrypt 或自签+指纹 TOFU）反代到隧道端口。手机访问 `https://<aliyun>` → TLS 在 aliyun 终结 → 隧道 → 桌面。**桌面侧仍然只有出站连接**，与 BLOCK-57 安全哲学同构
- **资产复用**：BLOCK-57 `helpers/remote-execution/` 六文件通道层（ssh-transport BatchMode argv / target-registry / error-classifier）直接复用做隧道承载；aliyun/dell 双节点实机资产现成
- **风险事实（诚实登记）**：① aliyun 是用户运营的服务器——可用性/续费/安全组配置属用户侧运维，plan 不假设项目方 SLA；② 无域名时证书用自签 + QR 携带指纹（TOFU），有域名则 Let's Encrypt（P3 评审裁决）；③ 移动面经 HTTP 暴露的攻击面用「默认关闭 + 一次性配对 token + 会话可吊销」三层约束（D4）

**缺口（本包补齐）**：无 LAN/公网监听与鉴权层；无二维码生成/展示；无移动 Web UI；无隧道管理。REST/SSE 数据面完整可复用（§4）。

## 4. 代码事实基线

- **数据面（全部现成，移动页只做投影与轻控制）**：conversations/messages REST（`core/biof3-server/routes/ai-conversations.js:52-140`）；agent 任务 `GET /api/ai/agent/tasks` + `task/:id/meta` + `message/followup/cancel/resume`（`routes/ai-agent/`）；SSE `GET /api/ai/agent/task/:taskId`（`ai-agent/events.js:22`，`?afterSeq=N` 断线续传）；tool_jobs 台账（`db.js:431`）
- **服务器形态**：Express 绑 `127.0.0.1:3001`（`server.js:308`）、origin 白名单 `shared-backend/local-request-boundary.js`、零 token 鉴权（`auth.js` 仅注入 LOCAL_USER）——移动面需**新增独立监听 + 鉴权中间件**，不改本地面（本地桌面路径零行为变化）
- **权限批准链**：BLOCK-48 授权门两段式 ackToken + ai-legacy approve REST——手机批准 = 进程内调同一内部函数（对标 BLOCK-49 spawn-agent-tools 进程内直调先例，不经 HTTP 自调用）
- **任务终态摘要先例**：BLOCK-49 `buildTerminalSummary`——移动页任务卡与推送摘要复用同语义
- **SSH 通道先例**：BLOCK-57 `helpers/remote-execution/`（ssh-config 解析/ssh-transport argv 数组/error-classifier 网络退避/auth 快败/target-registry）——A2 隧道管理复用同一通道层
- **凭证先例**：`helpers/credential-store.js`（0600/Keychain）——配对 token 与会话密钥照此存储
- **设置面板挂点**：设置页 RemoteTargets 小节先例（BLOCK-57）——「手机远程」区照此模式新增

## 5. 设计裁决（D1–D10，标 ⏳ 者待 P0 评审用户确认）

- **D1 传输架构**：后端新增 `mobile-gateway` 子域（Express 独立 app 实例，独立端口 `R_MOBILE_PORT` ⏳ 默认 3005）：主后端 `127.0.0.1:3001` 不动，移动面挂独立中间件链（鉴权/限速/审计）。A1 时绑 `0.0.0.0`，A2 时可回绑 `127.0.0.1`（隧道反向接入本机回环）——同一移动面两种触达，UI 无感
- **D2 配对与二维码**：设置面板「手机远程」区（UI-319）→ 开启即生成**一次性配对 token**（短时效 ⏳ 默认 5 分钟）+ 二维码（内容 = 移动面 URL + token，LAN 显示 `http://<IP>:3005/m#...`，隧道态显示 `https://<aliyun>/m#...`）；手机首开以 token 换**会话 token**（持久），设置区可随时查看在线设备并吊销；二维码渲染用纯 JS 小依赖（倾向 `qrcode-generator` 单文件 ⏳ P0 裁决）——**全包唯一新 npm 依赖**
- **D3 单一真相红线**：移动页**只投影**既有 conversations/tasks/tool_jobs 真相 + 轻控制（发消息/批准/取消走既有内部函数），**不建第二套会话存储、DB 零新业务表**；桌面 UI 与移动页同源同门，两端看到的事实一致
- **D4 安全边界**：监听默认关闭（设置显式开启）；所有移动端点过 token 鉴权中间件 + 请求日志审计；配对 token 一次性短时效、会话 token 可吊销；限速（防 LAN 内扫描）；**权限批准不放大**（BLOCK-48 两段式原样，手机只看到"工具名+目标摘要"）；v1 不做移动端文件上传/产物下载（纯查看+轻控制，攻击面最小化）；A2 阶段 TLS 在 aliyun 终结、隧道钉回环不开公网口、SSH key-only（BLOCK-57 同门）
- **D5 移动 Web 形态**：独立轻量移动视图（`/m` 路由 + 独立 bundle，**不塞整个桌面 SPA**）：任务墙（tool_jobs/agent tasks 活跃置顶）→ 任务详情（task_events 实时流 + 终态摘要）→ 会话列表 + 会话阅读 → composer 轻控制（发消息/批准卡/取消）；手机竖屏优先，主题跟随桌面主题令牌；**不自研原生 App/小程序**
- **D6 推送语义**：v1 移动页为拉取式（打开即看，SSE 实时流）；后台推送（微信服务通知/Web Push）不做——push 通道登记 P5 候选
- **D7 aliyun 隧道（A2）**：`ssh -R 127.0.0.1:<remote>:127.0.0.1:<local>` 出站隧道（复用 ssh-transport），**钉 aliyun 回环**（免 GatewayPorts、公网面只有 nginx/Caddy 的 443）；aliyun 侧反代为静态配置（交付配置模板 + 一次性 setup 指引，属用户运维）；断线自动重连（error-classifier 网络退避）+ 状态在设置区如实呈现（未配置/隧道断开/已连接）；多台手机 ⏳ v1 单会话（对齐 ZCode singlePageNote），多端登记候选
- **D8 失败语义**：借鉴 BLOCK-57 error-classifier——LAN 不可达/隧道断开/aliyun 反代未配置 三态诚实呈现，绝不静默降级；移动面崩溃不影响本地任何功能（独立 app 实例 + 独立端口隔离）
- **D9 隐私边界**：移动页默认只在用户主动开启后可达；任务日志/会话内容经 LAN 或用户自有 aliyun（TLS），不经任何项目方服务器；无遥测
- **D10 G0 纪律**：additive 模块，关闭态既有测试零改动；新 npm 依赖仅 D2 二维码一处 ⏳；不外推 packaged/Provider/GA；aliyun 运维面（安全组/证书/域名）属用户操作，交付物含指引文档而非自动化

## 6. 阶段划分（建议 P0–P1 首包一次会话推进；P3 隧道段可单独收口）

| 阶段 | 内容 | 关键产出 |
| --- | --- | --- |
| P0 | 设计评审 + A1 PoC：`mobile-gateway` 最小监听 + 一次性 token + QR 卡（真实手机扫码打开只读任务页） | `acceptance/block-70/p0-poc.json` + 截图（token 脱敏） |
| P1 | 移动 Web 只读面：任务墙 + 任务详情实时流（SSE afterSeq 续传）+ 会话列表/阅读 + 设置区「手机远程」（配对/设备管理/吊销，UI-319） | 手机实机断言；桌面零行为变化回归 |
| P2 | 控制面：composer 轻控制（发消息/批准卡两步确认/取消）+ 权限不放大验证 | 手机发起→桌面执行→手机批准→手机收终态 |
| P3 | ✅ completed（2026-09-13）：tunnel.js 隧道管理器（出站 ssh -R 钉回环/四态/退避重连）+ REST + 面板隧道配置 + QR 公网优先 + aliyun 反代落地（代办：nginx+自签证书+443）；实机探针 8/8（aliyun 回环 curl 端到端）+ 120s 稳定 connected + **真机实测用户确认「挺好 成功啦」** | `acceptance/block-70/block70-tunnel-live.json` |
| P4 | ✅ completed（2026-09-13）：closeout 门禁绿（hygiene/docs/ui-audit/test:changed）+ UI-319 verified（真机用户确认）+ canonical 五件套回写 | `acceptance/block-70/` 全套 |
| P5 候选 | Bot Channel（微信 iLink/飞书，机制取证已在 git 历史修订 0 版）→ 需另行用户裁决；多端会话/附件下载/Web Push | 另行立项 |

## 7. 验收门（启动时可按实际裁剪范围调整）

- 零网络定向单测全绿（配对 token 换发/会话吊销/鉴权中间件/限速/隧道状态机/错误分类）
- `tsc` 0 错误；`npm run docs:check` + `npm run ui:audit:check`
- dev Electron 实机 + **真实手机扫码**断言（证据落 `acceptance/block-70/`，token/IP 脱敏）：
  1. 关闭态：`R_MOBILE_PORT` 不监听、设置区诚实空态、既有测试零改动
  2. A1：同 WiFi 扫码 → 手机浏览器打开任务墙，与桌面同源一致；未配对 token 访问被拒
  3. 吊销会话后旧手机页立即失效；一次性 token 过期不可重放
  4. P2 后：手机批准授权门成功放行且审计落 tool_jobs；取消任务两端状态一致
  5. P3 后：外网（非同 WiFi）扫码全链可用；隧道断开呈现断开态而非假在线
- UI-319 台账与实现同一提交登记

## 8. 范围外

- **不建**项目运营的云中继服务（中继 = 用户自有 aliyun；ZCode 式自建云登记远期候选）
- **不做** Bot Channel 聊天通道（微信 iLink/飞书降为 P5 候选，需另行用户裁决）；不做原生 App/小程序
- **不做** Web Push/服务通知（P5 候选）；v1 单手机会话（多端登记候选）
- **不做**移动端文件上传/产物下载/终端（纯查看+轻控制；终端远程登记候选）
- **不动**本地主后端 `127.0.0.1:3001` 绑定与 origin 白名单（移动面独立 app 实例）；**不动** agent-runner 核心循环
- aliyun 侧运维（安全组/证书/域名/nginx 配置落地）为用户操作 + 指引文档，不自动化
- G0 开发期常态 · 不外推 packaged/Provider/GA

## 9. 排队与串行

- 当前无 active 工作包；排队候选：BLOCK-67-SSH-REMOTE-PROJECT（大包）+ BLOCK-68-UI-DECLUTTER（小包）+ BLOCK-69-KNOWLEDGE-SPACE（中大包）+ 本包（中大包；P0–P1 与 P3 可分段收口）
- **与 BLOCK-67 协同**：本包 A2 隧道复用 BLOCK-57 通道层；BLOCK-67（SSH 远程项目）与其共享 ssh-transport 读面——若 67 先行，本包 P3 直接受益，无文件面冲突
- **文件面**：本包以新模块为主（`mobile-gateway/` 新建 + 移动 bundle 新建 + 设置面板新区块）；设置页与 BLOCK-57 RemoteTargets 相邻，与 BLOCK-68/69（SimpleChat/RightPanel）不相邻——串行纪律下冲突小
- 工作区现状（2026-09-09 登记时核实）：UI-315 终端块跟进 WIP（`ToolActivityList.tsx` / `simple-chat.css` 未提交）进行中，任何启动按串行纪律待其落定
- 启动顺序由用户裁决

## 9.1 实现进度（2026-09-13，夜间串行授权会话）

- **已落地（P0 A1 PoC + P1 主体）**：mobile-gateway 独立 app 实例（默认关闭 additive；一次性配对 token 5min TTL→持久会话 sessions.json 只存 sha256；鉴权中间件全局覆盖挂载读面；限速+审计）；管理 REST（status/config/pairing/qr.svg/devices/revoke）；设置区「手机远程」（UI-319 in_progress）；移动只读页 /m（任务墙/任务详情 SSE/会话阅读）。证据：集成 8/8 + 实机隔离探针 **16/16 ALL PASS**（acceptance/block-70/）+ 组件 3/3 + tsc 0。
- **P2 控制面（同日追加）**：移动页批准卡（两步确认 D4）+ 取消 + composer 发消息；窄口 `/m/api/approvals/:token/decide` 进程内直调 `db.ackToolJob`（与桌面同一函数同一 scope 校验，权限不放大）。集成 10/10 + 实机探针 **28/28 ALL PASS**（B 系列：批准/拒绝双向落库、scope 不匹配 404 权限不放大、吊销后可重配对）。
- **P3 A2 真远程（同日追加，用户裁决用 IP 不用域名）**：`mobile-gateway/tunnel.js` 隧道管理器——出站 `ssh -N -R 127.0.0.1:<remote>:127.0.0.1:<local> <host>`（BatchMode key-only / ExitOnForwardFailure / 钉回环免 GatewayPorts）+ 四态状态机（disabled/connecting/connected/reconnecting，ExitOnForwardFailure+存活阈值=connected 强启发）+ 断线固定退避重连（1s→30s cap）；REST `/api/mobile/tunnel[/config]`；配对 URL 公网优先（connected 且配 publicUrl 时）；面板加「真远程（反向隧道）」配置与三态呈现。**实机探针 8/8 ALL PASS（真实 ssh 到 aliyun）**：默认 disabled / REST 启用→connected / **aliyun 回环 curl 穿隧道打中 gateway health（转发端到端成立，无需反代即可证）** / 无凭证经隧道 401（不放大攻击面）/ 配对 URL 公网优先 / 杀 ssh 自动重连新 pid / 停用即断。aliyun 侧一次性运维交付指引 `docs/guides/mobile-tunnel-aliyun-setup.md`（自签证书+nginx 443 反代 SSE 关缓冲+安全组+排障+ZeroSSL IP 证书升级路径）。**部署补记（同日，代办用户 aliyun 运维）**：①公网入口 IP 勘正=47.110.228.168（ifconfig.me 报的是出海出口 IP，入口/出口不同）；②**实机抓真——隧道互抖**：四条 ssh.exe 共存互抢远端 2233（Windows exit 事件迟到/丢失 + 历代树杀逃逸孤儿，同族 BLOCK-77 已知行为），修复三件套=liveChildren 集合跟踪+签名清场（list-ssh-pids.ps1 按 -R 签名精确匹配，不误伤 mux 会话）+迟到 exit 守卫；修复后 120s 全程 connected 零抖动，公网 health/移动页 200，QR 公网优先。
- **诚实边界**：真实手机扫码全链与真实模型 E2E（手机发起→桌面执行→手机批准→收终态）+ dev 栈 CDP 设置区断言未执行（无人化阶梯第 2 级，待用户/待窗口）；P3 aliyun 隧道未实现。
- **⏳ 待用户**：D1-D10 评审追认（docs/block-70-p0-design-review.md）、qrcode-generator 依赖追认、真实手机实测、P2/P3 启动裁决。

## 10. 修订记录

- **修订 3（2026-09-13，用户裁决「我想要的是整个软件桌面原封不动的过来」）**：范围升级——D5 的「仅轻量移动页」边界被用户裁决推翻，新增 **P3.5 桌面投影**：网关根路径投射完整桌面 SPA（前端 dist 构建 + index.html 注入 biof3Desktop 垫片：rApiBase=/api 同源 + 万能链式 Proxy 桥，Electron 专属能力诚实降级 no-op）+ /pair?token 服务端兑换会话下发 cookie + **全量路由注册表挂载**（会话门内）。真机抓真修三件：LOCAL_USER 身份错位（local vs local-user）、桌面会话契约项目过滤致手机恒空（/m/api/overview 补齐）、隧道互抖（exit 迟到+树杀逃逸孤儿，集合跟踪+签名清场+守卫）。实机：项目工作区 rootLen 42527 零错误渲染。诚实边界：终端/窗口控制等 Electron 专属能力降级不可用；真机蜂窝实测待用户。

- **修订 0（2026-09-09）**：初版立项——以微信 iLink bot 通道为主路线（机制取证已入 git 历史 `dd11346e` 版本）。
- **修订 1（2026-09-09，用户截图澄清 + aliyun 中继裁决）**：主路线重定为**移动浏览器直连**（用户明确"要左侧的，不是微信/飞书 bot"）；新增 A1 LAN 直连（P1/P2）与 A2 aliyun 反向隧道（P3，用户裁决"用 aliyun 当中继"）双段；bot 通道整体降为 P5 候选；补充 ZCode 左侧功能取证（云端 relay + WSS RPC + 云端托管移动页，§2）；设计裁决重写为 D1–D10。
