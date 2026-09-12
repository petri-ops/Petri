# BLOCK-70-MOBILE-SYNC · P0 设计评审稿

> 日期：2026-09-13
> 评审对象：`docs/block-70-mobile-sync-plan.md`（修订 1）§5 D1–D10
> 评审方式：逐项对照当前代码事实（2026-09-13 工作区，HEAD `689205b5` 之后）
> 状态：**代码事实核对完成；⏳ 标注项待用户醒后裁决**（用户夜间授权原话见 AUDIT-LOG 启动行）

## 0. 启动裁决与串行背景

- 用户裁决（2026-09-13 原话）：「进行一个串行超长任务 我要睡觉了 继续搞定 1 2 3 和BLOCK-70-MOBILE-SYNC」——本包启动授权成立；1–3（BLOCK-84 收口 / 遗留 A 清债 / 🟢 销号）已先行完成并各自提交。
- 启动前置：AUDIT-LOG 无 🔴；剩余 🟢 仅 DIST-STALENESS（G1+ 范畴，不外推，不阻塞）；active 槽位已由 BLOCK-84 收口释放。

## 1. 代码事实基线核对（plan §4 → 当前代码）

| plan 声称 | 当前代码事实 | 结论 |
| --- | --- | --- |
| Express 绑 `127.0.0.1:3001` | `core/biof3-server/server.js:330` `app.listen(PORT, '127.0.0.1', ...)` | ✅ 一致 |
| conversations REST | `routes/ai-conversations.js:52/86/115`（list / detail / messages） | ✅ 一致 |
| agent 任务列表 | `routes/ai-agent/task-actions.js:37` `GET /api/ai/agent/tasks` | ✅ 一致 |
| SSE 断线续传 | `routes/ai-agent/events.js` `GET /api/ai/agent/task/:taskId`，`?afterSeq=N` | ✅ 一致 |
| LOCAL_USER 注入 | `core/biof3-server/auth.js:15` `req.user = LOCAL_USER` | ✅ 一致 |
| 凭据存储先例 | `core/biof3-server/helpers/credential-store.js` 存在 | ✅ 一致 |
| 设置面板挂点 | `DesktopSettingsPanel.tsx:57/858` `sections/RemoteTargets` 先例 | ✅ 一致 |
| 模块化路由注册 | `routes/index.js` `registerRoutes(app)`，模块形态 `(app)=>{}` | ✅ 一致（本包沿用该形态） |

## 2. D1–D10 逐项评审

- **D1 独立 app 实例 / 独立端口** — **确认**。实现为同进程第二 Express 实例（`mobile-gateway`），主后端 `127.0.0.1:3001` 绑定与 origin 白名单零改动。端口 env `BIOF3_MOBILE_PORT`，默认 **3005**。A1 绑 `0.0.0.0`，A2 隧道段回绑 `127.0.0.1`（P3 再裁决，本期只做 A1 + 回环）。
- **D2 配对与二维码** — **确认，附依赖裁决**。一次性配对 token（32B hex，TTL 5 分钟，单次使用）→ 换持久会话 token（仅存 sha256，文件制 `<dataDir>/mobile/sessions.json`，对标 packs/installed.json 文件制先例）；设置区可吊销。QR 内容 = `http://<LAN-IP>:<port>/m#<pairToken>`。**依赖裁决**：`qrcode-generator`（MIT、零传递依赖、单文件）为 plan §5-D2/§7 明文预名的全包唯一新 npm 依赖——按 plan 落地，**⏳ 待用户醒后追认**（若否决，替换面隔离在单一渲染函数，成本约 10 行）。**依赖前置核查（DEPENDENCY-CHANGE-CHECKLIST）**：无既有 QR 能力（root/frontend package.json 零 QR 依赖）；无可复用内部实现。
- **D3 单一真相红线** — **确认**。移动面数据端点直接复用既有路由模块（conversations / agent tasks / SSE / tools 历史），同进程共享同一 db 单例；DB 零新业务表；不建第二套会话存储。
- **D4 安全边界** — **确认**。默认关闭（config 文件 `mobile/gateway.json` `enabled:false` + 显式开启）；全部 `/m/api/*` 过会话 token 鉴权中间件（无 token 401）；配对 token 单次+短时效；会话可吊销（吊销即时生效）；按 IP 内存限速（超限 429）；JSONL 审计日志 `<dataDir>/mobile/audit.log`；权限批准链本期不触达（P2 面才涉及，届时按 BLOCK-48 两段式原样）；v1 无文件上传/产物下载（移动 app 实例**只挂载** conversations/agent/tasks/tools 读面模块，files/workspace/terminal/computer 等模块不挂载）。
- **D5 移动 Web 形态** — **确认**。`/m` 独立轻量页（单文件 HTML + vanilla JS，由 gateway 静态服务），不进桌面 SPA、不进 Vite 构建图；任务墙 + 任务详情（SSE afterSeq）+ 会话列表/阅读；竖屏优先；无原生 App/小程序。
- **D6 推送语义** — **确认**。v1 拉取式 + SSE 实时流，无推送。
- **D7 aliyun 隧道（A2/P3）** — **本期不做**（plan 阶段表 P3 单独收口）；复用面（ssh-transport）已在 BLOCK-57 验证存在。
- **D8 失败语义** — **确认**。三态诚实（未启用/已启用未配对/已连接）；gateway 崩溃隔离（独立实例 + try/catch 启动，失败不影响主后端）。
- **D9 隐私边界** — **确认**。默认不可达；无遥测；审计日志只记元数据（ip/method/path/状态码）不记内容。
- **D10 G0 纪律** — **确认**。additive：关闭态主后端零行为变化、既有测试零改动；唯一新依赖见 D2；不外推 packaged/Provider/GA。

## 3. 阶段裁决（本次会话范围）

按 plan §6「P0–P1 首包一次会话推进」执行，结合无人化验收阶梯（用户睡眠期）：

- **本次落地**：P0 A1 PoC（gateway + 配对 + QR + 移动只读页）+ P1 主体（设置区「手机远程」UI-319 + 设备管理/吊销）。
- **验收分级（诚实）**：CDP 够得着的部分（设置区渲染、gateway 状态、配对流、鉴权拒绝、吊销失效）→ dev 栈 + HTTP/CDP 断言，证据落 `acceptance/block-70/`；**真实手机扫码验收够不着 → 台账维持 in_progress，待用户实测**（阶梯第 2 级，不凑证据）。
- **⏳ 待用户裁决项**：① D1–D10 评审结论追认；② qrcode-generator 依赖追认；③ 真实手机扫码实测；④ P2 控制面（发消息/批准/取消）启动。
- P2/P3 不在本期（plan 串行纪律）。

## 4. 验收门禁预声明（收口对账用）

- 零网络/回环定向单测全绿（配对换发单次性/TTL/会话吊销/鉴权 401/限速 429/config 读写）。
- `tsc` 0 错误（前端增量面）；`npm run docs:check` + `npm run ui:audit:check`。
- dev 栈实机断言（`acceptance/block-70/`，token/IP 脱敏）：关闭态不监听；启用态回环配对→会话→授权读→吊销即 401；未配对 token 访问被拒；桌面端设置区渲染（UI-319，UI 台账同提交登记）。
- 关闭态回归：既有测试零改动、主后端零行为变化（additive 红线）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
