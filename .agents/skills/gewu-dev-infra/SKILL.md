---
name: gewu-dev-infra
description: Use Gewu development infrastructure when starting or resuming a session, before claiming a work-package closeout, verifying UI work against the dev Electron stack, checking workspace hygiene, authoring or validating product Skills, or delegating tasks to subagents. Self-contained toolkit bundled in this folder scripts, templates, principles, and a PORTING guide for reuse in other repos.
---

# Gewu Dev Infra（开发基础设施 · 自洽工具包）

把重复的开发实践固化成机械门禁；只固化流程与判据，永不固化状态类事实（状态只活在 canonical 文档）。

## 本文件夹就是资产的 canonical 家（拷走即复用）

```
.agents/skills/gewu-dev-infra/
├── SKILL.md                        # 本文件：流程入口
├── PORTING.md                      # 跨仓库复用指南（拷贝 + package.json 接线 + 可移植性矩阵）
├── scripts/                        # workspace-state / hygiene-check / closeout-gates / normalize-eol（位置无关）
├── dev-verify/                     # lib.cjs 四原语 + run.cjs 注册表 + flows/ + _template.cjs
├── templates/delegation-contract.md# 子 Agent 委派任务书模板
├── references/FILE-TREE-POLICY.md  # 文件树纯净策略（区域生命周期 + scripts 归档判据）
└── references/PRODUCT-PRINCIPLES.md# 产品原则自包含速查（宿主有 AGENTS.md/治理 skill 时冲突以宿主为准）
```

仓库内由 `package.json` 接线：`npm run state / hygiene:check / closeout / verify`；产品 Skill 工具 `skills:check/scaffold` 是产品轨道（`scripts/skill-scaffold.mjs`），不在本包内。

## 开始或恢复会话

- 先跑 `npm run state`：分支/WIP、AUDIT-LOG 未决（🔴 先处理、🟢 评估）、active 工作包。
- 输出与 canonical 文档冲突时以 canonical 文档为准；本命令是聚合呈现，不是第二真相源。

## 宣称收口之前

- 跑 `npm run closeout`（hygiene → docs:check → ui:audit:check → test:changed，fail-fast）；当前工作包有专项门禁时用 `--gate <npm-script>` 挂上。
- 门禁全绿是收口的必要条件不是充分条件：canonical 回写（work package / roadmap / handoff / AUDIT-LOG / ui-audit 台账）仍按治理纪律单独完成。
- 属于其他线/并行包的红旗如实登记归属，不得表述为本包通过。
- 收口提交落定后打进度快照标签：`git tag -a snapshot-YYYYMMDD -m "<本 BLOCK 一句摘要>" && git push origin snapshot-YYYYMMDD`。日期命名，同日第二个加 `-2` 后缀；`v0.0.1-rc.*` 序列语义是「OSS 线上工程候选版」，只在真正更替候选版时才动，不跟 BLOCK 收口走（用户裁决 2026-09-17：日常进度锚点只走 snapshot，每个 BLOCK 收口一个）。

## dev 栈上验证 UI 工作

- 前置：dev Electron 以 `BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222"` 在跑（fnm Node 24）；后端代码变更后必须重启 dev Electron。
- 从 `dev-verify/flows/_template.cjs` 拷贝新建 flow，用 `dev-verify/lib.cjs` 原语组装断言（pollTargets / filterPageTargets+selectPageTarget / evalJs / screenshotPng / createRun），跑 `npm run verify -- <flow>`；清单 `npm run verify -- --list`。
- 主窗判定按项目树+右栏探测，不信任 visibilityState（BLOCK-68 教训）；证据 JSON/PNG 落 `acceptance/`，断言不可编造。

### 无人化验收阶梯（能不用人就不用人 · 确保成功；用户裁决 2026-09-10）

验收方式按阶梯选择，向自动化收敛；升上一级的唯一理由是下一级够不着：

1. **CDP 够得着 → dev-verify flow**：断言/截图/证据 JSON 一律由脚本产出，人不参与操作；人工步骤能写成 flow 的必须写成 flow。
2. **CDP 够不着 + 失败影响低 → 诚实分级，不凑证据**：台账停留 `in_progress` 或如实标注验证边界（如「dev Electron 边界内 verified」），不得为过门禁补拍形式化截图。
3. **CDP 够不着 + 失败影响高（原生对话框/覆盖确认/OS 权限等）→ OS 级自动化优先**（UIA / computer-use 脚本化），人工只做脚本建不起来时的最后兜底（兜底姿势见第 4 级）。
4. **人测兜底 → 自动产出测试路线 + 人测体感确认（用户裁决 2026-09-10）**：自动化全部够不着时，Agent 必须先自动生成详细测试路线（操作步骤、输入内容、每步预期、证据留存点），人照路线实测；人体感成功并明确回复确认「没问题」即通过。该次验收的证据 = 测试路线原文 + 人的确认记录（日期、覆盖断言），登记进台账或 `acceptance/`；确认必须出自人，Agent 不得代答。

硬线不变：`verified` 必须有证据背书，断言不可编造——第 1～3 级证据由脚本产出，第 4 级证据 = 自动生成的测试路线 + 人的明确确认记录；无人化降低的是人的参与度，不是证据等级。

### Windows/中文实机脚本纪律（BLOCK-76 实测固化 · 多次踩坑后升格为规则）

本机为 Windows + Git Bash + 中文（GBK 控制台）环境，以下规则防的都是本会话实际炸过的坑：

1. **多行脚本一律落盘执行，禁止内联**。`node -e "…"` / `powershell -Command "…"` 写超过几行的逻辑必炸：bash 双引号先吃 `${…}` 和 `$(…)`，PowerShell 再做第二层解析，转义叠加不可控。正确姿势：`Write` 落盘 `.cjs`/`.ps1` 文件 → `node file` / `powershell -File file` 执行。
2. **.ps1 必须 ASCII-only**。PowerShell 5.1 对无 BOM 文件按 ANSI/GBK 解析，UTF-8 中文注释会直接炸 here-string 解析器；注释写英文。跨进程传中文数据走 base64（控制台输出编码不可控，GBK/UTF-8 混用必出乱码——例：`block75-enum-windows.ps1` 标题走 b64）。
3. **spawn/参数长度硬上限**：Windows 进程命令行 ~32KB（thin per-call 大参数必 ENAMETOOLONG）；Linux `MAX_ARG_STRLEN` 128KB/参数（execve E2BIG，且 gateway exec 会把整条命令再 b64 一次——双重膨胀）。大载荷一律 stdin 分块（参照 `ssh-direct-runner` 64KB 块），禁止拼大命令行。
4. **CDP Input.insertText 在 CodeMirror 场景不达**（焦点不属编辑器时静默丢失，甚至误落聊天输入框）——编辑器注入用已验证配方：`cm.focus()` + `document.execCommand('insertText', …)`（block67-p1-live 同款）。
5. **Write 产出即校验**：写完脚本先 `node --check`；含嵌套 `${…}` 的模板串若报语法错，改写为字符串拼接（Write 管线对该构造偶发损坏，p1/p4 live 脚本均踩过）。
6. **验证脚本不信任前台**：原生弹窗受 Windows 前台锁影响不一定是前台窗口——EnumWindows 枚举 + hwnd 直投（`scripts/lib-block75-os.cjs`），sidecar 对后台窗口的 snapshot/type/click 均可用。
7. **工作区换行漂移是最隐蔽的一类平台坑**（2026-09-11 转化为门禁，同类第二次出现）：Windows 编辑器/工具会把工作区文件写成 CRLF，而 `.gitattributes` 的 `text=auto eol=lf` 让 **git 的内容比对看不见它**——`git diff` 为空，stat 缓存命中时 `git status` 连 `M` 都不显示（本仓库实测曾有 44 个 CRLF 文件静默存在而 status 干净）——漂移只在「读工作区原始字节与 blob 比 SHA」的校验器里现形：2026-08-07 是 `npm run check` 整链（migration SQL / golden fixture / acceptance 证据 SHA），2026-09-11 是 `g0-rs-p6` 的 `sourceMismatches` 恒红并被误登记为「P6 证据未重采」两周。**排查纪律：遇到任何 SHA/逐字节比对的门禁恒红，先查换行漂移（`git ls-files --eol`），别先怀疑证据过期**。检测 `npm run hygiene:check`（检查项 3），归一 `node .agents/skills/gewu-dev-infra/scripts/normalize-eol.mjs --write`（只改写换行字节；对内容与索引一致的文件顺带刷新索引 stat 缓存、不产生提交内容变化，带真实 WIP 的文件跳过、不动你的暂存状态）。

## 端口与后端实例纪律（BLOCK-85 双真机夜沉淀 · 2026-09-18）

> **适用范围＝双端 Agent 绑定（唯一标准源）**：本节同时约束 Mac 侧与 Windows 侧的所有开发 Agent——本 skill 随仓库分发，pull 到哪端就在哪端生效，任何一端不得私设端口规则、不得以聊天转述代替本表。Windows 侧脚本/编码纪律另见本文件「Windows/中文实机脚本纪律」节，两节叠加适用。

1. **dev 栈双后端形态是既成事实，跨进程凭证必须同源**：dev-electron 的 `npm start` 后端（固定 :3001 API + :3005 网关）与 Electron main boot 自spawn 的后端（`R_SERVER_PORT` 未设 → 随机端口，renderer 的 `rApiBase` 指向它，日志 `[desktop] biof3-server spawned … reason=boot`）**共享同一 dataDir 但各自持有配对存储与隧道管理器** ⇒ 跨进程单例状态全部脑裂。实操纪律：① 凡遇「面板发的码对端兑换不了 / 面板状态与 REST 不一致 / 出码形态对不上」，第一步核对 `window.biof3Desktop.backendConfig.rApiBase` 与目标网关是否同进程（`lsof -iTCP:<port> -sTCP:LISTEN` 看 pid 归属；Windows 侧等价：`netstat -ano | findstr <port>` + 进程号核对）；② 需要跨端兑换的凭证（配对码等）必须从**拥有网关的进程**的 REST 签发（:3001），不要用面板 UI 出码做跨机验收；③ 结构性修复方向＝dev 模式下 Electron main attach 到 :3001（复用 BLOCK-100 测试实例 attach 机制），修复落地前本条长期有效。

2. **反向隧道端口「一机一口」登记制（本表＝唯一真相源）**：隧道管理器带「spawn 前清场」逻辑（杀远端端口占用者），两端配置同端口＝互杀循环。症状指纹：子进程存活秒级即死、exit 0/255 交替出现、对端请求周期性 502 空窗、sshd 日志出现密集「sweep+main」连接对。**现行分配（runbook/聊天/旧文档与本表冲突时以本表为准）**：Mac 隧道 2234（公网 https://47.110.228.168:8443，nginx `gewu-mac.conf`）；Windows 隧道 2233（公网 https://47.110.228.168:8442，nginx `gewu-windows-8442.conf`）；ECS frps 另有 6022=Dell SSH、8787=Dell RStudio、3001/3002=Dell 侧旧服务（与 Windows 格物无关）。改端口必须两端同批生效并互报 probe。

3. **长连接隧道必须绕开代理 TUN**：Clash/mihomo TUN 会接管 ssh 流量，代理侧会话回收＝隧道周期性死亡。症状指纹：每几分钟到十几分钟干净退出（code 0）、`route get <host>` 显示 utun 接口。纪律：隧道主机 IP 加代理 DIRECT 规则（`IP-CIDR,<ip>/32,DIRECT,no-resolve`，2026-09-18 已加 47.110.228.168）或测试期关 TUN；**隧道健康判据＝子进程存活跨过 15 分钟**，不是管理器 `state=connected`（那只是 10 秒启发）。

4. **清场/杀进程逻辑必须可解释、可豁免**：按命令行签名匹配的 kill（orphan sweep 类）在多实例/多机场景会误杀友军；新增任何「启动前清理」必须带 excludePids 豁免 + 每次实际 kill 打印 pid 与匹配签名到日志，否则互杀排查时无证据可读。

5. **双端协同协议（先查后动 · 同批生效 · 互报 probe）**：任何一端 Agent 在动隧道/网关/公网映射前必须——① 查本节分配表，**禁止自选端口**；② ECS 上 `ss -tlnp` 确认目标端口当前占用者（有主即停，先协商再动手）；③ 本端改动落地后向对端回报 probe 结果（curl 对端公网 `/api/mobile/status`，期待 401 + session_invalid 形 JSON），**两端 probe 全绿才算切换完成**；④ 分配表变更以本 skill 的 git 提交为准（push 后对端 pull 生效），口头/聊天约定不算登记。

6. **跨端公网门是自签 HTTPS，后端 fetch 必须预置 CA 信任**：双端公网门（443/8442/8443）均为 ECS 自签证书；对端**后端**（Node）fetch 该地址会撞 `DEPTH_ZERO_SELF_SIGNED_CERT`——此坑只在跨端配对/互访时暴露，单机自测永远正常。修法（推荐 ①）：① 从 ECS 拷 `/etc/nginx/ssl/gewu.crt` 到本机固定路径（Windows：`.biof3-dev-user-data/ecs-gewu.crt`），**栈每次启动前**设 `NODE_EXTRA_CA_CERTS=<crt 绝对路径>`（**已固化进 restart-dev-stack.sh**：crt 在位即自动 export，Windows 经 bash→PowerShell→Start-Process 链路传播到后端子进程；2026-09-18 Windows 侧落地）；② 测试期捷径 `NODE_TLS_REJECT_UNAUTHORIZED=0`（全量关校验，仅测试期）。

7. **跨端出码命令与 token/host 分离**：配对 token 5 分钟 TTL，由**拥有网关的进程 :3001** 签发（第 1 条脑裂纪律）——标准命令 `curl -X POST http://127.0.0.1:3001/api/mobile/pairing/token -H "Authorization: Bearer desktop-local" -d "{}"`（双端同形，禁用面板 UI 出码做跨机验收）。**token 与 host 分离**：收到的码是 LAN 形态（`http://192.168.x.x:<gw>/pair?token=…`）时，对端可将 host 替换为该端公网门（前提=该端隧道 connected 且 nginx 映射在）后提交 `/federation/peers/pair`，token 依然有效——跨网段配对的正路。验收期间挂外部端到端探测（10s 级 `curl -k <公网门>/api/mobile/status`，401=活）留时间线：`state=connected` 与端口 held 都可能假活（半开 TCP），失败对账以监控时间线为准，不以管理器状态为准。

## 保持工作区干净

- `npm run hygiene:check` 报告死符号链接、临时残留与**工作区换行漂移**；它只报告不代删，处置由人裁决（换行归一用 `scripts/normalize-eol.mjs --write`）。
- 未跟踪的在制文件是别的包的 WIP 时只列出，绝不清理、绝不误入本包提交。

## 编写产品 Skill（resources/skills/）

- `npm run skills:scaffold -- --scaffold <id> --name "<名称>"` 生成骨架 → 在 `resources/skills/manifest.json` 登记 → `npm run skills:check` 全绿。
- 两条轨道不要混：产品 Skill（`skill.json`，服务应用运行时 skill-registry）住 `resources/skills/`；Agent 实践资产（`SKILL.md`，服务 AI Agent）住 `.agents/skills/`。

## 委派子 Agent 工作

- 按 `templates/delegation-contract.md` 填任务书；哪个区块填不满，说明该任务还不该委派。
- 子 Agent 的完成声明不构成收口：主 Agent 复核 diff + 复跑验证命令后才可集成宣布。

8. **基线对照的可逆性只对「已提交」内容成立**（2026-09-12 实测丢失一次 P3 改动，同类第二次出现——第一次是 `git stash -u` 卷入他方在制文件）：为判定「某批测试红是不是我引入的」，惯用「把改动回退到基线跑一遍再恢复」。两种回退法的**前提条件不同、危险性也不同**——`git stash` 的前提是工作区干净且无他方在制，`git checkout <base> -- <files>` 的前提是**这些文件的内容已经提交**（否则 HEAD 版即回退目标，恢复时取到的就是旧内容＝真丢）。**纪律**：① 回退前先看 `git status` 全量（不许 `| head` 截断）；② 未提交的改动先落提交或复制到仓库外备份，再回退；③ 恢复后用内容断言核验（如 `grep -c <关键符号>`）而不是只看命令退出码。**优选**：改动已成批提交后，用 `git checkout origin/main -- <本包模块>` + `git checkout HEAD --` 做对照——两侧都是提交内容，双向可逆。

9. **Windows 测试债四类固定因根，先按类判断再动手**（2026-09-12 TEST-INFRA-DEBT-3 清债 33 项固化；这四类几乎覆盖本仓 Windows 侧全部「非我引入」红）：排查任何 Windows 专属失败前，先对号入座，命中即用对应标准修法，不要在测试体里乱猜。
   - **① tar 盘符陷阱（可能是真实产品缺陷，不只是测试债）**：Windows bsdtar 把以盘符开头的路径参数（`C:\...`）当成**远端主机规格** → `tar (child): Cannot connect to C: resolve failed`。**修法＝`--force-local` + 参数正斜杠归一化，两者必须配套**：`--force-local` 会转义参数里的反斜杠，`...\installed` 被拆成 `...\i` + `nstalled`。POSIX tar 接受 `--force-local` 为空操作（可无条件加）。**关键纪律**：发现测试里的 tar 挂了，**必须回查生产代码有没有同一个 tar 调用**——本仓 `core/shared-backend/capability-bundles.js` 的 `installTarGzBundle` 就是同坑，导致 R 能力包安装在 Windows 上完全不可用（用测试修法掩盖产品缺陷＝漏修）。
   - **② pathname 双根 ENOENT / Cannot find module**：`new URL('../x', import.meta.url).pathname` 在 Windows 产出 `/D:/...`（前导斜杠 + 反斜杠混用），`resolve()` 拼出 `D:\D:\...`。**修法＝`fileURLToPath()`**；ESM 动态 import 同理用 `pathToFileURL(resolve(...)).href`（直吃 Windows 绝对路径报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`）。
   - **③ better-sqlite3 EPERM teardown**：模块级单例连接句柄进程退出前不释放 → `rmSync` 临时目录抛 `EPERM/EBUSY`（测试体已通过、after 钩子才炸）。**修法＝teardown try/catch 容忍 EPERM/EBUSY**，不要为它改生产代码的连接生命周期。
   - **④ 契约漂移伪装成环境债**：路由文件被拆分（测试仍读旧路径，报「route is unavailable」）／表新增列（SQL 精确断言失配）／mock 机制换代（`globalThis._biof3Plugins` 已废，改 `process.env.BIOF3_BUILT_IN_PLUGINS_DIR`）。**判据**：错误信息里出现的**符号名在源码中已不存在或已改名**，即契约漂移而非环境问题——修法是让测试追上契约，不是让契约退回测试。**附**：断言基于「消息文本」而非「决策结构」的测试要特别警惕（本仓 BLOCK-10 S-003 重构后，断言 domain 消息文本等于复活 prompt-injection 漏洞——此类断言应改锚决策结果／中性夹具）。

## 复用到其他仓库

读 [PORTING.md](./PORTING.md)：整目录拷贝 → package.json 四行接线 → 按可移植性矩阵处理降级项。原则速查见 [references/PRODUCT-PRINCIPLES.md](./references/PRODUCT-PRINCIPLES.md)（非 canonical）。
