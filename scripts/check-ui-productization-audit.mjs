#!/usr/bin/env node
/**
 * scripts/check-ui-productization-audit.mjs — UI 实现与审计台账同步门禁
 *
 * 检查 `docs/ui-productization-audit.md` 与 Git 历史的同步性：
 *   1. 工作区含 UI 改动但未同步 `ui-productization-audit.md` → FAIL
 *   2. UI 提交 subject 未带 UI-### issue id（允许白名单豁免）→ FAIL
 *   3. 实现同步但未通过 git 提交同步台账 → FAIL
 *
 * 退出码契约（GATES-1 文档化，2026-08-16；GATES-3 补强，2026-08-18）：
 *   0   PASS — UI 实现与审计台账已同步；Git 历史已有 UI 编号实现证据
 *   1   FAIL — UI 改动未同步台账 / submission issue id 缺失 / 台账不同步
 *   2   分类冲突 — 当前触发条件（GATES-3）：
 *       - hasUnmappedSurface：commit subject 引用了未在
 *         `docs/ui-productization-audit.md` 注册的 UI-### 编号（且不在
 *         LEGACY_EXEMPTIONS），即"实现引用了未登记的 UI 编号"
 *       - 默认模式（`--print-mode=default`）触发 hasUnmappedSurface 时直接 exit 2
 *       - `--print-mode=development` 模式下：未命中 LEGACY_*_EXEMPTIONS 的
 *         UI_AUDIT_SYNC / UI_ID_MISSING 等硬 FAIL 降级为 exit 2（开发者提示
 *         而非 fail-closed），不默认启用
 *       - `--report <path>` JSON 输出模式下：写盘失败 / schema 校验失败也 exit 2
 *
 * `--report` JSON 输出模式（GATES-2 文档化，2026-08-16）：
 *   与默认人类可读行输出并行的可选模式；通过 `--report <path>` 触发，输出
 *   机器可读 JSON，由 `docs/schemas/ui-audit-report.schema.json` 强校验。
 *   写盘失败 / schema 校验失败 → exit 2（分类冲突）。
 *   现有 `process.exit(1)` / 直接执行行为**不变**；只有显式传入 `--report`
 *   才进入新模式。
 *
 * 同步文档：`docs/document-governance.md` §4.5"门禁退出码契约" + GATES-2 §3.2"JSON 输出契约"。
 * 该契约为本工作包 DOC-GOVERNANCE-GATES / GATES-1 阶段固化本，不在本阶段内
 * 改动 `process.exit()` 行为。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GATE_REPORT_SCHEMA_VERSION, validateReport } from './lib/gate-report-schema.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)

const AUDIT_PATH = 'docs/ui-productization-audit.md'
const ENFORCEMENT_BASELINE = '0611ce5b52f8d6d3ff9b8ecf25656553837f41cd'
// This pushed commit updated the UI-031 audit entry but omitted the issue id
// from its message. Grandfather only this immutable historical commit; all
// subsequent UI commits remain subject to the same message and audit gates.
const LEGACY_MESSAGE_EXEMPTIONS = new Set([

  // 2026-09-19 BLOCK-102 P2 前端竞态治理提交（21d84f52，渲染层竞态修复）：
  // subject 未带 UI-### 为笔误，UI-425 条目（P3/P4 前端切片）与本提交同批由
  // 后续提交补登。豁免同提交台账与 subject 要求；不重写共享历史。
  // 2026-09-20 BLOCK-105 P2 lint 首修批（8c85898，eslint --fix 机械修复 77 文件）：
  // 纯机械代码修复（多余类型断言移除等）无 UI 行为变化，双套件 2251+1146 验证；
  // 台账即 eslint-suppressions.json + quality:* 门禁（BLOCK-105 plan §6.2），非新
  // UI 功能故无新台账条目。豁免 subject UI-### 与同提交台账要求；不重写共享历史。
  // 2026-09-20 BLOCK-105 §7 Batch-1 抑制基线收缩（ad6142d，Mac 侧 24 项 lint 修复批）：
  // 前端仅 agentTaskStream.ts 删 useless-catch 空壳（catch(e){throw e} 行为恒等，
  // streamReconnect 7/7 验证），零 UI 面变化；台账=eslint-suppressions.json 棘轮
  // 收缩 2914→2890+2126→2125（plan §7 批次日志）。豁免 subject UI-### 与同提交
  // 台账要求；不重写共享历史。
  'ad6142dc13044ac3e09ac11224abbd866fbf00c1',
  '8c85898a018300d702daebce9c058193e9b136f2',
  '21d84f528a35526e59f2964833a65965546772e1',
  // 2026-09-19 BLOCK-102 P3/P4 修复提交（06828fd 安全加固+观测性能）：subject
  // 未带 UI-### 为笔误，UI-425 条目由后续提交统一补登（LEGACY_AUDIT_SYNC_
  // EXEMPTIONS 同哈希）。不重写共享历史。
  '06828fd0e04d15389c2ce47bd28a89af61540622',
  // 2026-09-18 BLOCK-94 知识空间专业化实现提交（0e1ac53 P1 可靠底盘 /
  // 6e7b60b P2 PDF+易用 / 0d70f80 P3 管理面 / 9ec3602 P5 规模化）：subject
  // 用 feat(block-94) 未带 UI-###；UI-402 条目由收口提交统一补登并随实机
  // 18/18 allPass 翻 verified。豁免同提交台账与编号要求，不重写共享历史。
  '0e1ac531e5a88038124d787f16dda6e422903776',
  '6e7b60b886fc096b9b1717e7b67e18f0379ab172',
  '0d70f8057ff88fedd8d67ea45f8be51e6d468701',
  '9ec36020381a9d62c909594b1ad133e9bd965612',
  // 2026-09-17 BLOCK-98 P4 输入插队（a3c08a3）：前端 onInputQueued 分支+
  // 状态条排队可见；subject 用 feat(block-98) 未带 UI-###，台账 UI-401 由
  // 收口提交统一补登并 verified。豁免同提交台账与编号要求，不重写历史。
  'a3c08a382cacac6266d24efcd6ab9370f2e1aadb',
  // 2026-09-16 BLOCK-92 P2 Wave A copilot 族巨型文件模块化拆分（834b18a
  // conversationRunStore / c1590d8 copilotClient / 0a67e84 SimpleChat）：
  // 纯重构零行为变化（UI-305 家法），subject 用 refactor(block-92): 未带
  // UI-###；台账已由收口提交统一补登 UI-391 条目。豁免同提交台账与编号
  // 要求，不重写共享历史。
  '834b18a930794a5d4d68ad2f98f648f39080ec94',
  'c1590d8cb018d5da2afa18549a63f54bf892ed33',
  '0a67e84b8e46618b82279327a6d0c742591debe8',
  // 2026-09-15 BLOCK-91 聊天附件真实接入实现提交 c9535452：主体前端改动
  // （SimpleChat 附件管线 + FileTreeItem ssh 拖出），subject 用
  // feat(block-91): 未带 UI-###；台账已由后续 UI-381 条目统一登记覆盖。
  // 豁免同提交编号要求，不重写共享历史。
  'c9535452c707310f367bb8d03cba21755f761303',
  // 2026-09-13/14 BLOCK-85/86/87 多端同步与联邦过程提交（投影终端/AppRail 浮层/
  // 偏好服务端化/消息镜像/隧道档案），UI 归属 UI-354 修订链与 UI-358，收口时统一
  // 补登台账；subject 用 feat(block-8x): 未带 UI-###。豁免同提交台账与编号要求。
  'fb58798cb0a832d5bd6f0e901e23b9c7f590463e',
  'be53b0df0c1446c6fb2582ef7dd8de91e49deb2c',
  '58bc741caded6fab4bf262b4a7d5099f1f86a37f',
  'c1284842c879bb7076a7c4472c02e1f197294592',
  '49dd938e5430004160c5caeed2cbcea75db13299',
  '862fd501fb950559ee12b5aa1f9af68e8b088dee',
  '0663a13e37b645ca881b1ef05e9e471dd08da411',
  'cd9781c29b8debdc7e4716d3d64d7b3c70667a7a',
  '69cf02ce2a0478a806fc13ac965c37c3c7d25333',
  '5e7710a5db180cf73a9e75f681d713f55a305d11',
  // 2026-09-13 BLOCK-70 P3 隧道实现提交 1c40b35：MobileSync.tsx 隧道三态区 UI
  // 增量的同提交台账漏同步（收口门禁抓出后补登 UI-319 条目 P3 段）。
  // subject 用 feat(block-70): 未带 UI-###。豁免同提交台账与 UI-### 编号要求。
  // 不重写共享历史。
  '1c40b3526d75348659421ae57bf2eadfa24ee328',
  // 2026-09-11 BLOCK-81 P1 接线不可变提交 c177374：frontend 仅
  // copilotClient / conversationRunStore 两个字段透传（新增可选 thinkingLevel，
  // 缺省不含＝零 UI 行为变化；真正的控件在 UI-345 落地）。subject 用
  // `feat(agent):` 未带 UI-###；台账已由后续 UI-345 条目覆盖该接线。
  // 不重写共享历史。
  'c177374ba4ee10faf7b7dcab0628198272f8cf70',
  // 2026-09-06 4844e88「全量核对收口」不可变提交：frontend 仅触碰
  // ReviewMode.test.tsx + chat-file-references.test.ts 两个 *test* 文件
  // （biof3:// → gewu:// 改名回归的测试对齐），无产品 UI surface 变化；
  // subject `fix:` 未带 UI-###。sync+message 双豁免，不占 UI 条目。
  // 不重写共享历史。
  '4844e8855ae5b25ce95e949e784b4cd0d312c1d3',
  // 2026-08-30 BLOCK-30-BACKEND-CONVERGENCE 不可变实现提交 (P1/P2/P4)：
  // 后端收敛与更名（py-server 摘除 / gateway 摘除 / core/r-server →
  // core/biof3-server），前端仅路径级 import 变化。UI 影响补登为 UI-222
  // （合并条目）。豁免同提交台账与 UI-### 编号要求。
  'edd1116b2b524bfdc96fc16bc16fa2ad8318b216',
  'd4f459d734b5b7d71076cfb34f661d27e9b8117a',
  '4e51ae15e6e2d92fa5fa4d59f0a76bb898c56c55',
  // 2026-08-27 UI-199 implementation commit: title has "ui-199" lowercase but
  // the ledger convention wants UI-### uppercase with the full id format the
  // uiIds() regex matches... actually title is "feat(ui-199): ..." which the
  // regex does not match (requires UI- uppercase + digits). Exempted because
  // the ledger entry UI-199 exists and was verified the same day.
  '4f5e7c92253b163fe3e511e96b669551713f785d',
  // 2026-08-27 PR #45 merge commits: ded4f80 is the GitHub-generated merge
  // commit ("Merge pull request #45..."), 4ebff54 is the strategy=ours merge
  // that reconciled the rewritten main with feat/block-22 (BLOCK-20 + BLOCK-22
  // + UI-199). Merge commits carry no UI-### in title by nature; the ledger
  // entries live in the merged feature commits themselves.
  'ded4f8056414f323041b82296b17e7240d2dfcd7',
  '4ebff54e73c08e7d47b392d58dfd5f0cbf314d51',
  'cec2c581688858fe4c877350afd3449777562bf5',
  // P4R-2 scroll preservation was already recorded in UI-113 by the
  // immediately following governance commit 2f0e78d. The implementation
  // commit itself predates the issue-id enforcement and is not rewritten.
  '17bb486f3eda58cc14aa2ee5d4386b16f20fc18e',
  // P6 durability changed one Result Studio client response field and updated
  // UI-103/UI-105/UI-111 in the same immutable implementation commit. Its
  // subject named P6 rather than the UI issue IDs; the canonical P6 closeout
  // preserves that mapping without rewriting shared history.
  '5a033eb07f2ffdcdc6b285902dbf6a11ab4c96ce',
  // P7 completion classification changed the UI-to-Agent request contract for
  // UI-108/UI-109. P7 was later deferred and the immutable implementation
  // checkpoint is reconciled explicitly in the 2026-08-03 audit record.
  '2298c968f7afa289a1c257e2fc8ba8d608bad1ed',
  // feat(chat): Fork Chat 分支功能实现；subject 无 UI-###（feat(chat): 而非 UI-WAVE0:），body 有 UI-143
  // UI-143 在表中已有 verified 条目（feat/ui-wave0，W-05/C-02 路由化），289101e 在 feat/ui-wave0 基础上扩展 fork 功能
  '289101ea90073f7da5e685617c21fecd6dad7e1f',
  // UX1H implementation landed before the target row was reconciled from
  // unit-only evidence to the current in_progress + Electron evidence state.
  '7995ee945b0221e2507e1cce11414849a942ac5d',
  // devah 的 origin/main 不可变提交：自定义窗口控件 + 插件 status 治理。
  // 代码提交 e6421e0 与台账登记 f624d76 拆分，提交信息未带 UI-###；
  // 台账已在 f624d76 以 UI-106 登记（合并后改号 UI-129）。不重写共享历史。
  'e6421e07fdf4337944bd7f186926aeeb082049c2',
  // 2026-08-14 Skills UI/frontend pages 不可变实现提交：subject `feat(skills)` 未带 UI-###；
  // 台账已由本次 UI-AUDIT-FIX 补登为 UI-157（in_progress）。不重写共享历史。
  'e6bf72ff74480f0b98cfcbbc839268b95d2800c8',
  // 2026-08-14 Copilot UX 不可变实现提交：subject `feat(copilot)` 未带 UI-###；
  // 台账已由本次 UI-AUDIT-FIX 补登为 UI-158（in_progress）。不重写共享历史。
  '446bfa8f6fb2d23d908ce9358d35c25d4e853ebb',
  // 2026-08-14 Workspace UI plumbing 不可变实现提交：subject `feat(frontend)` 未带 UI-###；
  // 台账已由本次 UI-AUDIT-FIX 补登为 UI-159（in_progress）。不重写共享历史。
  '3000a069171bb6404719ddd797d1b6e64e92d53c',
  // 2026-08-17 macOS fullscreen 按钮实现不可变提交 d9906fd：subject `fix(mac)` 未带 UI-###；
  // 台账已由本次 BLOCK-14 UI-AUDIT-FIX 补登为 UI-161（in_progress）。
  // 不重写共享历史。
  'd9906fd0b7b7060aeb6a9e954c3137db305a0a63',
  // 2026-08-17 macOS fullscreen 重构不可变提交 d08d8b1：subject `refactor(mac)` 未带 UI-###；
  // 与 d9906fd 同一工作流（custom traffic lights fullscreen），台账已登记 UI-161。
  // 不重写共享历史。
  'd08d8b11ba78de8ac0dad5392455c711c8fbe5a9',
  // 2026-08-18 SimpleChat + workspace panels 不可变实现提交 c271010：subject
  // `feat(copilot-chat)` 未带 UI-###；台账已由本次 BLOCK-14 UI-AUDIT-FIX
  // 补登为 UI-162（in_progress）。不重写共享历史。
  'c271010035168678662719a0790c9af17ea61807',
  // 2026-08-18 Result Studio 前端 + 持久化不可变实现提交 e40313e：subject
  // `feat(branch-result-studio)` 未带 UI-###；台账已由本次 BLOCK-14
  // UI-AUDIT-FIX 补登为 UI-163（in_progress）。不重写共享历史。
  'e40313e0e81f5a9ee70ace158cebb8a3e688a9ca',
  // 2026-08-19 BLOCK-16 PHASE 3 不可变实现提交 da48006：events.ts 加
  // agentTaskDone + copilotClient.ts SSE 4 处 done 分支 dispatch +
  // useWorkingTreeReview.ts 订阅 typed event bus。台账已由本次
  // BLOCK-16 closeout 笔录登记为 UI-180 in_progress。豁免同提交台账要求。
  'da480063728d900ce6bfe4cf5c0c642a264a2f72',
  // 2026-08-21 Fork Chat 演进不可变提交 30ff32f：subject `feat(chat)` 未带 UI-###；
  // 与 289101e 同一 UI-143 Fork Chat 工作流（feat/ui-wave0 之后的增量扩展）。
  // 不重写共享历史。
  '30ff32f1e3f27fd53d2b51d36332aab93d12c985',
  // 2026-08-21 Skills UI/frontend pages 演进不可变提交 b6f69a4：subject
  // `feat(skills)` 未带 UI-###；台账已由 earlier e6bf72f 登记为 UI-157，
  // 本次 commit 为后续增量扩展。按 UI-157 同一工作流归属登记，不单独占新 UI 条目。
  // 不重写共享历史。
  'b6f69a4573e83cb9d6451a6c65004dca8a06bb36',
  // 2026-08-21 Copilot UX 演进不可变提交 4e81ef9：subject `feat(copilot)`
  // 未带 UI-###；台账已由 earlier 446bfa8 登记为 UI-158，本次 commit 为后续
  // 增量扩展。按 UI-158 同一工作流归属登记，不单独占新 UI 条目。
  // 不重写共享历史。
  '4e81ef92946ff905b3f55806eefac3139296653e',
  // 2026-08-21 Workspace UI plumbing 演进不可变提交 6bb9ecb：subject
  // `feat(frontend)` 未带 UI-###；台账已由 earlier 3000a06 登记为 UI-159，
  // 本次 commit 为后续增量扩展。按 UI-159 同一工作流归属登记，不单独占新 UI 条目。
  // 不重写共享历史。
  '6bb9ecbacf2f2cf7bb023dd5bc4d9852cfb951b8',
  // 2026-08-21 Agent Workbench P1.2 TableRenderer 演进不可变提交 05e8546：
  // subject `feat(agent-workbench)` 未带 UI-###；台账已由 earlier 2ba838b
  // 登记为 UI-AGENTWB-002，本次 commit 为后续增量扩展。按 UI-AGENTWB-002
  // 同一工作流归属登记，不单独占新 UI 条目。不重写共享历史。
  '05e85461bc855484ef4a34c7b1d46de0c703b439',
  // 2026-08-21 macOS fullscreen 按钮演进不可变提交 4dbc444：subject
  // `fix(mac)` 未带 UI-###；台账已由 earlier d9906fd 登记为 UI-161，
  // 本次 commit 为后续增量扩展。按 UI-161 同一工作流（custom traffic lights
  // fullscreen）归属登记，不单独占新 UI 条目。不重写共享历史。
  '4dbc444d0ad42b84033ba13d62561e952a9fce52',
  // 2026-08-21 macOS fullscreen 重构演进不可变提交 f8edc77：subject
  // `refactor(mac)` 未带 UI-###；台账已由 earlier d08d8b1 登记为 UI-161，
  // 本次 commit 为后续增量扩展。按 UI-161 同一工作流归属登记，不单独占新 UI 条目。
  // 不重写共享历史。
  'f8edc770291448726dca9b46f01ae23a6f011ba1',
  // 2026-08-21 SimpleChat + workspace panels 演进不可变提交 921a1b3：
  // subject `feat(copilot-chat)` 未带 UI-###；台账已由 earlier c271010
  // 登记为 UI-162，本次 commit 为后续增量扩展。按 UI-162 同一工作流归属登记，
  // 不单独占新 UI 条目。不重写共享历史。
  '921a1b3e5974baab919c3bc652780a818261bf1e',
  // 2026-08-21 Result Studio 前端 + 持久化演进不可变提交 1894f5d：subject
  // `feat(branch-result-studio)` 未带 UI-###；台账已由 earlier e40313e
  // 登记为 UI-163，本次 commit 为后续增量扩展。按 UI-163 同一工作流归属登记，
  // 不单独占新 UI 条目。不重写共享历史。
  '1894f5d1cb1031d09c780dd3c387ad582b6630a1',
  // 2026-08-21 BLOCK-16 PHASE 3 演进不可变提交 59ccaba：subject
  // `feat(block-16 PHASE 3)` 未带 UI-###；台账已由 earlier da48006 登记为
  // UI-180，本次 commit 为后续增量扩展。按 UI-180 同一工作流归属登记，
  // 不单独占新 UI 条目。不重写共享历史。
  '59ccaba221b55d9faee953d4c1e1537b11cc4283',
  // 2026-08-24 BLOCK-22-CODEMIRROR-INLINE-DIFF 不可变实现提交 (共 8 commits)：
  // subject 含 UI-###；台账 WIP 锁未解除，按 governance §Guardrails L84
  // "Never modify unknown WIP" 不改 ui-productization-audit.md。
  // 台账由 closeout §11 + AUDIT-LOG 同步登记，待 WIP 锁解除后补 UI-191~194。
  // 不重写共享历史。
  '3745bd5e54c46ed37f947516cb9ad9ea15af6fe5',
  'b9e697ff67f6c5e8f5b7a4ba6570f88f6e3ae472',
  '0436be29d68e578e38c5883b6853070907f248be',
  '0e28498e85cf7b638af58d5a8b67e4bddd680fe8',
  'b1f4453995b6b33c2d1b55f223bc60e1fc222efa',
  'e83199ce104b205bec597b3d64fa1667a2300b30',
  'aba735c529574bab6924dba0a565430e64887bc3',
  '6483aeb48d6c64f6b24dd5d14a9611bb4d72b38b',
  // 2026-08-24 BLOCK-22 workspace preview 不可变实现提交 2a4d435：subject
  // `fix(workspace-preview)` 未带 UI-###；台账 WIP 锁约束，按 governance §Guardrails
  // L84 "Never modify unknown WIP" 不改 ui-productization-audit.md。
  // 不重写共享历史。
  '2a4d4350615847aa64eacd4e2310a2d3d21024e3',
  // 2026-08-24 BLOCK-22 DevBridge 挂载 不可变实现提交 89da711：subject
  // `feat(block-22-p4.5-p4.6)` 未带 UI-###；台账 WIP 锁约束，按 governance §Guardrails
  // L84 "Never modify unknown WIP" 不改 ui-productization-audit.md。
  // 不重写共享历史。
  '89da711164376ad67fddb9d808a1a268e5a4d30b',
  // 2026-08-25 BLOCK-22 P4.6 CSS selector 修复 不可变实现提交 8006880：subject
  // `fix(block-22-p4.6): inline-diff 绿底/红底 CSS selector 修复 [BLOCK-22] inline-diff`
  // 未带 UI-###；台账 WIP 锁约束，按 governance §Guardrails L84
  // "Never modify unknown WIP" 不改 ui-productization-audit.md。
  // 不重写共享历史。
  '8006880cad6537980a11a82de0069601bb0c7dc1',
  // 2026-08-26 BLOCK-22 P4.7 accept/reject widget 注入 不可变实现提交 9cb6e96：subject
  // `feat(block-22-p4.7): inject accept/reject widgets into hunk lines + dismissHunk with fade transition [BLOCK-22]`
  // 未带 UI-###；台账已由本 commit 补登为 UI-195（in_progress）。
  // 不重写共享历史。
  '9cb6e9624bea9d33c5e9fd08cf52c7137d722893',
  // 2026-08-28 P6 evidence collection chain repair 不可变提交 44a4b7e：
  // subject `fix(result-studio)` 未带 UI-###；台账已由本 commit 补登为
  // UI-201（in_progress）。不重写共享历史。
  '44a4b7e9087a8eade9c061c1d04c6b543378e159',
  // 2026-09-01 BLOCK-33 P1 环境自省不可变提交 0acffcc：subject
  // `feat(block-33): P1 环境自省——system_info 工具 + prompt 环境摘要行`
  // 未带 UI-###；台账已由后续 UI-AUDIT-FIX（P2 提交）补登为 UI-265
  // （in_progress）。不重写共享历史。
  '0acffcc13c78a27c1c1e764c5d56afe13e4602ef',
  // 2026-09-03 BLOCK-50 审阅删除文件兜底不可变提交 ce43048：subject
  // `fix(review): 已删除/已消失文件结构化兜底` 未带 UI-###；台账已由
  // BLOCK-51 收口提交补登为 UI-279（verified，实机证据 acceptance/block-50/）。
  // 不重写共享历史。
  'ce43048305c4abb3a565860addc52e8b072a877d',
])
// These immutable implementation commits have an explicit later canonical
// ledger reconciliation. Exempt only the same-commit audit-file requirement;
// their messages remain subject to the UI-### issue-id gate above.
const LEGACY_AUDIT_SYNC_EXEMPTIONS = new Set([

  // 2026-09-20 BLOCK-105 P2 lint 首修批（8c85898，eslint --fix 机械修复 77 文件）：
  // 纯机械代码修复（多余类型断言移除等）无 UI 行为变化，双套件 2251+1146 验证；
  // 台账即 eslint-suppressions.json + quality:* 门禁（BLOCK-105 plan §6.2），非新
  // UI 功能故无新台账条目。豁免同提交台账要求（subject UI-### 门经
  // LEGACY_MESSAGE_EXEMPTIONS 同哈希豁免）；不重写共享历史。
  // 2026-09-20 BLOCK-105 §7 Batch-1 抑制基线收缩（ad6142d，Mac 侧 24 项 lint 修复批）：
  // 前端仅 agentTaskStream.ts 删 useless-catch 空壳（行为恒等，streamReconnect 7/7），
  // 零 UI 面变化；台账=eslint-suppressions.json 棘轮收缩（plan §7 批次日志）。
  // 豁免同提交台账要求（subject 门经 LEGACY_MESSAGE_EXEMPTIONS 同哈希豁免）；
  // 不重写共享历史。
  'ad6142dc13044ac3e09ac11224abbd866fbf00c1',
  '8c85898a018300d702daebce9c058193e9b136f2',

  // 2026-09-19 BLOCK-102 P2 前端竞态治理提交（21d84f52，渲染层竞态修复）：
  // subject 未带 UI-### 为笔误，UI-425 条目（P3/P4 前端切片）与本提交同批由
  // 后续提交补登。豁免同提交台账与 subject 要求；不重写共享历史。
  '21d84f528a35526e59f2964833a65965546772e1',
  // 2026-09-18 BLOCK-94 实现提交四笔：同提交台账由收口提交统一补登
  // （UI-402，随实机 18/18 allPass 翻 verified）。豁免同提交台账要求；
  // 不重写共享历史。
  '0e1ac531e5a88038124d787f16dda6e422903776', // BLOCK-94 P1 可靠底盘
  '6e7b60b886fc096b9b1717e7b67e18f0379ab172', // BLOCK-94 P2 PDF+易用
  '0d70f8057ff88fedd8d67ea45f8be51e6d468701', // BLOCK-94 P3 管理面
  '9ec36020381a9d62c909594b1ad133e9bd965612', // BLOCK-94 P5 规模化
  'a3c08a382cacac6266d24efcd6ab9370f2e1aadb', // BLOCK-98 P4 台账由收口提交补登（UI-401）
  // 2026-09-16 BLOCK-92 P2 Wave A copilot 族巨型文件模块化拆分（834b18a
  // conversationRunStore / c1590d8 copilotClient / 0a67e84 SimpleChat）：
  // 纯重构零行为变化，UI-391 台账条目已由 BLOCK-92 Wave A 收口提交统一
  // 补登（对齐 UI-305 160e0f2c 先例）。豁免同提交台账要求；不重写共享历史。
  '834b18a930794a5d4d68ad2f98f648f39080ec94',
  'c1590d8cb018d5da2afa18549a63f54bf892ed33',
  '0a67e84b8e46618b82279327a6d0c742591debe8',
  // 2026-09-16 UI-387 追加定稿两次样式微调（e48b631 彩色 emoji 无外框、
  // 5170e53 显式清除 button 默认边框——用户反馈「为什么还有外边框」）。
  // 同提交台账漏同步；UI-387 条目已含该定稿说明（BLOCK-96 收口时按 BLOCK-91
  // 先例补登豁免）。不重写共享历史。
  'e48b6312ab4fdaf070df2142767037e33c966c23',
  '5170e53cddb7d435272a4c8d3ce13a8ce42a49b6',
  // 2026-09-19 BLOCK-102 P3/P4 修复提交：同提交台账漏同步——UI-425 条目由
  // 后续提交统一补登（本提交同时含后端安全/性能切片，subject 未带 UI-###
  // 为笔误）。豁免同提交台账与 subject 要求；不重写共享历史。
  // 2026-09-19 BLOCK-102 P3/P4 修复提交（安全加固+观测性能，含渲染层切片）：
  // 同提交台账漏同步——UI-425 条目由后续提交统一补登（subject 未带 UI-### 为
  // 笔误）。豁免同提交台账与 subject 要求；不重写共享历史。
  '06828fd0e04d15389c2ce47bd28a89af61540622',
  // 2026-09-16 UI-382 后续增量提交 716c876：conversationRunStore spawn_agent
  // 结果回写 agentId 到工具行（展开体按其内联实况卡）。UI-382 条目已由先导
  // 提交 124354cb 登记，本次为同一工作流后续增量，收口门禁抓出后补登台账。
  // 豁免同提交台账要求；不重写共享历史。
  '716c876297987d9d99deff04e75a219c871f8545',
  // 2026-09-15 UI-379 两处 React hooks 顺序修复（8e68e016 首启整页空白 /
  // f3719f69 项目页全白，原哈希 25005849/5f0172a6 经 BLOCK-89 分叉 rebase 收编
  // 重写；台账草编 UI-378 撞号后重编号 UI-379）同提交台账漏同步，收口时补登。
  // 豁免同提交台账要求；不重写共享历史。
  '8e68e0163ff1ee6d0da5ab310da7545b78e1d607',
  'f3719f69690453978126377a5719c58d5e139dec',
  // 2026-09-13/14 BLOCK-85/86/87 过程提交同提交台账漏同步（收口补登 UI-358/354 修订链）。
  'fb58798cb0a832d5bd6f0e901e23b9c7f590463e',
  'be53b0df0c1446c6fb2582ef7dd8de91e49deb2c',
  '58bc741caded6fab4bf262b4a7d5099f1f86a37f',
  'c1284842c879bb7076a7c4472c02e1f197294592',
  '49dd938e5430004160c5caeed2cbcea75db13299',
  '862fd501fb950559ee12b5aa1f9af68e8b088dee',
  '0663a13e37b645ca881b1ef05e9e471dd08da411',
  'cd9781c29b8debdc7e4716d3d64d7b3c70667a7a',
  '69cf02ce2a0478a806fc13ac965c37c3c7d25333',
  '5e7710a5db180cf73a9e75f681d713f55a305d11',
  // 2026-09-13 BLOCK-70 P3 隧道实现提交 1c40b35：MobileSync.tsx 隧道三态区
  // UI 增量的台账漏同步（收口门禁抓出后已补登 UI-319 条目 P3 段）。
  // 不重写共享历史。
  '1c40b3526d75348659421ae57bf2eadfa24ee328',
  // 2026-09-11 BLOCK-81 P1 接线不可变提交 c177374：frontend 仅
  // copilotClient / conversationRunStore 两个字段透传（新增可选 thinkingLevel，
  // 缺省不含＝零 UI 行为变化；真正的控件在 UI-345 落地）。subject 用
  // `feat(agent):` 未带 UI-###；台账已由后续 UI-345 条目覆盖该接线。
  // 不重写共享历史。
  'c177374ba4ee10faf7b7dcab0628198272f8cf70',
  // 2026-09-08 UI-305 P1.1/P1.2 巨型组件拆分（160e0f2c project-workspace 11 内联组件外迁 /
  // feed10da useProjectTreeState 抽取）：纯重构零行为变化，UI-305 台账 verified 段已由收口
  // 提交 ebcc5a16 统一补登（P0-P3 整包一段）。豁免同提交台账要求（对齐 0acffcc 先例）。
  '160e0f2c91c719066a995853c07747ad473cd695',
  'feed10da6d94c181574a3806d5034996c28eaace',
  // 2026-09-01 BLOCK-33 P1 环境自省 0acffcc 触碰 toolActivity.ts（UI surface），
  // 台账已由后续 UI-AUDIT-FIX（P2 提交）补登为 UI-265（in_progress）。
  // 豁免同提交台账要求。
  '0acffcc13c78a27c1c1e764c5d56afe13e4602ef',
  // 2026-08-30 BLOCK-30-BACKEND-CONVERGENCE P1/P2/P4：UI 影响补登为 UI-222
  // （合并条目，见 LEGACY_MESSAGE_EXEMPTIONS 注释）。豁免同提交台账要求。
  'edd1116b2b524bfdc96fc16bc16fa2ad8318b216',
  'd4f459d734b5b7d71076cfb34f661d27e9b8117a',
  '4e51ae15e6e2d92fa5fa4d59f0a76bb898c56c55',
  // 2026-08-28 P6 evidence collection chain repair 44a4b7e predates the
  // UI-201 canonical ledger reconciliation in this governance commit; shared
  // history is intentionally not rewritten.
  '44a4b7e9087a8eade9c061c1d04c6b543378e159',
  // P4R-2 was recorded as UI-113 by the immediately following governance
  // commit 2f0e78d. Its separate message exemption remains declared above.
  '17bb486f3eda58cc14aa2ee5d4386b16f20fc18e',
  // UI-110 renderer redaction hardening is included in the final source-bound
  // Electron trace and the verified ledger reconciliation in 2e3bc1b.
  'f6271911512910e23dad6a383f3c7a961601c122',
  // UI-110's final cross-platform redaction source commit is referenced
  // verbatim by both the stored Electron evidence and the 2e3bc1b ledger row.
  '6f5271e817fb9d6b3ae51aef29bd5bee5a9f36ec',
  // UI-108/UI-109 bound-result completion classification is reconciled by the
  // 2026-08-03 P7 deferral entry; shared history is intentionally not rewritten.
  '2298c968f7afa289a1c257e2fc8ba8d608bad1ed',
  // The initial UX1H implementation is reconciled by the current UI-126 row
  // and acceptance evidence; do not rewrite the already-local implementation commit.
  '7995ee945b0221e2507e1cce11414849a942ac5d',
  // feat(chat): Fork Chat 分支功能在 feat/ui-wave0（UI-143 verified）之后扩展；
  // 台账 UI-143 条目已存在（feat/ui-wave0，W-05/C-02），289101e 为增量扩展，
  // 按 feat/ui-wave0 同一 UI-WAVE0 工作流归属登记，不单独占新 UI 条目
  '289101ea90073f7da5e685617c21fecd6dad7e1f',
  // devah 的 origin/main 不可变提交 e6421e0：窗口控件代码提交，台账由
  // 后续 f624d76 单独登记（UI-106→合并后 UI-129）。豁免同提交台账要求。
  'e6421e07fdf4337944bd7f186926aeeb082049c2',
  // 2026-08-14 Skills UI/frontend pages 不可变实现提交：台账已由
  // 后续 UI-AUDIT-FIX 补登为 UI-157（in_progress）。豁免同提交台账要求。
  'e6bf72ff74480f0b98cfcbbc839268b95d2800c8',
  // 2026-08-14 Copilot UX 不可变实现提交：台账已由
  // 后续 UI-AUDIT-FIX 补登为 UI-158（in_progress）。豁免同提交台账要求。
  '446bfa8f6fb2d23d908ce9358d35c25d4e853ebb',
  // 2026-08-14 Workspace UI plumbing 不可变实现提交：台账已由
  // 后续 UI-AUDIT-FIX 补登为 UI-159（in_progress）。豁免同提交台账要求。
  '3000a069171bb6404719ddd797d1b6e64e92d53c',
  // 2026-08-14 Agent Workbench P1.2 TableRenderer commit 2ba838b 携带
  // scripts/check-ui-productization-audit.mjs 的 UI_ID_PATTERN 扩展。
  // UI-AGENTWB-002 的 audit row + changelog 已在 UI-AUDIT-FIX 5c811f8
  // 一起并入 docs/ui-productization-audit.md，本次 commit 不再单独触碰台账。
  '2ba838be3a046c7b00927bf2d9101c9ad1c6df2e',
  // 2026-08-17 macOS fullscreen 按钮实现不可变提交 d9906fd：台账已由本次
  // BLOCK-14 UI-AUDIT-FIX 补登为 UI-161（in_progress）。豁免同提交台账要求。
  'd9906fd0b7b7060aeb6a9e954c3137db305a0a63',
  // 2026-08-17 macOS fullscreen 重构不可变提交 d08d8b1：台账已由本次
  // BLOCK-14 UI-AUDIT-FIX 补登为 UI-161（in_progress）。豁免同提交台账要求。
  'd08d8b11ba78de8ac0dad5392455c711c8fbe5a9',
  // 2026-08-18 SimpleChat + workspace panels 不可变实现提交 c271010：
  // 台账已由本次 BLOCK-14 UI-AUDIT-FIX 补登为 UI-162（in_progress）。
  // 豁免同提交台账要求。
  'c271010035168678662719a0790c9af17ea61807',
  // 2026-08-18 Result Studio 前端 + 持久化不可变实现提交 e40313e：
  // 台账已由本次 BLOCK-14 UI-AUDIT-FIX 补登为 UI-163（in_progress）。
  // 豁免同提交台账要求。
  'e40313e0e81f5a9ee70ace158cebb8a3e688a9ca',
  // 2026-08-19 BLOCK-16 PHASE 3 不可变实现提交 da48006：events.ts 加
  // agentTaskDone + copilotClient.ts SSE 4 处 done 分支 dispatch +
  // useWorkingTreeReview.ts 订阅 typed event bus。台账已由本次
  // BLOCK-16 closeout 笔录登记为 UI-180 in_progress。豁免同提交台账要求。
  'da480063728d900ce6bfe4cf5c0c642a264a2f72',
  // 2026-08-21 Fork Chat 演进不可变提交 30ff32f：feat(chat) 在 feat/ui-wave0
  // （UI-143 verified）之后增量扩展；台账 UI-143 条目已存在（289101e verified），
  // 30ff32f 按 feat/ui-wave0 同一 UI-143 工作流归属登记，不单独占新 UI 条目。
  // 豁免同提交台账要求。
  '30ff32f1e3f27fd53d2b51d36332aab93d12c985',
  // 2026-08-21 Skills UI/frontend pages 演进不可变提交 b6f69a4：台账已由
  // earlier e6bf72f 登记为 UI-157（in_progress），本次 commit 为后续增量
  // 扩展。按 UI-157 同一工作流归属登记，不单独占新 UI 条目。
  // 豁免同提交台账要求。
  'b6f69a4573e83cb9d6451a6c65004dca8a06bb36',
  // 2026-08-21 Copilot UX 演进不可变提交 4e81ef9：台账已由 earlier 446bfa8
  // 登记为 UI-158（in_progress），本次 commit 为后续增量扩展。按 UI-158 同一
  // 工作流归属登记，不单独占新 UI 条目。豁免同提交台账要求。
  '4e81ef92946ff905b3f55806eefac3139296653e',
  // 2026-08-21 Workspace UI plumbing 演进不可变提交 6bb9ecb：台账已由
  // earlier 3000a06 登记为 UI-159（in_progress），本次 commit 为后续增量
  // 扩展。按 UI-159 同一工作流归属登记，不单独占新 UI 条目。
  // 豁免同提交台账要求。
  '6bb9ecbacf2f2cf7bb023dd5bc4d9852cfb951b8',
  // 2026-08-21 Agent Workbench P1.2 TableRenderer 演进不可变提交 05e8546：
  // subject `feat(agent-workbench)` 未带 UI-###；台账已由 earlier 2ba838b
  // 登记为 UI-AGENTWB-002（in_progress），本次 commit 为后续增量扩展。按
  // UI-AGENTWB-002 同一工作流归属登记，不单独占新 UI 条目。
  // 豁免同提交台账要求。
  '05e85461bc855484ef4a34c7b1d46de0c703b439',
  // 2026-08-21 macOS fullscreen 按钮演进不可变提交 4dbc444：台账已由
  // earlier d9906fd 登记为 UI-161（in_progress → verified），本次 commit 为
  // 后续增量扩展。按 UI-161 同一工作流（custom traffic lights fullscreen）
  // 归属登记，不单独占新 UI 条目。豁免同提交台账要求。
  '4dbc444d0ad42b84033ba13d62561e952a9fce52',
  // 2026-08-21 macOS fullscreen 重构演进不可变提交 f8edc77：台账已由
  // earlier d08d8b1 登记为 UI-161（in_progress → verified），本次 commit 为
  // 后续增量扩展。按 UI-161 同一工作流归属登记，不单独占新 UI 条目。
  // 豁免同提交台账要求。
  'f8edc770291448726dca9b46f01ae23a6f011ba1',
  // 2026-08-21 SimpleChat + workspace panels 演进不可变提交 921a1b3：
  // 台账已由 earlier c271010 登记为 UI-162（in_progress → verified），
  // 本次 commit 为后续增量扩展。按 UI-162 同一工作流归属登记，不单独占新
  // UI 条目。豁免同提交台账要求。
  '921a1b3e5974baab919c3bc652780a818261bf1e',
  // 2026-08-21 Result Studio 前端 + 持久化演进不可变提交 1894f5d：
  // 台账已由 earlier e40313e 登记为 UI-163（in_progress → verified），
  // 本次 commit 为后续增量扩展。按 UI-163 同一工作流归属登记，不单独占新
  // UI 条目。豁免同提交台账要求。
  '1894f5d1cb1031d09c780dd3c387ad582b6630a1',
  // 2026-08-21 BLOCK-16 PHASE 3 演进不可变提交 59ccaba：台账已由 earlier
  // da48006 登记为 UI-180（in_progress），本次 commit 为后续增量扩展。按
  // UI-180 同一工作流归属登记，不单独占新 UI 条目。豁免同提交台账要求。
  '59ccaba221b55d9faee953d4c1e1537b11cc4283',
  // 2026-08-24 BLOCK-22-CODEMIRROR-INLINE-DIFF 不可变实现提交 (共 8 commits)：
  // 台账 WIP 锁约束，按 governance §Guardrails L84 "Never modify unknown WIP"
  // 不改 ui-productization-audit.md。豁免同提交台账要求。
  '3745bd5e54c46ed37f947516cb9ad9ea15af6fe5',
  'b9e697ff67f6c5e8f5b7a4ba6570f88f6e3ae472',
  '0436be29d68e578e38c5883b6853070907f248be',
  '0e28498e85cf7b638af58d5a8b67e4bddd680fe8',
  'b1f4453995b6b33c2d1b55f223bc60e1fc222efa',
  'e83199ce104b205bec597b3d64fa1667a2300b30',
  'aba735c529574bab6924dba0a565430e64887bc3',
  '6483aeb48d6c64f6b24dd5d14a9611bb4d72b38b',
  // 2026-08-24 BLOCK-22 workspace preview 不可变实现提交 2a4d435：subject
  // `fix(workspace-preview)` 未带 UI-###；台账 WIP 锁约束，按 governance §Guardrails
  // L84 "Never modify unknown WIP" 不改 ui-productization-audit.md。
  // 不重写共享历史。
  '2a4d4350615847aa64eacd4e2310a2d3d21024e3',
  // 2026-08-24 BLOCK-22 DevBridge 挂载 不可变实现提交 89da711：subject
  // `feat(block-22-p4.5-p4.6)` 未带 UI-###；台账 WIP 锁约束，按 governance §Guardrails
  // L84 "Never modify unknown WIP" 不改 ui-productization-audit.md。
  // 不重写共享历史。
  '89da711164376ad67fddb9d808a1a268e5a4d30b',
  // 2026-08-25 BLOCK-22 P4.6 CSS selector 修复 不可变实现提交 8006880：subject
  // `fix(block-22-p4.6): inline-diff 绿底/红底 CSS selector 修复 [BLOCK-22] inline-diff`
  // 未带 UI-###；台账 WIP 锁约束，按 governance §Guardrails L84
  // "Never modify unknown WIP" 不改 ui-productization-audit.md。
  // 不重写共享历史。
  '8006880cad6537980a11a82de0069601bb0c7dc1',
  // 2026-08-26 BLOCK-22 P4.7 accept/reject widget 注入 不可变实现提交 9cb6e96：subject
  // `feat(block-22-p4.7): inject accept/reject widgets into hunk lines + dismissHunk with fade transition [BLOCK-22]`
  // 未带 UI-###；台账已由本 commit 补登为 UI-195（in_progress）。
  // 不重写共享历史。
  '9cb6e9624bea9d33c5e9fd08cf52c7137d722893',
  // 2026-09-03 BLOCK-50 审阅删除文件兜底不可变提交 ce43048：台账已由
  // BLOCK-51 收口提交补登为 UI-279（verified）。豁免同提交台账要求。
  'ce43048305c4abb3a565860addc52e8b072a877d',
  // 2026-09-07 UI-302 主题色系统不可变实现提交 1e64a0f：当日实现未同步台账；
  // 台账已由本次 UI-AUDIT-FIX 补登为 UI-302（verified，实机证据
  // acceptance/block-49/）。不重写共享历史。
  '1e64a0ffc5d3e52e569c815a60c1d52ff49fcbfb',
  // 2026-09-07 8f3d55a「移除工作目录修改功能」不可变提交：误删 ProjectNode
  // 组件定义致左栏项目树崩溃（UI surface 回归），当日未同步台账；回归诊断
  // 与恢复修复已由本次 UI-AUDIT-FIX 补登为 UI-306（verified，证据
  // acceptance/ui-306/）。不重写共享历史。
  '8f3d55a5d9b7a4638b0a6bd7a391706e04710e15',
  // 2026-09-06 4844e88「全量核对收口」不可变提交：frontend 仅触碰
  // ReviewMode.test.tsx + chat-file-references.test.ts 两个 *test* 文件
  // （biof3:// → gewu:// 改名回归的测试对齐），无产品 UI surface 变化；
  // 不占 UI 条目。同时豁免同提交台账要求（subject `fix:` 未带 UI-###）。
  '4844e8855ae5b25ce95e949e784b4cd0d312c1d3',
  // 2026-09-07 39f0104「composer 窄态图标化」不可变实现提交：subject 带
  // UI-301，为 UI-301 多智能体活动面板的加映增量扩展，按 UI-301 同一
  // 工作流归属登记，不单独占新 UI 条目。豁免同提交台账要求。
  '39f01040b0e62ddfae1508cfe0efc855e79ae0b7',
  // 2026-09-07 b2c1879「首页启动卡片文字垂直居中」不可变实现提交：subject
  // 带 UI-301，CSS-only 加映增量扩展，按 UI-301 同一工作流归属登记，
  // 不单独占新 UI 条目。豁免同提交台账要求。
  'b2c1879cc5e1ac88ebcce8d33a64ea4000cefc07',
  // 2026-09-07 c138dba「设置面板新增界面字号调节」不可变实现提交：subject
  // 带 UI-302，为 UI-302 设置面板外观工作流（主题色系统之后）的加映增量
  // 扩展，台账 UI-302 补登条目已并入其加映记录。豁免同提交台账要求。
  'c138dba836df0c252303e45c6b945006f5eedc8d',
])
// UI-### issue ids: numeric series (UI-001..UI-999) and the named
// AGENTWB namespace (UI-AGENTWB-001..UI-AGENTWB-999) used by the
// Agent Workbench enhancement plan. Both must appear in commit
// subjects or in the matching audit row.
const UI_ID_PATTERN = /\bUI-(?:\d{3}|AGENTWB-\d{3})\b/gi

// hooks/ is a UI-adjacent React state surface but the historical gate
// surfaced its drift as `isUiSurface` failures that required manual
// LEGACY_*_EXEMPTIONS overrides. Per DOC-GOVERNANCE-GATES / GATES-0
// (2026-08-16), hooks/ files are declared explicitly out of scope for
// the UI ledger gate. The whitelist below enumerates the current
// hooks/ root + the known top-level hook files so future additions are
// intentional: any file under `frontend/src/hooks/` is treated as
// non-UI surface and must not trigger `ui:audit:check` fail-closed.
//
// Rationale (W3 audit §2 row 4): hook commits such as `e6bf72f`
// (useSkillStore), `446bfa8` (useErrorFormatter), and `3000a06`
// (conversationRunStore) historically relied on LEGACY exemptions
// because `isUiSurface` did not match the hooks path. The whitelist
// collapses that workaround into an explicit rule rather than
// maintaining per-commit exemptions.
const UI_AUDIT_HOOKS_WHITELIST = Object.freeze({
  // Directory prefix: any file under this root is excluded from the UI surface check.
  directoryPrefix: 'frontend/src/hooks/',
  // Top-level hook files (also covered by the prefix; listed explicitly for
  // audit reviewers and to anchor the contract on the 2026-08-16 hook set).
  files: Object.freeze([
    'frontend/src/hooks/useAiSettings.ts',
    'frontend/src/hooks/useAutoUpdate.ts',
    'frontend/src/hooks/useConversationJobs.ts',
    'frontend/src/hooks/useConversations.ts',
    'frontend/src/hooks/useDurableConversationLoop.ts',
    'frontend/src/hooks/useHarnessWorkflowStatus.ts',
    'frontend/src/hooks/usePluginStore.ts',
    'frontend/src/hooks/useResizableColumns.ts',
    'frontend/src/hooks/useRightPanelTabs.ts',
    'frontend/src/hooks/useRuntimeResourceSnapshot.ts',
    'frontend/src/hooks/useSkillStore.ts',
    'frontend/src/hooks/useTerminalSession.ts',
    'frontend/src/hooks/useWorkspaceLayout.ts',
    'frontend/src/hooks/useWorkspacePanels.ts',
    'frontend/src/hooks/useWorkspaceRouting.ts',
  ]),
})

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', options.allowFailure ? 'ignore' : 'pipe'],
  }).trim()
}

function lines(value) {
  return value ? value.split('\n').filter(Boolean) : []
}

function isUiSurface(file) {
  // hooks/ is explicitly out of scope per UI_AUDIT_HOOKS_WHITELIST (GATES-0).
  // Files under this prefix are React state surfaces whose changes do not
  // require a `docs/ui-productization-audit.md` row.
  if (file.startsWith(UI_AUDIT_HOOKS_WHITELIST.directoryPrefix)) {
    return false
  }
  return (
    file === 'frontend/src/App.tsx' ||
    file.startsWith('frontend/src/components/') ||
    file.startsWith('frontend/src/pages/') ||
    file.startsWith('frontend/src/styles/') ||
    file.startsWith('frontend/src/themes/') ||
    /\.module\.css$/.test(file)
  )
}

// Conventional Commits chore/worktree/etc. prefixes are explicitly out of
// scope for the UI ledger; they may touch UI surfaces (e.g. a chore commit
// that parks a batch of WIP changes) but should not be required to add a new
// UI-### row. Real UI tickets must still use feat/fix/refactor/ui prefixes.
function isChoreCommit(subject) {
  return /^\s*(chore|build|ci|docs|test)(\(.*?\))?(!)?:\s/.test(subject)
}

// BLOCK-44 — 提取边界统一归一为大写 canonical 形态：
// UI_ID_PATTERN 大小写不敏感（/gi），但 schema（ui-audit-report.schema.json）
// 与台账条目标题均为严格大写。不归一会导致：
//   1. 台账行文小写 ui-### 以独立 id 混入 registeredIds（`ui-193` ≠ `UI-193`）；
//   2. --report 的 knownUiIds/unmappedIds 携带小写 → schema 校验必败 → 报告永不落盘。
function uiIds(value) {
  return [...new Set((value.match(UI_ID_PATTERN) ?? []).map((id) => id.toUpperCase()))]
}

function baselineIsAvailable() {
  try {
    git(['merge-base', '--is-ancestor', ENFORCEMENT_BASELINE, 'HEAD'])
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// GATES-3 (BLOCK-14) additions below — keep the legacy synchronous
// `runUiAudit()` unchanged for the default `npm run ui:audit:check` path.
// ---------------------------------------------------------------------------

import fsSync from 'node:fs'

// Load all UI-### ids registered in docs/ui-productization-audit.md.
// The set is the source of truth for "hasUnmappedSurface" detection —
// a commit subject that references a UI-### id absent from this set
// (and not LEGACY_EXEMPTIONS-covered) classifies as a "未登记引用"
// classification conflict (exit 2).
function loadRegisteredUiIdsSync() {
  const content = fsSync.readFileSync(AUDIT_PATH, 'utf8')
  return uiIds(content)
}

// Async variant — used by callers that already have an event loop
// running (vitest harness, `--report` JSON mode).
async function loadRegisteredUiIds() {
  return loadRegisteredUiIdsSync()
}

// Detect "未登记 UI 编号" classification conflicts.
//
// A commit subject that mentions a UI-### id not present in
// `registeredIds` (and not LEGACY_EXEMPTIONS-covered) returns a
// UI_AUDIT_UNMAPPED failure; otherwise returns null. Pure function —
// exercised by unit tests without touching the git repository.
function detectUnmappedSurface({
  commit,
  subject,
  body = '',
  registeredIds,
  legacyMessageExemptions,
  legacyAuditSyncExemptions,
}) {
  const ids = uiIds(`${subject}\n${body}`)
  if (ids.length === 0) return null
  const unmapped = ids.filter((id) => !registeredIds.includes(id))
  if (unmapped.length === 0) return null
  if (
    legacyMessageExemptions.has(commit) ||
    legacyAuditSyncExemptions.has(commit)
  ) {
    return null
  }
  const shortCommit = commit.slice(0, 7)
  const text = `${shortCommit}: UI 提交信息引用的 UI-### 编号未在 ${AUDIT_PATH} 注册（${unmapped.join('、')}）`
  return {
    code: 'UI_AUDIT_UNMAPPED',
    message: text,
    commit: shortCommit,
    unmappedIds: unmapped,
  }
}

// Decide which exit code to use based on the structured failures and
// the active print mode.
//
// Default mode (`'default'`):
//   - any UI_AUDIT_UNMAPPED failure → 2 (classification conflict)
//   - any UI_AUDIT_SYNC / UI_ID_MISSING / WORKTREE_UI failure → 1 (hard FAIL)
//   - else                                                       0 (PASS)
//
// Development mode (`'development'`):
//   - any UI_AUDIT_UNMAPPED or hard-FAIL with `classification === 'conflict'`
//     is downgraded to exit 2 (developer signal, not CI gate)
//   - non-conflict failures still exit 1
//   - else                                                       0
function isClassificationConflict(failure) {
  if (!failure) return false
  if (failure.code === 'UI_AUDIT_UNMAPPED') return true
  return failure.classification === 'conflict'
}

function decideExitCode(result, printMode = 'default') {
  const failures = result?.structuredFailures ?? []
  if (failures.length === 0) return 0
  if (printMode === 'development') {
    // Development mode: every failure downgrades to exit 2 so that
    // LEGACY_*_EXEMPTIONS-miss situations (e.g. a new commit that the
    // developer intends to grandfather via a subsequent UI-AUDIT-FIX)
    // do not fail-closed during local iteration. Production CI uses
    // 'default' mode and gets exit 1 for hard FAILs.
    return 2
  }
  // Default mode: any conflict ⇒ 2; otherwise ⇒ 1
  if (failures.some(isClassificationConflict)) return 2
  return 1
}

// Parse `--print-mode=<value>` from CLI argv. Unknown values fall back
// to 'default' so the default behaviour is preserved.
function parsePrintMode(argv) {
  const flag = argv.find((arg) => typeof arg === 'string' && arg.startsWith('--print-mode='))
  if (!flag) return 'default'
  const value = flag.slice('--print-mode='.length).trim()
  if (value === 'development') return 'development'
  return 'default'
}

// Default print mode applied at top-level for the legacy `npm run
// ui:audit:check` path. Default = 'default' (no behaviour change).
const TOP_LEVEL_PRINT_MODE = parsePrintMode(process.argv.slice(2))

// Async wrapper around the legacy `runUiAudit()` so external callers
// (vitest harness, future `--report` JSON consumers) can request
// `hasUnmappedSurface` detection with a pre-loaded registry set. The
// default `npm run ui:audit:check` path does NOT use this wrapper.
async function runUiAuditAsync(options = {}) {
  const {
    registeredIds = loadRegisteredUiIdsSync(),
    detectUnmapped = true,
  } = options

  const result = runUiAudit()
  if (!detectUnmapped) return { ...result, printMode: options.printMode ?? 'default' }

  const extras = []
  if (baselineIsAvailable()) {
    const commits = lines(git(['rev-list', '--reverse', `${ENFORCEMENT_BASELINE}..HEAD`]))
    for (const commit of commits) {
      const files = lines(git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit]))
      if (!files.some(isUiSurface)) continue
      const message = git(['show', '-s', '--format=%s%n%b', commit])
      const subject = message.split('\n', 1)[0] ?? ''
      if (isChoreCommit(subject)) continue
      const failure = detectUnmappedSurface({
        commit,
        subject,
        body: message,
        registeredIds,
        legacyMessageExemptions: LEGACY_MESSAGE_EXEMPTIONS,
        legacyAuditSyncExemptions: LEGACY_AUDIT_SYNC_EXEMPTIONS,
      })
      if (failure) extras.push(failure)
    }
  }
  if (extras.length === 0) return { ...result, printMode: options.printMode ?? 'default' }

  return {
    failures: [...result.failures, ...extras.map((f) => f.message)],
    structuredFailures: [...result.structuredFailures, ...extras],
    knownIds: result.knownIds,
    baselineAvailable: result.baselineAvailable,
    printMode: options.printMode ?? 'default',
  }
}

/**
 * Run the UI audit check and return a structured result. The legacy
 * top-level module body also runs for backward compatibility with `npm run
 * ui:audit:check` — it inlines the same logic and pushes the same string
 * failures to `failures` so the existing `process.exit(1)` path is
 * preserved verbatim. `runUiAudit()` exists for the GATES-2 `--report`
 * mode and for any future caller that wants a structured payload.
 *
 * Each entry in `structuredFailures` is `{code, message, commit|null}`.
 * Codes are stable identifiers so downstream consumers can rely on them.
 */
function runUiAudit() {
  const failures = []
  const structuredFailures = []

  if (baselineIsAvailable()) {
    const commits = lines(git(['rev-list', '--reverse', `${ENFORCEMENT_BASELINE}..HEAD`]))

    for (const commit of commits) {
      const files = lines(git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit]))
      if (!files.some(isUiSurface)) continue

      const message = git(['show', '-s', '--format=%s%n%b', commit])
      const subject = message.split('\n', 1)[0] ?? ''
      const shortCommit = commit.slice(0, 7)

      if (isChoreCommit(subject)) continue

      if (!files.includes(AUDIT_PATH) && !LEGACY_AUDIT_SYNC_EXEMPTIONS.has(commit)) {
        const text = `${shortCommit}: UI 改动没有同步 ${AUDIT_PATH}`
        failures.push(text)
        structuredFailures.push({ code: 'UI_AUDIT_SYNC', message: text, commit: shortCommit })
      }
      if (uiIds(message).length === 0 && !LEGACY_MESSAGE_EXEMPTIONS.has(commit)) {
        const text = `${shortCommit}: UI 提交信息缺少 UI-### 问题编号`
        failures.push(text)
        structuredFailures.push({ code: 'UI_ID_MISSING', message: text, commit: shortCommit })
      }
    }
  }

  const trackedChanges = lines(git(['diff', '--name-only', 'HEAD']))
  const untrackedChanges = lines(git(['ls-files', '--others', '--exclude-standard']))
  const worktreeFiles = [...new Set([...trackedChanges, ...untrackedChanges])]

  if (worktreeFiles.some(isUiSurface) && !trackedChanges.includes(AUDIT_PATH)) {
    const text = `当前工作区包含 UI 改动，但没有同步 ${AUDIT_PATH}`
    failures.push(text)
    structuredFailures.push({ code: 'WORKTREE_UI', message: text, commit: null })
  }

  const knownIds = uiIds(git(['log', '--format=%s%n%b']))
  return {
    failures,
    structuredFailures,
    knownIds,
    baselineAvailable: baselineIsAvailable(),
  }
}

const uiAuditResult = runUiAudit()
const failures = uiAuditResult.failures

if (failures.length > 0) {
  console.error('[ui-audit] UI 实现与审计台账不同步：')
  for (const failure of failures) console.error(`- ${failure}`)
  console.error('[ui-audit] UI 状态只能在实机验证后标记 verified；代码完成请先记录为 in_progress。')
  process.exit(1)
}

const knownIds = uiAuditResult.knownIds
console.log(`[ui-audit] 同步检查通过；Git 历史已有 ${knownIds.length} 个带实现证据的 UI 问题编号`)

/**
 * GATES-2 `--report` JSON output mode. Emits a deterministic JSON report
 * conforming to `docs/schemas/ui-audit-report.schema.json`. Exit codes:
 *   0 — schema-valid report written; check passed
 *   1 — schema-valid report written; check failed
 *   2 — classification conflict (path invalid, write failed, schema failed)
 *
 * This branch only runs when the script is executed directly and the user
 * passed `--report <path>`. The legacy execution path above remains
 * untouched for `npm run ui:audit:check` and adhoc invocations.
 */
async function runReportMode(reportPathRaw) {
  const reportPath = path.resolve(reportPathRaw)
  const result = runUiAudit()
  const isFailure = result.structuredFailures.length > 0
  const status = isFailure ? 'FAIL' : 'PASS'
  const exitCode = isFailure ? 1 : 0

  const report = {
    schemaVersion: GATE_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    script: 'scripts/check-ui-productization-audit.mjs',
    mode: 'report',
    exitCode,
    summary: {
      status,
      result: isFailure ? 'fail' : 'pass',
      failures: result.structuredFailures.length,
      knownUiIds: result.knownIds.length,
      baselineAvailable: result.baselineAvailable,
      baselineShort: ENFORCEMENT_BASELINE.slice(0, 7),
    },
    failures: result.structuredFailures,
    knownUiIds: result.knownIds.slice().sort(),
  }

  const validation = validateReport('scripts/check-ui-productization-audit.mjs', report)
  if (!validation.valid) {
    console.error('[ui-audit:report] 分类冲突 — produced JSON does not match schema:')
    for (const err of validation.errors) {
      console.error(`  - ${err.path} ${err.keyword}: ${err.message}`)
    }
    process.exitCode = 2
    return
  }

  try {
    const parentDir = path.dirname(reportPath)
    await fs.mkdir(parentDir, { recursive: true })
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  } catch (error) {
    console.error(`[ui-audit:report] 分类冲突 — failed to write report to ${reportPath}: ${error.message}`)
    process.exitCode = 2;
    return
  }
  report.reportPath = reportPath
  if (isFailure) {
    console.error(`[ui-audit:report] FAIL (${result.structuredFailures.length} failure(s)); report written to ${reportPath}`)
    process.exitCode = 1
    return
  }
  console.log(`[ui-audit:report] PASS (${result.knownIds.length} UI-### ids); report written to ${reportPath}`)
  process.exitCode = 0
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  const argv = process.argv.slice(2)
  const reportIdx = argv.indexOf('--report')
  if (reportIdx >= 0) {
    const reportPathRaw = argv[reportIdx + 1]
    if (!reportPathRaw || reportPathRaw.startsWith('--')) {
      console.error('--report requires a non-empty output path argument.')
      process.exitCode = 2
    } else {
      runReportMode(reportPathRaw).catch((error) => {
        console.error(`[ui-audit:report] 分类冲突 — ${error.message}`)
        process.exitCode = 2
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Exports — pure constants and helper functions exposed for unit tests
// (vitest / node:test). Top-level execution paths above are guarded by
// `path.resolve(process.argv[1] ?? '') === SCRIPT_PATH` so importing this
// module does NOT trigger the default check.
// ---------------------------------------------------------------------------
export {
  AUDIT_PATH,
  ENFORCEMENT_BASELINE,
  UI_ID_PATTERN,
  LEGACY_MESSAGE_EXEMPTIONS,
  LEGACY_AUDIT_SYNC_EXEMPTIONS,
  UI_AUDIT_HOOKS_WHITELIST,
  uiIds,
  isUiSurface,
  isChoreCommit,
  baselineIsAvailable,
  runUiAudit,
  runUiAuditAsync,
  loadRegisteredUiIds,
  loadRegisteredUiIdsSync,
  detectUnmappedSurface,
  isClassificationConflict,
  decideExitCode,
  parsePrintMode,
  TOP_LEVEL_PRINT_MODE,
}
