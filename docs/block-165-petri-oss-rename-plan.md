---
capability: platform-branding
goal: BLOCK-165 = Petri 换库开源改名——全仓 gewu/biof3 → petri 机械替换（内容 ~1.9k 文件 + 382 路径 git mv）+ 4 技能改名 + OSS 三件套 + 推送 github.com/petri-ops/Petri、旧 origin 退役
acceptance:
  - 工作树 `rg -i "gewu|biof3"` 归零（豁免清单外；豁免清单逐项留痕，git 历史按 D1 保留不重写）
  - 382 个含旧名路径 git mv 完成；npm install 重生成 lock；四基线（impact-map / knip-baseline / eslint-suppressions / code-size）重锚
  - 行为锚红绿：biof3.db→petri.db 不变式、BIOF3_*/biof3_* env 族、gewuevents 事件桥、--gewu-* CSS token 契约、MCP serverInfo、ci/release.yml、electron-builder appId/productName
  - 全量 `npm run test:all:workspace` 与 `npm run check` 各一次（全仓触及面例外，串行不并发）
  - dev 栈重启实机七探（启动/聊天/工具/Skills/插件/联邦/Result Studio）证据落 acceptance/block-165/
  - quality:secret 复扫 + 个人标识扫描（petri-ops/个人路径/内网信息）清零或豁免登记
  - LICENSE + 根 README（EN 主 + 中文副标）+ About 描述与 topics；新仓 CI 首跑绿
  - 旧 origin 退役（不再推 biof3 路径）；docs:reconcile + docs:check PASS；closeout 十一门
reopen: 无遗留阻塞；登记在案移交债=行数棘轮 ×2（拆分重构）/BLOCK-63 ×10（.NET 8 SDK env）/streamReconnect jitter ×4（BLOCK-159 家族）/RS7 门包化改造（RS 家族）
status: completed
---

# BLOCK-165：Petri 换库开源改名（Gewu/BioF3 → Petri + petri-ops/Petri）

## §1 背景与用户裁决

- 用户裁决（2026-10-10）原话：「后面我要对这个项目进行换库了…明确传到 https://github.com/petri-ops/Petri 这里面 不再传到 biof3原有的路径…595 个文件含 "gewu"、1308 个含 "biof3" 要立一个独立的工作包 统统修改完成 再上传」。
- 产品定名 **Petri**（同日裁决；弃 Gewu/BioF3 拉丁名）。产品定位（用户口径）：**通用 AI Agent 桌面应用 + 垂直领域内容**，首个垂直 = 全组学学习与实战；GitHub 描述定稿见 §5-P5。
- 本包 = 改名 + OSS 化 + 换库三合一独立工作包。**与 BLOCK-161（UI 设计体系治理，planned 排队中）强相关**：161 的 W1-W4 恰好治理 `--gewu-*` token 体系，必须串行且 **165 先行**，161 在改名后的 `--petri-*` 前缀上做，避免二次改名与基线漂移。161 维持 planned 排队不动。

## §2 范围与非范围

**范围**：
1. 工作树全量内容替换：`rg -i "gewu|biof3"` 命中 595 + 1308 文件（有交叠，合计 ~1.9k）。
2. 382 个路径含旧名的跟踪文件 `git mv` 重命名（core/biof3-server/ 195 文件为大头，另 test/fixtures、resources、icons、static、sidecars）。
3. 行为锚同步：§4-B 清单逐项红绿。
4. 4 个 `.agents/skills/gewu-*` 技能改名 + `.claude/skills`、`.codebuddy/skills` 发现桥重建 + AGENTS.md/CLAUDE.md 同步。
5. 基线重锚四件：test/impact-map.json、test/knip-baseline.json、eslint-suppressions.json、code-size 台账指纹。
6. OSS 三件套：LICENSE（D4）、根 README.md（当前无根 README，EN 主 + 中文副标）、release-contract.json tagline、GitHub About 描述 + topics。
7. OSS 卫生：quality:secret 复扫 + 个人标识扫描（petri-ops 出现于 5 个文档；`Admin`/`<workdir>` 类个人路径；内网 host/IP/邮箱）。
8. 换库：新 remote 推送 petri-ops/Petri（全历史 per D1）+ 旧 origin 退役 + 新仓 CI 首跑验证。

**非范围（exclusions）**：
- git 历史重写（D1 推荐保留全历史；历史提交信息与 blob 中的旧名如实接受，OSS 无害）。
- BLOCK-161 四波内容（对比度/档位体系/缩放/性能）——排队包另启。
- packaged 打包产物、公证、Provider、GA——G0 开发期常态 · 不外推。
- CONTRIBUTING/ISSUE 模板等社区治理文件（可选 rider，不默认）。
- 本地目录 `D:\<workdir>\biof3-desktop` 改名（D7，用户本机自选，工具链不依赖目录名）。

## §3 命名映射表（D0 待确认）

机械规则为 **case-aware 形状保持**：正则 `/biof3/i`、`/gewu/i` 按原大小写形状映射（`BIOF3`→`PETRI`、`BioF3`→`Petri`、`biof3`→`petri`；`GEWU`→`PETRI`、`Gewu`→`Petri`、`gewu`→`petri`），逐变体自然覆盖（biof3-server→petri-server、biof3_db_path→petri_db_path、gewu-border→petri-border、gewuevents→petrievents、biof3desktop→petridesktop 等），标识符合法性形状不变。关键显式项：

| 现值 | 新值 | 备注 |
| --- | --- | --- |
| 产品名 Gewu Desktop（格物）/ BioF3 | Petri | 中文副标「Petri · 格物」保留于品牌位（D2） |
| 根包名 `gewu-desktop` | `petri-desktop` | package.json name |
| `biof3-server`（core/ 目录+包名） | `petri-server` | 目录+import 路径+workspace 声明 |
| `gewu-desktop-frontend` | `petri-frontend` | |
| `biof3.db`（userData 内） | `petri.db` | `_db-singleton.js` + `branch-db.js` 双侧锁步；D3 |
| `biof3-dev-user-data` | `petri-dev-user-data` | dev userData 目录约定 |
| `BIOF3_USER_DATA_DIR` / `BIOF3_LOCAL_DATA_DIR` / `BIOF3_LOCAL_RESULTS_DIR` / `biof3_db_path` / `biof3_local_data_dir` / `biof3_better_sqlite3_root` / `BIOF3_R_HOME` | `PETRI_*` / `petri_*` | env 族全量同步 |
| `biof3-local` / `biof3-uploads` / `biof3-r-runtime` / `biof3-py-runtime` | `petri-*` | 本地数据/sidecar 运行时 |
| `biof3plugins` / `biof3-theme` / `gewu-pack-*` | `petriplugins` / `petri-theme` / `petri-pack-*` | 形状保持 |
| CSS token `--gewu-*` | `--petri-*` | 定义 4 文件 + 消费 236 文件 + theme-token-contract.test.ts |
| `gewuevents` / `gewuevent` | `petrievents` / `petrievent` | 前端事件桥 |
| `.agents/skills/gewu-*`（4 个） | `.agents/skills/petri-*` | + 双发现桥重建 |
| appId `com.biof3.local` / productName `BioF3` | `com.petriops.local` / `Petri` | electron-builder.yml |
| `https://github.com/petri-ops/biof3-desktop.git` | `https://github.com/petri-ops/Petri.git` | remote 更换 |

## §4 影响面盘点（2026-10-10 勘察实数）

**A. 分布**：gewu 595 文件 = frontend 236 / scripts 114 / acceptance 74 / docs 73 / test 45 / core 26 / src 18 / sidecars 5；biof3 1308 文件 = test 331 / docs 234 / scripts 210 / core 195 / acceptance 171 / frontend 86 / src 37 / resources 12 / agent-transcripts 10 / 其余零星。路径含旧名的跟踪文件 **382**。
**B. 行为锚（非纯机械，需红绿）**：①`biof3.db` 文件名不变式（`src/database/_db-singleton.js` 注释明确双侧锁同一文件名）＋`BIOF3_USER_DATA_DIR` 注入链（`src/main/backend-proc-manager.js`）；②env 族（`src/main/env-coordinator.js` 等）；③`gewuevents` 桥（welcome/home/project-workspace/WorkspaceSummaryCard）；④CSS token 定义（`frontend/src/styles/global.css`、`custom.css`、`global-page.module.css`、`extensions.module.css`）+ theme-token-contract.test.ts 断言 + `$gewu-css-theme` 技能文档内 token 名；⑤MCP serverInfo/registry（`src/mcp-server.js`、`core/biof3-server/mcp/registry.js`）；⑥`.github/workflows/ci.yml`（BioF3 注释）与 release.yml、release-contract.json tagline；⑦electron-builder.yml appId/productName；⑧`test/ipc-channels-registry.test.mjs` 与 `src/ipc/channels.js`（P1 复核是否存在旧名通道字面量）。
**C. 基线/配置**：impact-map.json、knip-baseline.json、eslint-suppressions.json、knip.json、startup-perf-budget.json、release-contract.json、package-lock.json（重生成不手改）。
**D. 台账/证据**：docs 234 + acceptance 171 文件含旧名（含 AUDIT-LOG/roadmap/DOC-REGISTRY 自身）；agent-transcripts 10 文件（历史 transcript，按「统统改」处理，D1 保留历史可回溯原件）。
**E. OSS 卫生命中**：petri-ops 5 个 docs 文件；无 LICENSE、无根 README、无 CONTRIBUTING。

## §5 阶段计划（P0-P7）

- **P0 决策与冻结基线**：D0-D7 用户裁决 → D5 处置 WIP → 基线留档（closeout 十一门结果 + `test:changed:list` 输出 + 四基线键数）→ `scripts/block165-rename-codemod.mjs` 编写并 **dry-run**，报告（内容命中分类统计 / 路径 mv 清单 / 豁免清单）落 `acceptance/block-165/codemod-dry-run.md` → **用户过目放行**。
- **P1 机械替换**：codemod 执行（内容替换与 git mv 分两笔有序提交，body 附映射表）→ `npm install` 重生成 lock → `rg -i "gewu|biof3"` 复扫归零（豁免外）→ codemod 幂等测试（二跑 diff=0）。
- **P2 行为锚红绿**：§4-B 八项逐项修复+定向测试（ipc-channels-registry / theme-token-contract / db-singleton 锁步 / events 桥 / MCP 握手 / CI yml 语法）。
- **P3 基线重锚**：四基线逐一重锚（knip `--update`、eslint `--suppress-all` 重扫计数不增、code-size 指纹重锚、impact-map 键更新后 `test:changed:list` 可复现验证）。
- **P4 技能与入口**：4 技能 `git mv` + 内容同步 + 双发现桥重建（`hygiene:check` 桥检查项通过）+ AGENTS.md/CLAUDE.md 措辞更新（项目自称 Petri（格物），原拉丁名仅在 plan/AUDIT-LOG 留痕）。
- **P5 OSS 卫生与三件套**：secret 复扫 → 个人标识 sweep 清零或豁免登记 → LICENSE 落地（D4）→ 根 README（EN 主描述 + 中文副标 + 定位一段 + 快速开始引用 docs/README）→ release-contract.json tagline 更新为定稿描述：「A general-purpose AI agent for your desktop, seeded with vertical-domain content — starting with multi-omics learning and hands-on practice. Local-first and MCP-native: it plans, runs tools and analyses right on your machine. A petri dish where skills grow.」
- **P6 全量验证与实机**：`npm run test:all:workspace` 一次 + `npm run check` 一次（串行）→ dev 栈重启实机七探（启动/聊天/工具调用/Skills/插件货架/联邦面板/Result Studio）证据落 `acceptance/block-165/`。
- **P7 换库上传与收口**：用户在 GitHub 建空仓 petri-ops/Petri（无 README/.gitignore/license）→ 旧 remote 改名 `origin-biof3`、新 `origin` 指向 Petri（D6）→ `git push -u origin main --tags`（tag 名 P7 前核 `git tag | rg -i "biof3|gewu"`）→ GitHub About 填定稿描述 + topics（multi-omics / bioinformatics / electron / mcp / ai-agent / local-first）→ 新仓 CI 首跑绿留证 → 用户侧 archive 旧仓 → 收口链（roadmap/AUDIT-LOG/DOC-REGISTRY completed + closeout 十一门 + output:judge）。

## §6 执行器设计：scripts/block165-rename-codemod.mjs

- 文件集 = `git ls-files`；扩展名白名单（ts/tsx/js/cjs/mjs/json/md/mdx/css/scss/html/svg/yml/yaml/sh/txt/swift 等），二进制跳过；`package-lock.json` 排除（npm install 重生成）。
- 豁免清单（EXEMPT，内容不改）：**本 plan 文档自身**、AUDIT-LOG 本包条目、`docs/block-161-*` 四件 WIP（若 D5 选排除而非落库）、二进制。
- 替换规则：§3 case-aware 形状保持；「格物」中文不在此列（D2 默认保留）。
- 输出三件：变更统计（按目录/扩展名）、路径 mv 清单、豁免清单；`--write` 前必须先 `--dry-run` 留档。
- 配套测试：`test/block165-codemod-idempotent.test.mjs`（对固定 fixture 施加规则断言形状映射 + 幂等）。

## §7 决策点（D0-D7，已全部裁决）

**裁决结果（2026-10-10，用户原话「D0-D7 全按推荐 一次搞完」）：D0-D7 全部按推荐执行；「一次搞完」= 按 WORK-PACKAGE-LAUNCH-CHECKLIST 用户显式裁决豁免条款，跳过 P0 dry-run 中途过目门与分阶段等待，P0→P7 连续执行（本行即留痕）。**

| # | 决策 | 推荐 |
| --- | --- | --- |
| D0 | §3 映射表确认（含 petri-server/petri-desktop/petridesktop 等连字形状） | 按表执行 |
| D1 | git 历史：保留全历史 vs filter-repo 重写 | **保留**（重写 = 全部提交哈希失效，台账 linkedCommits/证据引用全废；历史 blob 旧名保留无害） |
| D2 | 中文「格物」副标 | **保留**于 About/中文品牌位（「Petri · 格物」），正文标识不含 |
| D3 | 本地开发数据：biof3.db→petri.db | **全新起不迁移**（开发态，runMigrations 自建；旧 userData 目录留在原处可回溯） |
| D4 | LICENSE 类型 | **MIT**（Apache-2.0 亦可，需用户定） |
| D5 | 161 材料四件（plan/审计报告/探针脚本/app-health-live.json） | **前三件独立提交落库（内容零改动）**，app-health-live.json 留 working tree 不触；165 从干净树开始替换 |
| D6 | 旧 origin 处置 | **改名 `origin-biof3` 保留**（防误推+应急通道），旧 GitHub 仓由用户 archive |
| D7 | 本地目录名 | 不强制，用户自选后自担终端/会话重建 |

## §8 风险登记

| 风险 | 缓解 |
| --- | --- |
| 大小写混合变体漏网（Biof3/bIOF3 等） | 正则 `/biof3/i` 全形状映射 + 复扫 `rg -i` 归零兜底 |
| package-lock 手改破坏 | 排除手改，npm install 重生成 |
| 二进制误替换 | 扩展名白名单 + diff 抽查 |
| DB 文件名切换丢开发数据 | D3 裁决 + 双侧锁步 + 实机七探 |
| test:changed 推导依赖路径键 | P3 专项验证 `test:changed:list` 输出命中新路径 |
| eslint/knip/code-size 基线路径键失效误红 | P3 逐一重锚，计数不得增长 |
| frontend 测试 token 快照断言红 | P2 theme-token-contract 带动修复 |
| 全量测试暴露无关存量红 | 如实归属，不扩大本包范围 |
| 历史提交信息含旧名 | D1 保留即接受，OSS 无害 |
| CI 在新仓首跑环境差异 | P7 留证，失败归因修复 |

## §9 验收门禁总账（预声明，收口逐项对账）

1. `rg -i "gewu|biof3"` 工作树计数 = 豁免清单文件数（预期个位数）。
2. 定向测试：block165 codemod 幂等 + ipc-channels-registry + theme-token-contract + db-singleton 锁步 + events 桥 + MCP 注册 全绿。
3. 全量 `npm run test:all:workspace` ×1 + `npm run check` ×1（串行），结果如实（无关存量红归属留痕）。
4. 四基线重锚后 closeout 十一门 PASS。
5. `npm run docs:reconcile` + `npm run docs:check` PASS；`hygiene:check` 全绿（含发现桥真 symlink）。
6. 实机七探证据 `acceptance/block-165/live.json` ALL PASS。
7. 新仓 push 完成、About/topics 就位、CI 首跑绿；旧 origin 退役留痕。
8. 收口笔录：G0 开发期常态 · 不外推 packaged/Provider/GA（恰一次）。

## §10 滚动记录

- 2026-10-10 立项（planned）：影响面勘察（§4 实数）+ 本 plan + DOC-REGISTRY/roadmap/AUDIT-LOG 登记；doc:suggest 零建议（如实）；待 D0-D7 裁决后进入 P0。
- 2026-10-10 启动（active，P0-LAUNCH）：用户裁决「D0-D7 全按推荐 一次搞完」= 全按推荐 + 豁免 dry-run 中途过目门（checklist 豁免条款，§7 留痕）；D5 处置=161 三件材料零改动独立入库（app-health-live.json 留树不触）；P0→P7 连续执行，各阶段门禁与证据照常留档。
- 2026-10-10 P0-P5 落地：基线快照（p0-baseline.md）+codemod（内容 1680 文件/27912 处+目录 18+文件 20 git mv）+P1 提交 66b3970+P5 提交 f7e6f252（MIT LICENSE/根 README/tagline/107 文件个人标识清扫/运维脚本 ROOT 自定位）；P2-P3 行为锚与四基线（code-size --write 重锚 24 文件）；存量对账三件=163 registry 陈旧 active 翻 completed+b784fa37 补登 UI-484+双豁免。
- 2026-10-10 P6 全量复验+实机（提交 2a54834e）：test:all 3688 项 3587 绿/12 红全对账（行数棘轮 ×2+BLOCK-63 ×10，均 b784fa37 即红的存量/env 债）；改名真雷清偿=brand LEGACY 语义+brand-identity needle 复原+**mini 旗标桥撞名**（preload 双暴露 'biof3'+'gewu' 坍缩同名 'petri'，迁 petriAgentFlags 独立键，CDP 渲染层双桥实证 object|object）；存量漂移对账 9 处（Jev 钉住 doc-suggest+output-judge+configForPoint、catalog workflow-templates、platform ×3、routes put 桩、block57 spawn 锚）；前端 7 红清偿 3（LeftPanel 前缀 ×2 改名破绽）+4 红归属 BLOCK-159 今日 jitter 新债；实机七探 allPass（live.json，CDP 标题=Petri）。
- 2026-10-10 P7 换库+CI+收口（提交 2c182445/b93eacb0/2c182445 后继）：petri-ops/Petri 推送完成（无亲缘合入脚手架 init 96e1267，不 force-push；tags 58 枚；About 描述+7 topics 经 API 落位；public/main）；旧 origin 改名 origin-biof3 保留（D6）；CI stability Phase 7 拆双轨（确定性面 CI 常跑 harness:check+phase6+8 单测 99/99 绿、活体 acceptance 移 provisioned 环境）+G0-RS7 诚实跳过档（RS-P7 deferred 语义域，包化改造登记 RS 家族）→ **新仓 CI conclusion=success（head 2c182445）**；改名真雷尾笔=mini 旗标桥撞名 petriAgentFlags 解耦（tsc 2339 ×4 清零+渲染层 CDP 双桥实证）；移交债登记=行数棘轮 ×2（拆分重构）/BLOCK-63 ×10（.NET 8 SDK env）/streamReconnect ×4（BLOCK-159 今日 jitter 新债）/RS7 门包化（RS 家族）；异常报备=并行 Gen-UI 会话两件产物（docs/gen-ui-migration-prompt.md、docs/block-166-gen-ui-sandbox-plan.md）经本包 git add -A 顺带入公仓，归属 Gen-UI 会话处置；一次性异常=四件运维脚本曾在窗口期被未知方自盘面删除，已自 HEAD 恢复且 60s 观察未复发。G0 开发期常态 · 不外推 packaged/Provider/GA。
- 2026-10-10 D7 落地执行：用户裁决「要的 改」（本地目录 biof3-desktop → petri）。实证=子目录可改而根名不可改（根句柄=ZCode CLI 主进程工作目录，会话存活期 Windows 硬约束），故交付 D:\1.WorkDir\rename-to-petri.cmd 全自动助手（仓外一次性工具：轮询等句柄释放→改名→Gewu-StackWatchdog 任务动作改指新路径；用户关闭本会话后双击即成，随后在新路径重开）；运维脚本已全部 ROOT 自定位（D5 批），改名后零手工适配。
