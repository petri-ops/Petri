---
capability: block-405-post-k7-l1-security-hardening
status: completed
goal: 执行第五轮优化程序 L1（安全边界纵深）：四个 P1 安全断链红绿先行（terminal:open-shell 命令注入 / 深链 MCP stdio command 白名单 / 受信 origin 回环过滤 / 每次 loadURL http(s)+主机白名单+iframe sandbox），再清 dev CSP、权限装配 fail-open、Keychain argv、transcript 0600/脱敏/归属、URL origin 精确比较、依赖静态清单；L-56/L-79 出 U 类一页材料不改默认语义。承载蓝图 docs/post-k7-full-audit-and-blueprint-2026-11-10.md §4-L1 的 12 条发现。
acceptance:
  - L1-1 L-50：cwd realpath 精确校验 + 字符白名单 + AppleScript 参数化 + Windows spawn cwd；注入 payload（$(...)、反引号、&、|、userinfo 等 ≥12 组）全部被拒且无命令执行；合法 workspace 路径计划仍逐字可用；红绿先行负测落盘
  - L1-2 L-51：深链 MCP stdio command 收敛白名单 + args 禁求值开关（-c/-e 等）+ mcp 分支 expected 快照对账；8 组恶意深链全部拒绝；pack 分支既有 TOCTOU 对账零回归
  - L1-3 L-52：PETRI_TRUSTED_DESKTOP_ORIGINS env 只接受回环 origin；三消费方（CORS/IPC 门/权限策略）统一过滤；空 Origin 非 GET 改本机随机 token 校验；共享 bearer 常量移除
  - L1-4 L-53：每次 webview.loadURL 前强制 http(s) + 主机白名单（navigate/bridge 同源校验）；iframe 补 sandbox；file:///自定义协议/本机任意端口 6 组全拒
  - L1-5 L-55 dev CSP 收敛单一端口 + 去 unsafe-inline（nonce）；L-57 权限装配失败硬失败（不静默回落自动批准）；L-60 导航门 URL origin 精确比较 + openExternal scheme+host 白名单
  - L1-6 L-58 Keychain 改 stdin 传值（ps 不见密钥）；L-59 transcript 0600 + 写前脱敏 + read 端点会话归属校验
  - L1-7 L-56/L-79 U 类一页决策材料（现状/候选/风险/推荐），状态 pending_user_ruling，不改默认语义、不代答
  - L1-8 L-61 依赖静态清单（native/预发布精确钉扎评估），⏳ CVE 联网判断 external-blocked 不代答
  - L1 出口：全部注入/越权负测绿；quality:secret/arch + electron-security-assertions 绿；零新增依赖；U 类材料在册未越权
reopen: Electron 安全基线变化、发现新注入面、或 L0 门禁判据漂移时重开
---

# BLOCK-405 · post-K7 L1 安全边界纵深（第五轮优化程序第 2 阶段）

> **发令来源**：用户 2026-11-11 执行提示词预授权（同 BLOCK-404，连续工作模式）；L0 判据已修复（反向门禁不再锁死改进）。
> **canonical 蓝图**：docs/post-k7-full-audit-and-blueprint-2026-11-10.md §4-L1。逐项锚点以蓝图 §2.4 为准。
> **红绿先行（HK-01）**：本阶段全部是安全行为修复——每个 P1 先写「旧实现放行恶意 payload」的红测试，再写最小实现转绿；红→绿证据随收口留痕。

## 1. 范围（8 改进点 → 12 条发现）

蓝图 §4-L1 表格逐项执行；行为面全部在 src/ 主进程与 core 边界层。

## 2. 非范围（exclusions）

- **L-56 ADMISSION observe→enforce、L-79 FK OFF/ON**：只出 U 类一页材料，不改默认语义、不代答（Agent 边界）。
- **L-61 CVE 联网扫描**：无凭据/出网环境 → external-blocked，只做静态清单（版本钉扎评估），不跑 npm audit 出网。
- 零新增依赖；不改 G1+ 面（公证/签名/Provider）；零触碰用户资产与在制 CSS WIP。
- 不动既有用户裁决（guard-ack 审批链、accessMode 语义等）。

## 3. 依赖与顺序

- L0 completed（反向门禁已解）；L1-1~4（P1）先行红绿 → L1-5/6（P2）→ L1-7 材料并行 → L1-8。
- 判「补丁 vs 重构」：四个 P1 都是**安全边界的单点修复**（cwd 校验/白名单/回环过滤/loadURL 校验），无「同处二次叠加」信号 → patch 形态；L1-3 涉及三消费方统一=小型收敛，按蓝图修法执行。

## 4. 证据位置与验收门

- 证据目录：`acceptance/post-k7-2026-11-10/l1/`（红→绿测试输出、门禁读数、U 类材料指针）。
- 专项门：`quality:secret` + `quality:arch` + `test/electron-security-assertions`（在座契约）+ `gate:post-h9-contracts` 全绿；`test:changed` 定向全绿（P6 W 红除外，归属不变）。
- docs:check + ui:audit:check 必跑（后者红=W 归属延续）。

## 5. 完成语义

- 逐项终态写回本 plan §6；`completed` = 验收逐条当次证据 + 定向测试绿（W 归属红如实标注）+ 六件套回写。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 执行留痕（当次证据，收口时逐项对账）

| # | 状态 | 关键交付 | 证据 |
| --- | --- | --- | --- |
| L1-1 | done | getOpenShellPlan 参数化：mac 走 osascript on run argv（quoted form of 运行时单引号包裹，cwd 不再内插源码）；win 走 spawn cwd 选项（命令串为零）；控制字符拒绝；resolveOpenShellTarget（_workspace-roots）：realpath 精确命中登记工作区根/显式兜底，列举失败 fail-closed；12 组注入 payload 全拒 | test/block405-l1-security.test.mjs（红 4/4→绿）、platform-compat + workspace-roots + terminal-multisession 21/21 |
| L1-2 | done | validateMcpConfig stdio：command 裸名白名单（node/npm/npx/python/uv/uvx/deno/bun/java）+ args 禁求值开关（-e/--eval/-p/--print/-c/--command/-x/--exec/-i）+ 禁相对逃逸；confirmInstall mcp 分支 expected.mcp 逐字段对账（缺/漂移即拒）；前端 InstallDeepLinkDialog 发送 expected.mcp；修法选型=白名单+对账（非默认禁用，同等拒面保留合法通道） | 红 3/3→绿；block242 8/8（TOCTOU 零回归 + 新语义） |
| L1-3 | done | 回环谓词单源（local-request-boundary.isLoopbackHttpOrigin：http+显式端口+精确主机名）；四读取点统一过滤（env-coordinator existing/devURL、boundary 全 env 源、_ipc-trust、security-hardening）；空 Origin 变更动词 token 门（PETRI_LOCAL_REQUEST_TOKEN env 门控；main 每 boot 随机生成；server 落 0600 文件；automation-runner/workflow-tools 自调用 + 10 个 dev-verify flow 已带 token 头）；BLOCK-84 既有断言按新语义翻转 | 红 3/3→绿；邻域 17/17；drag-out GET 零回归 |
| L1-4 | done | isNavigableWebUrl（http(s)+非回环+无 userinfo）；BrowserPanel.navigate 每次 loadURL 前过门；bridge navigate 同源复检；iframe sandbox（无 allow-same-origin，观感归 E）；HEAD 对照 BrowserPanel warning 2→1 | vitest browser-url + bridge 14/14 |
| L1-5 | done | CSP：localhost:*/127.0.0.1:* 全数移除，dev 收敛 {3000,3001+ws}、prod {3001}；L-57 权限装配失败→deny-all 兜底；L-60 导航门 origin 精确比较（主窗 + pop-out）+ openExternal 统一准入（external-url-policy：http(s)+无 userinfo+主机非空） | 负测：CSP 双模无通配 + openExternal 8 组拒面矩阵 |
| L1-6 | done | Keychain -w 末位无值 stdin 传值（argv 不再携带密钥）；io-transcript 落盘 0600 + 写前 redactSensitiveValue（无命中内容逐字不变）；/record 会话归属校验（生产注入 assertConversationOwnership；403/404/503 fail-closed 分离） | credential-store 6/6；block37 双套 22/22；负测 0600+脱敏占位 |
| L1-7 | done | docs/post-s7-h1-admission-fk-decision-material.md 加第五轮复核注记（L-56/L-79 维持 pending_user_ruling，默认语义零改动） | acceptance/post-k7-2026-11-10/l1/u-materials-pointer.json |
| L1-8 | done | 依赖静态清单（native=better-sqlite3/node-pty；预发布/range 标记；零新增依赖）；CVE 联网扫描 external-blocked；钉扎评估归 L5-6（L-78） | acceptance/post-k7-2026-11-10/l1/dependency-static-inventory.json |
