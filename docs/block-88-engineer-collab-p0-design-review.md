# BLOCK-88 工程师协作 — P0 立项评审

> 状态：`P2-COMPLETED（2026-09-19 会话收口，提交 8ad51d36——实机 13/13 allPass + 契约 4/4 + UI-419 verified；收口记录见 §10。P3（项目授权边界）待用户裁决启动。P1-COMPLETED 见 §9（7cc5cbf3）。D1-D8 于 2026-09-18 裁决「都按推荐」落定）`
> 日期：2026-09-18（立项评审稿；概念源自 2026-09-14 f52e7d87 用户裁决「可以的 非常棒」）
> 用户裁决史：①2026-09-14 联邦概念深化「联邦协作主体=**不同的工程师**」（各跑各的格物，互相授权：委托任务/看界面/协同开发），三层缺口排队 BLOCK-88；②2026-09-18「开始 BLOCK-88 立项评审」。

## 1. 目标一句话

两位（或多位）工程师各自跑着自己的格物；格物知道「连进来的是谁」——配对带身份、任务归属清晰（A 委托的活不污染 B 的空间）、按项目授权边界。**与 BLOCK-85 的分工**：85 解决「两台格物连得通、活派得过去」（通道层）；88 解决「连进来的『人』是谁、他的东西归谁、他能碰什么」（身份与授权层）。概念划分（用户定义）：多端控制（87，同一台主体多端遥控）≠ 联邦协作（85，不同主机通道）≠ 工程师协作（88，不同工程师身份）。

## 2. 代码事实基线（2026-09-18 摸底）

| 资产 | 现状 | 对 88 的意义 |
| --- | --- | --- |
| `core/biof3-server/db/users.js` | users 表 + DAO（getUserByUsername/getUserById/createUser）齐备 | 身份存储基建已有；但 `auth.js` 当前把**所有请求映射为单一 LOCAL_USER 'local-user'**（桌面单管理员设计） |
| `core/biof3-server/agent-task-store.js:260-340` | **tasks 表已有 user_id 列**（BLOCK-10 S-006，nullable，写入侧填充） | 任务归属列现成——访客工程师归属可落此列 |
| `core/shared-backend/federation-peers.js` | peers 注册表（peerId/name/baseUrl/lastProbe） | **无工程师身份字段**——需 additive 扩展 identity |
| mobile-gateway（BLOCK-70/85） | 配对/会话（token 只存 hash）/吊销/审计/IP 限速全套 | 配对握手是身份注入点；会话存储需 additive 加 identity |
| `routes/federation-admin.js` + `fed:` 分派 | 作业转发/状态/产物三端点；scope 设计为 jobs/full 两档（85 D6） | 授权边界扩展点 |
| 85 双真机验收 | **未完成**（P4 closeout 等双真机） | 88 的端到端验收依赖同一链路——顺序依赖见 §6 |

## 3. 三层缺口 → 评审裁决点

缺口（用户 2026-09-14 定义）：①配对带身份：B 看到「A 工程师连入」②A 的任务独立归属不污染 B 空间 ③按项目授权边界。

### D1 身份模型（最重裁决）
- **A（推荐）· 轻量声明身份**：配对时自带 displayName（+可选颜色/机型标注），存于 peers 注册表与会话；对端仅展示，**不建账号体系**。信任模型=熟人局域网/可靠网络（通道安全仍由配对 token 保证）。改动小、不动 auth.js 单管理员设计。
- B · 复用 users 表完整多账号：每工程师真实账号+凭据，auth 层多身份。重量级：牵动单管理员设计、登录 UI、权限矩阵——建议留 P5+/按需再立。

### D2 配对握手身份化
配对 URL/兑换请求 additive 增加 `identity` 字段（displayName 等）；B 端「联邦 → 协作成员」列表显示「工程师 A · Mac · 在线」。**建议：做**（无它则 88 无意义）。

### D3 任务归属隔离
A 委托到 B 的 agent 会话/作业：归属列标记访客工程师标识（`tasks.user_id` 存 peer 工程师标识，additive，列已存在），B 端 UI 可见「来自工程师 A」；A 的会话/产物在 B 端**独立可见可清理，不混入 B 自己的会话列表默认视图**。**建议：列标记 + 默认视图隔离**（不做物理独立空间，避免双真相）。

### D4 项目授权边界
A 能看到/操作 B 的哪些项目。**建议：配对后默认零授权，B 按项目逐个授权（grants 清单存 B 端，可随时吊销）**；委托/分派请求越界时诚实 403。备选=全空间 open（快但越界）/只读全部（粒度粗）。

### D5 权限档位
85 的 scope 两档（jobs/full）保留为粗档；D4 项目 grants 作为细粒度叠加。**建议：粗档 × 项目 grants 叠加，不另造第三套**。

### D6 对称性与工程师数
数据模型天然多 peer（注册表即列表）；**验收按 1:1 双工程师**先行，UI 按成员列表设计可扩展。>2 节点中继拓扑维持非范围（85 同款）。

### D7 顺序依赖
**BLOCK-85 P4 双真机收口先行**（88 的 P1-P3 全部构建在 85 的通道与配对链路上，且双真机验收是 88 端到端验收的同款环境）。88 本次只做 P0 评审登记，**不占 active 槽位**，85 收口后由用户裁决启动。

### D8 非范围确认
不做实时协同编辑 / 不做代码合并与冲突处理 / 不做账号密码登录体系（若 D1=A）/ 不做权限管理后台（设置面板内联即可）/ 不做 >2 节点中继。

## 4. 阶段草案（D1-D8 裁决后串行）

| 阶段 | 交付 | 门禁 |
| --- | --- | --- |
| P0 | 本评审稿，D1-D8 裁决 | 用户逐项确认 |
| P1 | 身份层贯通：配对握手 identity + peers/会话注册表扩展 + 联邦面板「工程师 X · 在线」 | 契约测试 + 实机配对双端身份可见 |
| P2 | 任务归属隔离：委托任务 user_id=访客工程师 + 「来自 X」可见 + 默认视图隔离 | 契约 + 实机委托归属断言 |
| P3 | 项目授权边界：grants 清单 + 越界 403 + 授权/吊销 UI | 契约 + 实机越界拒绝/授权放行 |
| P4 | closeout | `npm run closeout` + canonical 五件套 + 双真机端到端 |

## 5. 非范围

§3 D8 全项；联邦通道本身（85 已交付）；多端控制（87）；音视频/屏幕共享类「协同」。

## 6. 风险

1. **身份自报无凭据**（D1=A）：信任边界=配对 token + 网络环境；对不可信网络场景诚实标注（面板提示「声明身份，未经验证」）。
2. **与 85 联动返工**：85 双真机验收若暴露通道层缺陷，88 P1 起点顺延（顺序依赖已是缓解）。
3. **归属语义双真相**：D3 坚持单一真值（任务在 B 端 DB，A 端是投影——85 D3/D7 既定原则延续）。

## 7. 量级

用户 2026-09-14 预估「量级 1-2 包」；按 §4 拆分 P1-P3 各为一次会话量级，可整包串行亦可按面拆两包。

## 8. 裁决记录（2026-09-18，用户原话「都按推荐」）

- **D1 身份模型 = A 轻量声明身份**：配对自带 displayName（+可选颜色/机型标注），存 peers 注册表与会话；不建账号体系、不动 auth.js 单管理员设计；信任模型=配对 token + 熟人网络（面板诚实标注「声明身份，未经验证」）。
- **D2 配对握手身份化 = 做**：配对 URL/兑换请求 additive 增 identity 字段；联邦面板显示「工程师 X · 机型 · 在线」。
- **D3 任务归属隔离 = 列标记 + 默认视图隔离**：委托任务 `tasks.user_id` 存访客工程师标识（列已存在），B 端可见「来自工程师 X」，不混入 B 默认会话视图；不做物理独立空间。
- **D4 项目授权边界 = 默认零授权 + 逐项目 grants**：授权清单存被访端、可随时吊销；越界诚实 403。
- **D5 权限档位 = jobs/full 粗档 × 项目 grants 细粒度叠加**，不另造第三套。
- **D6 对称性 = 数据模型多 peer、UI 成员列表化，验收 1:1 双工程师先行**；中继拓扑维持非范围。
- **D7 顺序依赖 = BLOCK-85 P4 双真机收口先行**；88 本次仅 P0 评审登记，不占 active 槽位，85 收口后用户裁决启动 P1。
- **D8 非范围确认 = 不做协同编辑/代码合并/账号密码体系/权限管理后台/中继拓扑**。

## 9. P1 收口记录（2026-09-19 夜间会话）

- **交付**：`core/shared-backend/engineer-identity.js` 共享净化（D1-A）+ `pairing.js` 会话 identity additive 落键（存量投影键集不变）+ gateway `/m/api/pair` 收身份·`/federation/api/health` 回显 + `federation-peers.js` peer.identity + `federation-admin.js` pair 透传·`GET /api/federation/members` + UI-418 联邦面板协作成员/署名（同提交台账）。
- **门禁对账**：契约 `test/block88-engineer-identity.test.mjs` 5/5；block70+federation 回归 12/12；test-affected 16/16；tsc 0；theme-token-contract 4/4；`bash -n` 绿；docs:check PASS(255)；ui:audit:check 同步通过。
- **实机断言**：`scripts/block88-p1-dual-identity.cjs` **15/15 allPass**（loopback 双节点：B=dev 栈真实进程 :3001/:3005，A=真实 federation-admin 独立 dataDir；REST 四层〔配对署名/注册表投影/成员面/健康回显〕+ CDP 9223 测试实例 UI 走查〔协作成员行·署名输入·诚实标注〕，探针零触碰 9222 主窗口）；证据 `acceptance/block-88/p1-identity.json` + `p1-identity-ui.png`。
- **评审清偿**：六维度自评抓 P2 一枚（联邦访客会话名 UA 兜底恒「移动设备」）——已修（带署名优先命名，契约断言补 name.startsWith('工程师 A')，终版实机 P4b 回显可见）。
- **同批基建**：`scripts/start-test-instance.sh` 双端同形化（原纯 Windows 实现 macOS 静默空转）+ impact-map 补 ui417-side-chat-evidence（4da4bb4a 漏登记存量 unknown）+ block88-engineer-collab 规则。
- **P2 预备**：BLOCK-85 验收登记的 delegation 无项目绑定/未开独立会话两结构缺口 + 本阶段遗留候选（会话名已清偿）在 P2 域内消化；启动待用户裁决。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 10. P2 收口记录（2026-09-19 会话）

- **交付**：访客身份检测（req.mobileSession.identity，网关会话门携带 P1 落档署名）→ 委托独立会话（origin 列，消化 85 登记「委托未开独立会话」缺口）+ getOrCreateActiveConversation 复用恒排除（反向污染防护）+ 自动标题守卫（实机抓真：auto-title 会洗掉归属标题）+ params.federated 归属 + spawn 继承 + meta/tasks federatedFrom 透出 + 会话列表默认视图隔离（includeFederated 开关）+ UI-419 左栏「联邦委托会话」查看节/俯瞰联邦角标（同提交台账）。
- **实现注记**：tasks.user_id 维持宿主权限面语义 'local-user'（subagent 派生所有权检查/并发桶/历史拼装依赖它），归属走 params.federated + conversations.origin 双面——D3 意图（归属可见+隔离+可清理）完整达成，列机制与 plan §3-D3 字面有出入如实留痕。
- **门禁对账**：契约 test/block88-task-attribution.test.mjs 4/4 + block88-engineer-identity 5/5 + subagent-recent 回归绿；tsc 0；theme-token-contract 4/4；docs:check PASS(255)；ui:audit 同步通过；定向全集 332 项 324 过 7 红——**全部存量（基线对照证实非本包引入）**：block67 fs verbs 4 红（macOS bash verb 面）+ sys_resource 1 红（用例自注 Linux/WSL 语义面）+ P6 源绑定 2 红（🟡 在册）。
- **实机断言**：scripts/block88-p2-delegate-attribution.cjs **13/13 allPass**——A 侧真实 delegate_to_gewu_node 工具跨节点委托、B 端真实跑完模型回执 done → meta federatedFrom=工程师 A + 会话标题「来自工程师 A的委托：…」（守卫生效）+ 默认视图零泄漏 + includeFederated 可见 + 宿主活跃会话零污染 + CDP 测试实例左栏联邦面可见；证据 acceptance/block-88/p2-attribution.json+png。
- **P3 预备**：项目授权边界（grants 清单+越界 403+授权/吊销 UI）+ 85 登记缺口「delegation 无项目绑定」（本轮实机再次印证：委托会话 project_id 为 NULL）——启动待用户裁决。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
