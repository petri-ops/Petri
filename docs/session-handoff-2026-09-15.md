# 交接提示词 · 新会话继续开发（2026-09-15 · G0-RS 整包收尾）

> 本文档是 2026-09-15 会话（macOS 指挥席）交接：G0-RS P2 P4R-CORPUS 已当日收口 completed 并推送；
> 剩最后一环 = **G0-RS 整包 closeout**（P6 重采 + ui observation 补跑 + 收口回写），换 Agent 继续。

## 提示词正文（复制从这里开始）

### 一、开工前必读（顺序不可变）

1. `docs/AUDIT-LOG.md`（当前无 🔴 阻塞项；🟡 均为用户裁决 deferred）
2. Git/运行时/Acceptance 证据对账（`git status`、`git log --oneline -10`）
3. `docs/next-steps-roadmap.md` → `docs/project-workspace-handoff.md` → `docs/g0-result-studio-plan.md` 状态头
4. 项目自有 Skill：`$gewu-project-governance`（启动/收口必走）、`$gewu-dev-infra`、`$gewu-code-review`

### 二、G0 开发期铁律（违反即越权）

- 长期 G0 开发期：不外推 packaged/Provider/GA；`qualificationEligible: false` 是常态不是待办；收口笔录「G0 开发期常态 · 不外推 packaged/Provider/GA」恰一次。
- 单工作包串行：当前 active 槽位 = **G0-RS**（phase P2-COMPLETED，剩整包 closeout）。
- 收口语义：`completed` 每个字都要契约证据；Result Studio 维持 `implemented_unverified / experimental`；P7 维持 `deferred`。
- 包仓 `gewu-pack-bio` 只读不改动；核心树零领域回流。

### 三、当前状态（2026-09-15 · 全部已推送 origin/main）

- `main` 零差量，HEAD `77a44773`（= origin/main；中途 rebase 收编过并行 UI-376/377 两笔）。
- **本会话完成**：G0-RS P2 P4R-CORPUS（p4r corpus 链包感知化）当日收口 completed。
  - 交付：`scripts/g0-rs-p4r-pack.mjs` 包感知层（包根解析 `BIOF3_BIO_PACK_ROOT`→兄弟仓 `../gewu-pack-bio`；`plugins.dormant/` 封存兼容；复制式 staging；`BIOF3_DEVELOPMENT_PLUGIN_DIRS`+`BIOF3_DOMAIN_TOOL_REGISTRY` 注入；fail-closed）+ corpus/baseline/live/ui/source-observation/invariants 六处服务端 env 同源接线 + corpus 显式输入落项目工作区。
  - 证据：corpus 封存态 4 步全产物（真实 R：deseq2 23/volcano 5/corr 3/go-kegg 19 artifacts）；`p4r:test` 231 项 0 红 0 跳；`p4r:perf` 14/14（17.6ms vs 冻结 250ms）；source-observation allFourVerified（desktop@1357c4c4 + 包仓@21d610c 双绑定）；live 19 检查全绿（含真实后端重启恢复）；closeout 四门绿。
  - 顺手清两笔存量债：`scripts/g0-rs-p4r-baseline.mjs` 缺 `pathToFileURL` import（p4r-baseline 测试恒红）；`test/agent-tool-registry.test.mjs` 硬编码 53→57（BLOCK-77 +3 / BLOCK-85 +1 未跟）。
- 提交链（rebase 后哈希）：`0712a5ae` 启动登记 → `052fd666` 实现 → `6523c3a9` corpus 输入落工作区 → `45699ee4` source-obs dormant 绑定 → `6e685f7b` live pack 字段 → `1357c4c4` P2 收口回写 → `77a44773` rebase 对账收编。
- 包仓 `../gewu-pack-bio`：`0.1.1`（`21d610c`，14 插件封存 `plugins.dormant/`，deseq2 唯一活跃），本地零改动。

### 四、剩余工作（唯一主线：G0-RS 整包 closeout，按序）

#### 第 1 步 · P6 重采（两处预修后跑）

1. **预修 A（真缺陷，必修）**：`scripts/g0-rs-p6-electron-pressure-prototype.mjs:244` `loadGoKeggPressureInput` 硬编码 `<packRoot>/plugins/go-kegg/demo-data/genes.csv`——封存态下 go-kegg 在 `plugins.dormant/`，实跑 ENOENT（测试 `test/g0-rs-p6-electron-pressure-prototype.test.mjs:221` 抓到）。修法 = 复用 `scripts/g0-rs-p4r-pack.mjs` 导出的 `locatePackPluginDir(packRoot, 'go-kegg')` 做 dormant 感知定位（先例已建，勿另起炉灶）。
2. **预修 B（无需修码，重采即解）**：存量 P6 证据（今晨 `e2ec798c` 采）`p6_stored_current_source_hash_mismatch: SimpleChat.tsx`——UI-373 在重采后改了该文件，属预期漂移。
3. 跑 `npm run g0:result-studio:p6:update`（全套件约 365 测试 + live capture 10/10，10–20 分钟，证据写 `acceptance/g0-result-studio/rs-p6-durability-recovery-performance.json` 锚定当时 HEAD）。
4. 注意：P6 若还引用 `package.json`/`test/impact-map.json` 绑定，本会话 P2 已改过 impact-map（rule 38 加了 `scripts/g0-rs-p4r-pack.mjs`），重采会一并覆盖绑定。

#### 第 2 步 · ui observation 补跑（需用户配合窗口）

- 命令：`npm run g0:result-studio:p4r:ui:update`（写 `acceptance/g0-result-studio/rs-p4r-ui-observation.json`）。
- **硬前置**：独占端口 3001（`scripts/g0-rs-p4r-ui-observation.mjs:48` BACKEND_PORT，占用即 fail-closed）。当前 dev 栈（用户自己终端起的 node，监听 3001/3005）在跑——**不要擅自杀用户进程**；请用户停 dev 栈 → 跑 → 再让用户 `npm run dev` 拉起。
- 完成后验聚合门：`npm run g0:result-studio:p4r:product`（会检查 perf/source-obs/live/ui 四证据全部 source-bound @ HEAD）。
- 注意：`g0-result-studio:p4r:live`/`:ui` 驱动真实 Electron + corpus，跑前确认 3000/3001/9222 端口面。

#### 第 3 步 · 整包收口回写五件套 + 门禁 + 提交推送

1. plan `docs/g0-result-studio-plan.md` 状态头：`active（P2-COMPLETED…）` → `completed`（写明：重启增量 P0→P1+P6重采→P2→closeout 全闭环；Result Studio 维持 `implemented_unverified / experimental`；P7 维持 `deferred`；§20 晋升 qualified 的未勾项属 P7 范畴不外推）。
2. `docs/DOC-REGISTRY.json`：G0-RS `status: completed`、`phase: COMPLETED`。
3. `docs/next-steps-roadmap.md` + `docs/project-workspace-handoff.md` 头部「最后更新」前插收口摘要；active 槽位清空，队列候选按 roadmap 现状（G0-SDC / BLOCK-85 双真机验收 Mac 侧 / P5 候选等，启动均需用户裁决）。
4. `docs/AUDIT-LOG.md`：收口表行（模板=门禁总账数字/实机断言数/范围守住/遗留候选/红旗归属/提交哈希 + 「G0 开发期常态 · 不外推 packaged/Provider/GA」恰一次）+ 头部摘要前插。
5. `docs/ui-productization-audit.md`：本包无 UI 增量，不需要动。
6. 门禁：`npm run closeout`（hygiene → docs → ui-audit → test:changed）+ `npm run docs:reconcile`（本轮 P2 已零候选，closeout 轮再核对一次）+ `npm run docs:check` 绿才算收口。
7. 提交 + `git push origin main`（网络曾抖动：HTTP2 framing / SSL_ERROR_SYSCALL，退避重试或 `-c http.version=HTTP/1.1`）。

### 五、源绑定纪律（换 Agent 最容易踩）

- 三份 P4R 证据（perf/source-obs/live）绑定 desktop `1357c4c4`（祖先提交即持续有效）+ 包仓 `21d610c`。**只动 docs/ 的提交不会打破绑定**；动 `scripts/g0-rs-p4r-*.mjs`、`test/p4r-*`、`test/agent-tool-registry`、`test/impact-map.json` 任一 → 对应证据须重采（对应命令见上）。
- 自绑定脚本（如 source-observation）改完必须**先提交再重跑**，否则工作区≠HEAD 必红。
- rebase/收编后提交哈希全变：证据里的 `sourceCommit` 不可达即红，需在最终 HEAD 重跑 `:update`（本会话末尾已演示一遍）。

### 六、本会话沉淀的两条「同类二次」教训（已在提交信息留痕）

1. symlink staging 装插件 = 0 候选零诊断：候选发现用 `readdirSync(withFileTypes).isDirectory()` 过滤（`core/shared-backend/plugin-sdk.js:49`），符号链接目录不可见 → 必须复制。
2. admitted 插件校验 `exactProjectFile` 要求显式输入落在项目工作区内（`core/shared-backend/result-plugin-validator.js`）：直传包仓绝对路径 → `validator_input_hash_mismatch`；corpus 已改为逐字节拷入 `<workspace>/inputs/` 再传参。

### 七、你的开工动作

1. 读本文档 + AUDIT-LOG + plan 状态头；`git status` 对账零差量。
2. 按「四、剩余工作」顺序执行：预修 A → P6 重采 →（请用户停 dev 栈）ui observation → `p4r:product` 验证 → 回写五件套 → 门禁 → 提交推送。
3. 全部绿后向用户报收口总账；G0-RS 槽位释放，下一包（G0-SDC / BLOCK-85 Mac 侧 / P5 候选）等用户裁决。

## 提示词正文（复制到这里结束）

## 附：关键文件索引

| 文件 | 说明 |
| --- | --- |
| `scripts/g0-rs-p4r-pack.mjs` | 包感知层（本会话新建；`locatePackPluginDir`/`buildPackEnv` 可复用） |
| `scripts/g0-rs-p4r-corpus.mjs` | corpus 生成链（已包感知化 + 输入落工作区） |
| `scripts/g0-rs-p4r-{acceptance,source-observation,live-observation,ui-observation,product-acceptance}.mjs` | P4R 五门脚本（:update 后缀写证据） |
| `scripts/g0-rs-p6-electron-pressure-prototype.mjs:244` | 待修 A 所在（go-kegg dormant 定位） |
| `acceptance/g0-result-studio/` | P4R/P6 证据目录 |
| `docs/session-handoff-2026-09-13.md` | 上一份交接（格式先例） |
