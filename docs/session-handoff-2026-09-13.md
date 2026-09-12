# 交接提示词 · 新会话继续开发（2026-09-13）

> 用途：复制下面「提示词正文」整段，粘贴到新的对话框 / 新 agent 会话。
> 本文件本身是交接附件，不是 canonical 状态源（状态以 Git / AUDIT-LOG / DOC-REGISTRY 为准）。

---

## 提示词正文（复制从这里开始）

```
你是 Gewu Desktop（格物，原名 BioF3）项目的开发 Agent。继续在本仓库推进开发。

工作目录：D:\1.WorkDir\biof3-desktop
当前分支：main（与 origin/main 零差量，工作区干净）

# 一、开工前必读（顺序不可变）

1. `AGENTS.md` —— 唯一工程指令。**先读「当前阶段纪律（最高优先级 · G0 长期开发期）」整节**，
   这是本项目最容易越界的地方。
2. `docs/AUDIT-LOG.md` —— 审计广播台。先看头部「最后更新」段与活跃广播表，
   🔴 阻塞项先处理，🟢 评估项登记归属。
3. 跑 `npm run state` —— 一键恢复：分支/WIP/AUDIT-LOG 未决/active 工作包。
4. 读 `docs/next-steps-roadmap.md` + `docs/project-workspace-handoff.md`。
5. 读当前 active 工作包 plan：`docs/block-84-domain-pack-oneclick-plan.md`。

若以上入口与 canonical 文档冲突，**以 Git / SQLite / Artifact Truth / Acceptance Evidence /
canonical 文档为准**，先降级冲突声明再修复入口，不要挑对实现最方便的一份。

# 二、G0 开发期铁律（违反即越权）

项目**长期处于 G0 开发期，不是发布期**。用户已于 2026-08-15 显式裁决，任何提前进入 G1+ 的提议都是越权。

- `qualificationEligible: false` 是 G0 常态事实，**不是缺陷、不是待办**。
- **禁止**主动建议或启动：Provider 矩阵实做 / 公证签名 / GA 流水 / 远程发布 / dist staleness。
- **禁止**在收口报告、closeout 笔录、AUDIT-LOG、ui-productization-audit 反复写
  「qualificationEligible 维持 false」「未做 Provider」「未做 GA」。
- 收口笔录用语一句话即可：**「G0 开发期常态 · 不外推 packaged/Provider/GA」**。
- `dev Electron 边界内 verified` / `packaged 边界内 verified` 就是**当前阶段最高证据等级**，
  不需要补 G1+ 才有的 Provider / GA。
- 用户若未明确裁决启动 G1+，**禁止**主 Agent 主动提「要不要做 Provider / GA / release-pipeline」。

# 三、当前状态（截至 2026-09-13）

- **分支**：main，本地与远端零差量，工作区干净。
- **最近 5 提交**：
  - `d5a62b2e` docs(skill): gewu-dev-infra 第 9 条——Windows 测试债四类固定因根
  - `803a8b3d` docs(audit-log): 回写 TEST-INFRA-DEBT-3 存量测试债清债（33 项 → 0）
  - `ce0cff4d` chore(test-infra): 存量测试债清债 + R bundle 解包 Windows 可用性修复
  - `16ebdde3` docs(block-84): plan v1.2 补提交哈希（P1/P2/P3 三 commit 链）
  - `ec3b675d` chore(block-84): P3 收口——测试门禁基建双修 + plan v1.2 / AUDIT-LOG 回写
- **active 工作包**：`BLOCK-84-DOMAIN-PACK-ONECLICK`（P1+P2+P3 均已收口执行，
  plan 状态头仍为 active，**待用户裁决是否转 completed 或加新阶段**）。
- **planned 排队候选**：G0-RS、G0-SDC、BLOCK-70-MOBILE-SYNC。
- **近期完成**：BLOCK-83-GENERAL-AGENT-BASE 整包 completed（核心=纯通用 agent 工作台；
  生信=独立领域包 `Diandian-ops/gewu-pack-bio`）；TEST-INFRA-DEBT-3 存量测试债清零。

# 四、两条待用户裁决的遗留（不要自行决定，先问）

## 遗留 A：BLOCK-83 P4「A 类随包迁出」核心仓旧副本（101 项红）

事实：9 个测试（5 插件 smoke + deseq2-report + g0-chf0-science + p4r-corpus + harness-file-index）
**已迁入 `gewu-pack-bio` 并在彼处运行，但核心仓旧副本未删除** → 核心侧另计 101 项红。
另含 C 类 2 个（`g0-rs-p5-acceptance` / `g0-rs-p6-electron-pressure-prototype`）应按
`docs/block-83-general-agent-base-plan.md` §P4 改成「包存在则跑、缺失带理由显式 skip」，未执行。

选项：① 删核心旧副本 + 按 plan 改 C 类 skip（一次清干净）；② 先挂账继续别的线。
**必须先问用户，不要自行删测试。**

## 遗留 B：AUDIT-LOG 两条 🟢 未决

- 🟢 [2026-09-12] better-sqlite3 ABI 漂移 + Windows 路径反模式——已在 TEST-INFRA-DEBT-3 量化，
  其四类因根已固化进 `gewu-dev-infra/SKILL.md` 第 9 条，评估是否可销号。
- 🟢 [2026-08-15] T-AW-013 DIST-STALENESS：dist/mac-arm64/BioF3.app 内嵌 asar 来自 2026-08-14 build。
  **注意：这条属 G1+ 范畴，按当前阶段纪律不应主动推进重打包**，如需处理先回到 AGENTS.md 阶段纪律确认。

# 五、开发环境硬前置（踩过坑，照做）

- **必须用 Node 24**：shell PATH 的 `node` 默认解析到系统 `D:\Program Files\nodejs`（v22.22.2），
  而 better-sqlite3 / node-pty 按 Node 24 ABI（137）编 → db 触碰型套件整文件
  `ERR_DLOPEN_FAILED`。开工先 `fnm use 24`；切版本后需 `npm rebuild`（根 + `core/biof3-server`）。
  自检：`node scripts/dev/verify-toolchain.mjs`。
- **启动 GUI 前必须 `unset ELECTRON_RUN_AS_NODE`**，否则 electron 二进制退化成 node，
  `require('electron')` 返回路径字符串，main.js 崩在 `app.requestSingleInstanceLock()`。
- **启动 dev 栈**：`npm run dev`（Vite :3000 + biof3-server :3001 + Electron GUI）。
  带 CDP 调试：`BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev`。
  Windows 下若 :3000 已被占，`npm run dev` 会拒绝启动（BLOCK-35 安全逻辑）——
  此时后端已在跑，直接 `electron.exe . --dev` 挂接即可。
- **后端（core/**）改动后必须重启 dev Electron 才载入。**
- **实机验证前对改动的前端文件 touch 并核对 Vite 所服务模块**——Windows 上 Vite 文件监听
  间歇性漏写（磁盘已改而模块图陈旧，直接白屏）。必要时重启 dev 栈。

# 六、门禁与测试纪律（按顺序，别跳）

日常（秒级，必跑）：
- `npm run docs:check` —— 文档治理门禁
- `npm run ui:audit:check` —— UI 台账门禁
- `npm run hygiene:check` —— 工作区卫生（死链 / 临时残留 / 换行漂移）

收口（fail-fast 聚合）：
- `npm run closeout` —— hygiene → docs → ui-audit → test:changed
- 当前工作包有专项门禁时用 `--gate <npm-script>` 挂上

定向测试（**默认方式，不要跑全量**）：
- `npm run test:changed:list` —— 预览影响范围（unknown 必须为 0；unknown>0 则 fail-closed 升级全量）
- `npm run test:changed` —— 跑影响范围内的定向测试
- 手工收窄：`node --test <files>` / `npm run test:files --prefix frontend -- <files>`

**默认不跑**（留给发布前 / CI）：
- `npm run check`（全量静态检查 + 所有门禁）
- `npm run test:all:workspace`（1300+ 项，数分钟）

若因此存在未验证范围，**必须在收口报告里如实说明，不得把定向通过表述为全量通过**。

# 七、基线对照纪律（本仓踩过两次真丢改动）

判断「某批测试红是不是我引入的」时：
- **可逆对照只对「已提交」内容成立**。
  - `git stash` 前提 = 工作区干净且**无他方在制**；
  - `git checkout <base> -- <files>` 前提 = **这些文件内容已提交**（否则 HEAD 版即回退目标，真丢）。
- 纪律：① 回退前看 `git status` **全量**（不许 `| head` 截断）；② 未提交改动先落提交或仓外备份；
  ③ 恢复后用**内容断言**核验（如 `grep -c <关键符号>`）而非只看退出码。
- **优选**：改动成批提交后，用 `git checkout origin/main -- <本包模块>` + `git checkout HEAD --`
  做对照——两侧都是提交内容，双向可逆。
- 最新教训（已固化 `gewu-dev-infra/SKILL.md` 第 8 条）：本项目已两次因基线回退丢失未提交改动
  （一次 stash 卷入他方 WIP，一次 checkout 未提交的 P3 改动）。

# 八、Windows 测试债四类固定因根（已固化 SKILL.md 第 9 条）

排查任何 Windows 专属失败前先对号入座，命中即用标准修法：

1. **tar 盘符陷阱**（**可能是真实产品缺陷，不只是测试债**）：bsdtar 把 `C:\...` 当远端主机
   → `Cannot connect to C: resolve failed`。修法＝`--force-local` + **参数正斜杠归一化，两者必须配套**
   （`--force-local` 会转义反斜杠，`...\installed` 被拆成 `...\i` + `nstalled`）。
   **纪律：发现测试里 tar 挂了，必须回查生产代码有没有同一个 tar 调用**——
   本仓 `core/shared-backend/capability-bundles.js` 就是同坑，曾导致 R 能力包在 Windows 完全不可用。
2. **pathname 双根 ENOENT / Cannot find module**：`new URL('../x', import.meta.url).pathname`
   在 Windows 产出 `/D:/...` → `resolve()` 拼出 `D:\D:\...`。修法＝`fileURLToPath()`；
   ESM 动态 import 用 `pathToFileURL(resolve(...)).href`。
3. **better-sqlite3 EPERM teardown**：单例连接句柄进程退出前不释放 → `rmSync` 临时目录抛 EPERM。
   修法＝teardown try/catch 容忍 EPERM/EBUSY，**不要改生产代码的连接生命周期**。
4. **契约漂移伪装成环境债**：路由文件被拆分（测试读旧路径）/ 表新增列（SQL 精确断言失配）/
   mock 机制换代（`globalThis._biof3Plugins` 已废，改 `process.env.BIOF3_BUILT_IN_PLUGINS_DIR`）。
   判据＝**错误信息里的符号名在源码中已不存在或已改名**。

# 九、并行会话纪律（本仓有多会话在制历史）

- 开工前先 `git status` 全量确认工作区归属；未跟踪的在制文件可能是**别的会话的 WIP**，
  **只列出、绝不清理、绝不误入本包提交**。
- 提交前 `git add <明确路径>`，**不要 `git add -A`**（本仓曾误扫入他方 122 行 WIP）。
- 同仓双会话期间「开工时干净」不构成开工条件；后端 / 共享面一律排队。

# 十、项目自有 Skill（按需加载，别凭记忆做事）

- `gewu-project-governance` —— 立项 / 收口 / 归档 / worktree 治理时用。
  canonical: `.agents/skills/gewu-project-governance/SKILL.md`
- `gewu-dev-infra` —— 会话启动 / 收口 / 实机验收 / 工作区卫生 / 写产品 Skill / 委派子 Agent 时用。
  canonical: `.agents/skills/gewu-dev-infra/SKILL.md`
- `gewu-code-review` —— 评审 diff / 写审计报告时用。
  canonical: `.agents/skills/gewu-code-review/SKILL.md`

**治理硬线**：未跑 `npm run docs:reconcile` 并通过 `npm run docs:check`，
不得宣布工作包 `completed` / `qualified` / `verified` / 已归档收口。

# 十一、你的开工动作

1. 读 AGENTS.md 阶段纪律 + AUDIT-LOG 头部 + 跑 `npm run state`。
2. 向我汇报：当前 active 包状态、AUDIT-LOG 是否有 🔴、两条遗留（§四）怎么处置。
3. **在我说「继续 / 开始」之前不要动代码**——我需要先确认你要做哪条线。
```

## 提示词正文（复制到这里结束）

---

## 附：本交接的关键事实速查

| 项 | 值 |
|---|---|
| 工作目录 | `D:\1.WorkDir\biof3-desktop` |
| 分支 | `main`（零差量） |
| HEAD | `d5a62b2e` |
| active 工作包 | BLOCK-84-DOMAIN-PACK-ONECLICK（P1–P3 已收口，槽位待释放裁决） |
| planned 候选 | G0-RS / G0-SDC / BLOCK-70-MOBILE-SYNC |
| 生信包仓 | `D:\1.WorkDir\gewu-pack-bio` → `Diandian-ops/gewu-pack-bio` |
| 前端 dev | Vite :3000 / biof3-server :3001 / CDP :9222 |
| Node | **必须 24**（fnm） |
| 未决债 | 101 项 BLOCK-83 A/C 类 + AUDIT-LOG 2 条 🟢 |
