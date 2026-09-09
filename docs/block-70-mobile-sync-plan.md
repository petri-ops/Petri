# BLOCK-70 — 手机远程同步（Mobile Sync）：微信扫码配对 + 智能体任务远程查看与控制

> 状态：`planned`（2026-09-09 用户想法提案立项登记，机制取证与架构草案随立项交付；实施启动待用户裁决）
> 立项日期：2026-09-09
> truthDomain: `block-70-mobile-sync`
> UI 台账：UI-319（实现同提交登记）
> 来源：用户 2026-09-09 想法原文（§1）
> 取证来源：本机 ZCode 安装（`D:\Program Files\ZCode` Electron host bundle）静态解剖 + 项目代码调查 + `docs/next-steps-roadmap.md` 研究候选池（openclaw 解剖结论）

## 1. 用户提案（评估对象）

> "你看看我们当前使用的工具 ZCode，通过手机扫码就可以在远程同步当前的智能体任务、会话结果等各种信息，这是怎么实现的呢？如果我们要想在当前项目中增加这个能力是否可以做到？……如果可以实现就理清楚之后开个 block 后期集中实现此功能。"

拆解为三条需求：
1. **扫码配对**——桌面端展示二维码，手机扫码即建立绑定
2. **远程同步**——手机能查看当前智能体任务、会话结果等（不在同一局域网也要能用，对齐 ZCode 体感）
3. **回程控制**（ZCode 同款隐含能力）——手机侧可发指令/批准，不只是只读

**与候选池既有裁决的关系**：2026-09-06 研究候选池曾登记"参考不收：多通道消息网关（与桌面优先不同路）"。本包由用户 2026-09-09 显式提议，**该默认立场由用户裁决推翻**——但范围收窄为"单一手机通道（微信）+ 本地指挥席不变"，不是 openclaw 式通用多通道网关。

## 2. ZCode 机制取证结论（本机静态解剖）

ZCode 的"扫码远程同步"= **微信 iLink bot 平台**（`https://ilinkai.weixin.qq.com/ilink/bot`，微信官方 AI bot 接入）+ 桌面端内嵌 bot 运行时。手机端**就是微信本身**（不自研 App/网页）。全链路：

1. **配对**：桌面端 `GET /get_bot_qrcode?bot_type=3` 拿二维码 → 用户微信扫码 → 桌面轮询 `GET /get_qrcode_status?qrcode=...`（pending→scanned→success/expired）→ 成功返回 `bot_token` + `ilink_bot_id`，本地持久化（ZCode 存 `~/.zcode/v2/`，凭证与 bot 配置分离）
2. **收消息**：`POST /getupdates` **长轮询**（90s 超时，opaque 游标 `get_updates_buf` 断点续传）——**纯出站连接**，桌面不开入站端口、不做内网穿透，NAT 后可用，这是"真远程"的关键
3. **发消息**：`POST /sendmessage`（text/image/file item_list）+ `/sendtyping` 打字指示；微信 CDN 附件 AES-128-ECB 解密
4. **bot 运行时层**（对齐 openclaw「可信网关/不可信执行」哲学）：provider 注册表（weixin / feishu(@larksuiteoapi) / webhook 三实现）→ inbound 消息归一化（actor/chatId/去重/会话级串行队列）→ 映射本地 agent 会话；指令面 `/status /new /workspace /model /mode /thoughtLevel /reply`；**permission.respond**（手机上批准权限请求）+ elicitation.respond；replyMode 控制推送语义；流式 transient interaction card 实时刷新任务进度

## 3. 可行性结论

**可行，且两条路线互补**：

- **路线 A（主体，对齐 ZCode 本体）——微信 iLink bot 通道**：真远程（任何网络）、纯出站、手机端零安装。本项目后端为常驻 Node 进程（`core/biof3-server/server.js`），内建 fetch 可直调 iLink HTTP API，**协议层 0 新依赖**；凭证管理有成熟模式（`helpers/credential-store.js`：macOS Keychain / 其他平台 0600 文件）
- **路线 B（补充，P5 候选）——局域网移动 Web 面板**：后端加 LAN 监听 + token 鉴权 + 二维码指向 `http://<LAN-IP>:<port>/m`。全本地无第三方，但仅限同一 WiFi，且后端现绑 `127.0.0.1` 零鉴权，需新增持有层——登记候选不在本期
- **风险事实（诚实登记）**：iLink 为微信侧协议，无公开稳定性承诺，可能随平台演进变化——D8 错误分类 + additive 隔离兜底（通道失败不影响本地核心功能）；通道内容经腾讯云，隐私边界用 D6 推送语义约束（默认只推状态与摘要，详细结果留桌面）

**缺口（本包补齐）**：无任何二维码生成/展示能力；无 LAN IP 发现；无 bot 通道模块；无移动指令面。REST/SSE 数据面完整可复用（见 §4）。

## 4. 代码事实基线

- **数据面（全部现成，通道只做投影）**：conversations/messages REST（`core/biof3-server/routes/ai-conversations.js:52-140`）；agent 任务 `GET /api/ai/agent/tasks` + `task/:id/meta` + `message/followup/cancel/resume`（`routes/ai-agent/`）；SSE `GET /api/ai/agent/task/:taskId`（`ai-agent/events.js:22`，`?afterSeq=N` 断线续传）；tool_jobs 台账（`db.js:431`）
- **任务终态摘要先例**：BLOCK-49 `buildTerminalSummary`——已有"任务结果压缩成摘要"的成熟实现，手机推送直接复用语义
- **权限批准链**：BLOCK-48 授权门两段式 ackToken + ai-legacy approve REST——手机批准 = 进程内调同一内部函数（对标 BLOCK-49 spawn-agent-tools 进程内直调先例，**不经 HTTP 自调用**）
- **凭证与设置**：`helpers/credential-store.js`（0600/Keychain）+ `helpers/ai-settings.js`（credential_updates 剥离、不落明文）——bot_token 照此模式存
- **出站远程通道先例**：BLOCK-57 `helpers/remote-execution/error-classifier.js`（network 重试 / auth 快败 / 未识别保守）——方向相反（那是桌面→服务器 SSH），但错误分类与"通道失败不污染作业真相"思想直接可借
- **服务器形态约束**：Express 绑 `127.0.0.1:3001`（`server.js:308`）、origin 白名单（`shared-backend/local-request-boundary.js`）——路线 A 不动这些（出站长轮询不需要入站端口）；路线 B 才涉及监听/鉴权改造，故 P5 候选
- **设置面板挂点**：`frontend/src/pages/admin/`（或设置页 RemoteTargets 小节先例，BLOCK-57）——「手机远程」区照此模式新增

## 5. 设计裁决（D1–D9，标 ⏳ 者待 P0 评审用户确认）

- **D1 通道架构**：进程内 bot-gateway 模块（`core/biof3-server/helpers/bot-gateway/`：`provider-registry.js` + `weixin-ilink.js` + `inbound-normalizer.js` + `command-router.js`），长轮询 async 循环驻后端进程，不阻塞事件循环；Electron 主进程只管设置 UI 与生命周期转发。**默认关闭**（未配对诚实空态），设置面板显式开启
- **D2 配对与凭证**：配对 = 设置面板「手机远程」区点击「扫码配对」→ 桌面 UI 卡片渲染 iLink 二维码 → 轮询状态 → `bot_token` 落 credential-store、`botId/配对时间` 落设置元数据；解绑 = 删凭证 + 拒绝后续轮询。二维码渲染需 1 个纯 JS 小依赖（倾向 `qrcode-generator` 单文件 0 依赖 ⏳ P0 裁决），全包唯一新依赖
- **D3 单一真相红线**：bot 通道**只投影**既有 conversations/tasks/tool_jobs 真相，**不建第二套会话存储、不在 DB 新增业务表**；inbound 指令映射为既有内部函数调用（spawn 任务/查任务/批准），与前端同源同门
- **D4 安全边界**：一个 bot_token = 一个微信账号（配对即授权边界）；指令白名单（D5）之外一律拒绝并诚实回复；权限批准仅限既有授权门语义（不放大权限，BLOCK-48 两段式原样）；v1 仅私聊（群聊拒绝，对齐 ZCode feishu provider 先例）；轮询循环崩溃自动重启有上限，退避后诚实报错
- **D5 指令面 v1（克制，对齐 ZCode allowedCommands）**：`/status`（当前运行中任务）、`/tasks`（最近任务列表）、`/new <文本>`（新建任务 ⏳ 默认语义=新会话新任务）、`/help`；普通文本消息默认路由到最近活跃会话续聊（⏳ P0 评审裁决备选：一律要求显式指令）
- **D6 推送语义（隐私边界）**：replyMode 三档 ⏳——`final`（仅终态摘要，默认）/ `milestones`（终态+关键事件）/ `verbose`（进度节流镜像，不推荐）；回复内容 = 状态 + buildTerminalSummary 语义摘要，**不回传文件原文/大产物/密钥面内容**；手机批准权限请求时只下发"工具名+目标摘要"，不下发完整参数原文
- **D7 移动面形态**：手机端就是微信聊天，**不自研移动 App/小程序/移动网页**（LAN web 面板与小程序均为远期候选）；消息长度预算 + 微信侧分片规则在 P0 实测固化
- **D8 第三方协议风险兜底**：iLink 无公开稳定性承诺——错误分类（借鉴 BLOCK-57：network 退避重试 / auth 失效提示重新配对 / 协议变化 fail-closed 诚实报错）；通道全部失败不影响本地任何功能；协议快照与实测行为记录进 acceptance 证据
- **D9 G0 纪律**：additive 模块，未配对时零行为变化（既有测试零改动）；0 新 npm 依赖倾向（仅 D2 二维码一处例外 ⏳）；不外推 packaged/Provider/GA

## 6. 阶段划分（建议 P0–P1 首包评审后一次会话推进；P2+ 另行裁决）

| 阶段 | 内容 | 关键产出 |
| --- | --- | --- |
| P0 | 设计评审 + iLink PoC：三端点 PoC 脚本（get_bot_qrcode → 展示 → 用户真实扫码 → get_qrcode_status → token 落 credential-store）+ D2/D5/D6 ⏳ 裁决 + 消息长度/分片实测 | `acceptance/block-70/p0-poc.json`（token 脱敏） |
| P1 | bot-gateway 模块 + 配对 UI：provider registry + weixin-ilink（注册/长轮询/游标持久化/发送/typing/错误分类）+ 设置面板「手机远程」区（配对卡/状态/解绑，UI-319） | 零网络单测（归一化/游标/错误分类/指令解析） |
| P2 | 查询面 MVP：/status /tasks /help + 任务终态自动推送（buildTerminalSummary 语义）+ typing | 实机：手机发 /status 收到真实回复 |
| P3 | 控制面：/new 新任务 + 手机批准授权门（permission.respond 内部链路）+ 进度节流 | 实机：手机发起→桌面执行→手机批准→手机收终态 |
| P4 | 收口：实机全链断言脚本 + 门禁 + 台账/registry/roadmap 回写 | `acceptance/block-70/` 全套证据 |
| P5 候选 | LAN 移动 Web 面板（路线 B）/ 飞书通道 / 附件双向 / 群聊 | 另行立项裁决 |

## 7. 验收门（启动时可按实际裁剪范围调整）

- 零网络定向单测全绿（inbound 归一化 / 游标推进 / 错误分类 / 指令白名单 / 凭证存取）
- `tsc` 0 错误（动前端时）；`npm run docs:check` + `npm run ui:audit:check`
- dev Electron 实机 + **真实微信扫码全链**断言（证据落 `acceptance/block-70/`，token/身份脱敏）：
  1. 配对：扫码 → 状态流转 → token 入 credential-store（不落明文）
  2. 未配对态：设置面板诚实空态，后端零轮询零行为变化
  3. /status /tasks 返回与桌面 UI 一致的任务真相（同源证据）
  4. 终态推送摘要与桌面任务摘要同源；手机批准授权门成功放行且审计落 tool_jobs（P3 后）
  5. 解绑后轮询停止、token 清除；断网退避恢复后通道自愈
- UI-319 台账与实现同一提交登记

## 8. 范围外

- **不建**第二套会话/任务存储（通道只投影既有真相）；DB 零新业务表
- **不自研**移动 App/小程序/移动网页（P5 候选另议）；不做群聊（v1 私聊）
- **不做**公网自建 relay 服务器（G1+ 远期候选）；**不动**后端 127.0.0.1 绑定与 origin 白名单（路线 A 无需）
- **不动** agent-runner 核心循环（推送钩子挂任务事件/终态层）；**不做**附件双向传输（远期候选）
- 通道为可选 additive 能力：不做"必须登录手机号"之类的账户体系改造
- G0 开发期常态 · 不外推 packaged/Provider/GA

## 9. 排队与串行

- 当前无 active 工作包；排队候选：BLOCK-67-SSH-REMOTE-PROJECT（大包）+ BLOCK-68-UI-DECLUTTER（小包）+ BLOCK-69-KNOWLEDGE-SPACE（中大包）+ 本包（中大包，建议 P0–P1 起步）
- **与 BLOCK-67 关系**：方向相反（67=桌面→远程服务器跑项目本体；本包=手机→桌面远程指挥），无文件面冲突，可任意先后
- **文件面重叠警示**：本包改动以新模块为主（`helpers/bot-gateway/` 新建 + 设置面板新区块）；设置页与 BLOCK-57 RemoteTargets 小节相邻，UI 面与 BLOCK-68/69（SimpleChat/RightPanel）不相邻——串行纪律下冲突小
- 工作区现状（2026-09-09 登记时核实）：UI-315 终端块跟进 WIP（`ToolActivityList.tsx` / `simple-chat.css` 未提交）进行中，任何启动按串行纪律待其落定
- 启动顺序由用户裁决
