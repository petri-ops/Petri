#!/usr/bin/env node
/**
 * M 波次阶段六件套精确增量回写器（避免超长内联命令）。
 * 只做「前插一行 / 表格行替换 / 追加收口段」三种动作，不覆盖他方在制 WIP 内容。
 * 用法：node scripts/m-blueprint-stage-writeback.mjs --stage m2 --block BLOCK-428
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const get = (k) => args[args.indexOf(k) + 1];
const stage = get('--stage');
const block = get('--block');

const STAGES = {
  m2: {
    plan: 'docs/block-428-m2-long-task-resume-plan.md',
    closeout: `## 收口笔录（2026-11-11 · BLOCK-428 / COMPLETED，带 2 项 external-blocked）

**交付**：M2-1…M2-5 五项能力收敛为单一纯模块 \`long-task-resume.js\`（append-only transcript + hydrate 中断合成 / checkpoint 写读校验 / 8 阶段任务图 / CAS 幂等 / 单一 owner 租约）。HK-01 三轮红→绿 14/14；门自身 7 项篡改必红全绿；\`gate:long-task-resume\` 连续 3 轮 PASS 0 issues；lint 0；docs:check 573 / ui:audit / W5a / test:changed:list 全绿。

**门禁实况（不写全绿）**：\`test:changed\` 1441 tests / 2 fail（UI-629 与 P6 两红均 W 类在制 WIP，与 M0/M1 同构）；\`closeout\` **exit 1**（第 5 门拦停，前 4 门 PASS、后续 13 门 fail-fast 未执行）。

**范围守住**：\`db/schema.js\` / \`server.js\` / \`agent-task-store.js\` 零改动（coreSha 绑定未动）；零新增依赖 / 零放宽基线 / 零触碰他方在制 WIP / 零 stage 零提交 / 零产品契约撤销 / 零 G1+ 外推。

**external-blocked + 补腿**：① DB 层 UNIQUE(task_id,seq)（触及 perf 基线热路径，须干净树 + owner 重采基线后按迁移流程加约束）；② 9223 离屏崩溃注入实机腿（M4 fixture 后在离屏实例跑 dev-verify，跑完立即 kill）。两项不计入完成数，M7 逐件终态化。

**证据**：\`acceptance/m-blueprint-2026-11-11/m2/\`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
`,
    tableRow: ['| M2 崩溃续跑 / 任务图 / 幂等 | 待发令 | P0 主线 | 未开工 |', '| M2 崩溃续跑 / 任务图 / 幂等 | BLOCK-428 | P0 主线 | completed（五项能力 + 14/14 负测；DB 约束与 9223 实机腿 external-blocked） |'],
    auditLine: '最后更新：2026-11-11（🏁 **第六轮 M2=BLOCK-428 completed（带 2 项 external-blocked）**：单一纯模块收敛 append-only transcript + hydrate 中断合成 / checkpoint 写读校验（损坏 fail-closed）/ 8 阶段任务图（暂停+重派+恢复不回退）/ CAS 幂等 / 单一 owner 租约；HK-01 14/14、专项门连续 3 轮 PASS、lint 0、docs:check 573。test:changed 1441/2 fail 两红均 W 类在制 WIP；closeout exit 1（第 5 门拦停），前 4 门 PASS、后 13 门未执行，如实登记不写全绿。DB 层 UNIQUE 因触及 perf 基线热路径登记 external-blocked；9223 实机腿 external-blocked；schema/server/agent-task-store 与 coreSha 零改动。证据=acceptance/m-blueprint-2026-11-11/m2/。串行槽位转空；M3 按预授权继续。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    auditRecord: '| ✅ **BLOCK-428（第六轮 M2 · 长任务可靠性）completed（带 2 项 external-blocked）**：五项能力收敛单一纯模块，HK-01 14/14、门三连 PASS、lint 0；DB 约束与 9223 实机腿 external-blocked 带补腿条件；coreSha 绑定未动。证据=`acceptance/m-blueprint-2026-11-11/m2/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | BLOCK-428 / COMPLETED |',
    roadmapAnchor: '最后更新：2026-11-11（🏁 **第六轮 M1=BLOCK-427',
    roadmapLine: '最后更新：2026-11-11（🏁 **第六轮 M2=BLOCK-428（长任务可靠性）completed，带 2 项 external-blocked**：五项能力收敛单一纯模块；HK-01 14/14、专项门连续 3 轮 PASS、docs:check 573；closeout exit 1 两红 W 归属如实登记。串行槽位转空；下一阶段=M3 上下文与工具能力面（按预授权继续）。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    handoffAnchor: '最后更新：2026-11-11（**第六轮 M1=BLOCK-427',
    handoffLine: '最后更新：2026-11-11（**第六轮 M2=BLOCK-428 completed（带 2 项 external-blocked）**：串行槽位转空；证据=acceptance/m-blueprint-2026-11-11/m2/m2-evidence.json；下一阶段=M3 上下文与工具能力面。DB 层 UNIQUE 约束与 9223 实机腿 external-blocked 带补腿条件；coreSha 绑定未动。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    uiNote: '> M2 / BLOCK-428 六件套同批登记（2026-11-11）：本阶段为 core 内核纯新增模块，**零 UI 增量、零产品行为变化**；台账不新增 UI-### 编号、不改状态词、不重打 debt 棘轮。证据=`acceptance/m-blueprint-2026-11-11/m2/`。G0 开发期常态 · 不外推 packaged/Provider/GA.',
    evidenceDir: 'acceptance/m-blueprint-2026-11-11/m2/',
  },
  m3: {
    plan: 'docs/block-429-m3-tool-capability-plan.md',
    closeout: `## 收口笔录（2026-11-11 · BLOCK-429 / COMPLETED，带 1 项 done-partial）

**交付**：M3-1…M3-6 六项能力收敛为单一纯模块 \`tool-capability.js\`：compact 五字段恢复契约 + 有界重读 / 跨表只读对账门（\`CONTRACTS ⊆ TOOL_METADATA\`）/ 声明驱动拓扑并行调度与合成取消结果 / 结果预算落 artifact 与错误结构化投影 / 权限 fail-closed + 竞速 settled 闩 + 可恢复拒绝 / \`untrusted\` 包装与来源标注。\`needsApproval\` 首次有真实生产消费点（\`adjudicatePermission\`）。HK-01 三轮红→绿 18/18；门自身 7 项篡改必红全绿；\`gate:tool-capability\` PASS 0 issues；lint 0；docs:check 574 / ui:audit / W5a 全绿。

**门禁实况（不写全绿）**：\`test:changed\` 1459 tests / 2 fail（UI-629 与 P6 两红均 W 类在制 WIP）；\`closeout\` **exit 1**（第 5 门拦停，前 4 门 PASS、后续 13 门 fail-fast 未执行）。

**范围守住**：\`tool-defs.js\` / \`tool-metadata.js\` / \`registry.js\` / \`workspace-tools.js\` 零改动（\`workspace_exec\` 默认放行裁决保持、\`MAX_AGENT_ITERS=Infinity\` 未改）；零新增依赖 / 零放宽基线 / 零触碰他方在制 WIP / 零 stage 零提交 / 零撤销既有裁决 / 零 G1+ 外推。

**done-partial + 补腿**：工具能力元数据生成器（新增 1 工具改动处 7→1）归 **M6-A**；本包先建只读跨表对账门暴露 115/114/71 漂移。补腿条件=M6-A 拆前拆后同套绿基线落生成器，复跑 \`quality:surface\` 且 P1/P2=0、计数单源。

**证据**：\`acceptance/m-blueprint-2026-11-11/m3/\`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
`,
    tableRow: ['| M3 上下文与工具能力面 | 待发令 | P1 | 未开工 |', '| M3 上下文与工具能力面 | BLOCK-429 | P1 | completed（六项能力 + 18/18 负测；生成器改造 done-partial 归 M6-A） |'],
    auditLine: '最后更新：2026-11-11（🏁 **第六轮 M3=BLOCK-429 completed（带 1 项 done-partial）**：compact 五字段恢复契约 + 有界重读 / 跨表只读对账门 / 声明驱动拓扑并行调度与合成取消结果 / 结果预算落 artifact 与错误结构化投影 / 权限 fail-closed + 竞速 settled 闩 + 可恢复拒绝（needsApproval 真实生产消费者）/ untrusted 包装与来源标注。HK-01 18/18、gate:tool-capability 0 issues、lint 0、docs:check 574。test:changed 1459/2 fail 两红均 W 类在制 WIP；closeout exit 1（第 5 门拦停），前 4 门 PASS、后 13 门未执行，如实登记不写全绿。四表与 workspace_exec 默认放行裁决零改动；生成器改造 done-partial 归 M6-A。证据=acceptance/m-blueprint-2026-11-11/m3/。串行槽位转空；M4 按预授权继续。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    auditRecord: '| ✅ **BLOCK-429（第六轮 M3 · 上下文与工具能力面）completed（带 1 项 done-partial）**：六项能力收敛单一纯模块，HK-01 18/18、专项门 0 issues、lint 0；needsApproval 首次真实消费；四表与 workspace_exec 默认放行零改动；生成器改造归 M6-A。证据=`acceptance/m-blueprint-2026-11-11/m3/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | BLOCK-429 / COMPLETED |',
    roadmapAnchor: '最后更新：2026-11-11（🏁 **第六轮 M2=BLOCK-428',
    roadmapLine: '最后更新：2026-11-11（🏁 **第六轮 M3=BLOCK-429（上下文与工具能力面）completed，带 1 项 done-partial**：六项能力收敛单一纯模块；HK-01 18/18、gate:tool-capability 0 issues、docs:check 574；closeout exit 1 两红 W 归属如实登记。串行槽位转空；下一阶段=M4 评测与可观测（按预授权继续）。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    handoffAnchor: '最后更新：2026-11-11（**第六轮 M2=BLOCK-428',
    handoffLine: '最后更新：2026-11-11（**第六轮 M3=BLOCK-429 completed（带 1 项 done-partial）**：串行槽位转空；证据=acceptance/m-blueprint-2026-11-11/m3/m3-evidence.json；下一阶段=M4 评测与可观测。工具元数据生成器归 M6-A；四表与 workspace_exec 默认放行零改动。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    uiNote: '> M3 / BLOCK-429 六件套同批登记（2026-11-11）：本阶段为 core 内核纯新增模块，**零 UI 增量、零产品行为变化**；台账不新增 UI-### 编号、不改状态词、不重打 debt 棘轮。证据=`acceptance/m-blueprint-2026-11-11/m3/`。G0 开发期常态 · 不外推 packaged/Provider/GA.',
    evidenceDir: 'acceptance/m-blueprint-2026-11-11/m3/',
    auditHeadAnchor: '最后更新：2026-11-11（🏁 **第六轮 M2=BLOCK-428',
  },
  m4: {
    plan: 'docs/block-430-m4-eval-observability-plan.md',
    closeout: `## 收口笔录（2026-11-11 · BLOCK-430 / COMPLETED，带 external-blocked / W / done-partial）

**交付**：M4-1…M4-5 五项能力收敛为单一纯模块 \`long-task-observability.js\`：1000 轮本地 fixture（生成/校验/删除三命令 + manifest，零出网零真实 Provider）/ 成功率·完成度·跨恢复一致性基线（\`claimStableLongTask\` 恒 false）/ traceId 五类节点持久化投影 / usage 三层事实表 + \`model_request_failed\` 失败记账 / 用户可感性能常驻门（400+ 节点必红）+ 零依赖窗口化。HK-01 14/14；门自身 7 项篡改必红全绿；\`gate:long-task-observability\` PASS 0 issues；lint 0；docs:check 575 / ui:audit / W5a 全绿。

**evals 当次读数（不冒充通过）**：\`evals:run --suite smoke --provider=mock\` **1/9 PASS**（ECONNRESET ×8，本机 :3001 无窗栈未起）⇒ \`external-blocked\`；\`evals:gate\` 首轮 exit 1（回归 31）；恢复既有证据后第二轮 exit 0（回归 0）**明确标注 \`REUSED_EXISTING_EVIDENCE\`**（对比 HEAD 版 2026-10-17 既有证据，非当次成功，不计入完成数）。

**自纠（POSTMORTEM 落地）**：\`evals-run.mjs:240\` 按既有实现覆写 tracked 证据 \`acceptance/evals/smoke-latest.json\`；会话早期快照确认该文件起始非在制 WIP（HEAD 干净）⇒ 当次红读数另存本包目录、该文件恢复 HEAD 版（\`git show\` 重定向），M 计数 91→90，零 stage 零提交。教训已落本笔录：任何会写盘的复跑命令跑前须核既有写盘路径是否属起始 WIP，读数另存本包证据目录。

**门禁实况（不写全绿）**：\`test:changed\` 1473 tests / 2 fail（UI-629 与 P6 两红均 W 类在制 WIP）；\`closeout\` **exit 1**（第 5 门拦停，前 4 门 PASS、后续 13 门 fail-fast 未执行）。

**范围守住**：零新增依赖 / 零放宽基线（\`quality:perf\` 基线与 coreSha 绑定未动）/ 零触碰他方在制 WIP / 零 stage 零提交 / 零撤销既有裁决 / 零 G1+ 外推。

**external-blocked / W / done-partial + 补腿**：① SSE 真实端点行为测试（M7 实机腿，需 :3001 无窗栈）；② \`quality:perf\` 场景 4→≥7（干净树 + owner 全量证据重锚）；③ real 档 / 真实 Provider（G1+ 用户显式裁决）；④ evals 接 closeout（\`package.json\` 为在制 WIP，owner 收口后裁决）；⑤ 约 90 个未引用测试分批挂载（归 M6-C 覆盖率只减棘轮）。M6 逐件终态化。

**证据**：\`acceptance/m-blueprint-2026-11-11/m4/\`（m4-evidence.json / evals-readout.json / gate-report.json / fixture/）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
`,
    tableRow: ['| M4 评测与可观测 | 待发令 | P1 | 未开工 |', '| M4 评测与可观测 | BLOCK-430 | P1 | completed（1000 轮 fixture + 14/14 负测；evals run / perf 扩面 / SSE 实机 external-blocked 或 W） |'],
    auditLine: '最后更新：2026-11-11（🏁 **第六轮 M4=BLOCK-430 completed（带 external-blocked / W / done-partial）**：1000 轮本地 fixture（三命令 + manifest，零出网零真实 Provider）/ 长任务成功率·完成度·跨恢复一致性基线（不宣称稳定完成）/ traceId 五类节点持久化投影 / usage 三层事实表 + 失败请求记账 / 用户可感性能常驻门 + 零依赖窗口化。HK-01 14/14、gate:long-task-observability 0 issues、lint 0、docs:check 575。evals:run 当次 1/9 PASS（ECONNRESET，external-blocked）；evals:gate 恢复既有证据后 exit 0 明确标注复用、不冒充当次通过。自纠：evals-run 覆写 smoke-latest.json 已恢复 HEAD 版，M 91→90，零 stage 零提交。test:changed 1473/2 fail 两红 W 归属；closeout exit 1（第 5 门拦停），如实登记不写全绿。证据=acceptance/m-blueprint-2026-11-11/m4/。串行槽位转空；M5 按预授权继续。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    auditRecord: '| ✅ **BLOCK-430（第六轮 M4 · 评测与可观测）completed（带 external-blocked / W / done-partial）**：1000 轮零出网 fixture + 基线（claimStableLongTask 恒 false）+ trace/usage 投影 + 性能门，HK-01 14/14、专项门 0 issues；evals run 红读数如实登记、gate 复用证据明确标注；evals-run 写盘副作用已自纠恢复 HEAD 版。证据=`acceptance/m-blueprint-2026-11-11/m4/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | BLOCK-430 / COMPLETED |',
    roadmapAnchor: '最后更新：2026-11-11（🏁 **第六轮 M3=BLOCK-429',
    roadmapLine: '最后更新：2026-11-11（🏁 **第六轮 M4=BLOCK-430（评测与可观测）completed，带 external-blocked / W / done-partial**：1000 轮本地 fixture + trace/usage 投影 + 性能门；HK-01 14/14、专项门 0 issues、docs:check 575；evals:run 1/9 PASS 归 external-blocked、gate 复用证据已标注；evals-run 写盘副作用自纠恢复 HEAD 版；closeout exit 1 两红 W 归属如实登记。串行槽位转空；下一阶段=M5 安全与正确性纵深（按预授权继续）。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    handoffAnchor: '最后更新：2026-11-11（**第六轮 M3=BLOCK-429',
    handoffLine: '最后更新：2026-11-11（**第六轮 M4=BLOCK-430 completed（带 external-blocked / W / done-partial）**：串行槽位转空；证据=acceptance/m-blueprint-2026-11-11/m4/m4-evidence.json；下一阶段=M5 安全与正确性纵深。evals-run 会覆写 acceptance/evals/smoke-latest.json（已恢复 HEAD 版），后续复跑须先把读数另存本包目录。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    uiNote: '> M4 / BLOCK-430 六件套同批登记（2026-11-11）：本阶段为 core 内核与评测纯新增模块，**零 UI 增量**；DOM 节点/帧率判据属纯函数门，未改渲染层；台账不新增 UI-### 编号、不改状态词、不重打 debt 棘轮。证据=`acceptance/m-blueprint-2026-11-11/m4/`。G0 开发期常态 · 不外推 packaged/Provider/GA.',
    evidenceDir: 'acceptance/m-blueprint-2026-11-11/m4/',
    auditHeadAnchor: '最后更新：2026-11-11（🏁 **第六轮 M3=BLOCK-429',
  },
  m5: {
    plan: 'docs/block-431-m5-security-hardening-plan.md',
    closeout: `## 收口笔录（2026-11-11 · BLOCK-431 / COMPLETED，8 项判据层 done / 生产接线 done-partial）

**交付（不委派）**：M5-1…M5-8 八类安全判据收敛为单一纯模块 \`security-boundaries.js\`：per-boot 随机 token + 空 Origin 全方法校验 + 废弃常量 Bearer 拒绝 / MCP stdio command 白名单 / drag 登记根 + realpath + basename + 长度上限 / 帧导航 allowlist（含 userinfo）+ 权限 session 全覆盖 / tar 条目与 zip 失败清理 / 假成功治理（\`ok:false + code\` 信封、静默 DDL 判红、拒绝全 0 统计）/ git grep 错误 fail-closed + 日志脱敏 / limit·offset 断言 + 原子写 tmp+rename。HK-01 15/15；门自身 7 项篡改必红全绿；\`gate:m5-security\` PASS 0 issues；lint 0；\`quality:secret\` / \`quality:arch\` / W5a / docs:check 576 / ui:audit 全绿。

**门禁实况（不写全绿）**：\`test:changed\` 1488 tests / 2 fail（UI-629 与 P6 两红均 W 类在制 WIP）；\`closeout\` **exit 1**（第 5 门拦停，前 4 门 PASS、后续 13 门 fail-fast 未执行）。

**范围守住**：\`workspace_exec\` 默认放行裁决零改动（git diff 0 行，仅补补偿控制与风险声明）；\`MAX_AGENT_ITERS=Infinity\` / ADMISSION / FK / MCP 计量 / 主题 / 中栏既有裁决全部保持；零新增依赖 / 零放宽基线 / 零触碰在制 WIP / 零 stage 零提交 / 零 G1+ 外推。

**done-partial + 补腿**：八项均为**判据层已交付、生产接线未做**。接线涉及 \`bootstrap.js\` / \`mcp-client.js\` / \`file-dialog.js\` / \`main.js\` / \`secret-scan.mjs\` / \`ai-memory.js\` 等跨模块安全改造，会触碰既有调用方与 12 环，须带 BLOCK-92 拆前拆后同套绿基线，按蓝图归 **M6-A / M6-C** 统一落地（不提前实现后续阶段）。逐件补腿条件见 \`m5-evidence.json:deliverables[].closureCondition\`，M7 gap-ledger 终态化。

**六维度评审**：无 P1；P2 一条（生产接线归 M6，不垫第五层兼容 shim）。ocr 本轮未做（可选外部工具、未装/未配置），按 skill 降级如实声明。

**证据**：\`acceptance/m-blueprint-2026-11-11/m5/\`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
`,
    tableRow: ['| M5 安全与正确性纵深 | 待发令 | P0/P1 | 未开工 |', '| M5 安全与正确性纵深 | BLOCK-431 | P0/P1 | completed（8 类判据 + 15/15 负测；生产接线 done-partial 归 M6-A/M6-C） |'],
    auditLine: '最后更新：2026-11-11（🏁 **第六轮 M5=BLOCK-431 completed（8 项判据层 done / 生产接线 done-partial）**：8 类安全判据收敛单一纯模块（per-boot token + 空 Origin 全方法校验 / MCP command 白名单 / drag 登记根与 realpath / 帧导航 allowlist + 权限 session 全覆盖 / tar 条目与 zip 清理 / 假成功治理统一失败信封 / git grep fail-closed / limit-offset 与原子写）。HK-01 15/15、gate:m5-security 0 issues、lint 0、quality:secret/arch PASS、docs:check 576。test:changed 1488/2 fail 两红 W 归属；closeout exit 1（第 5 门拦停），前 4 门 PASS、后 13 门未执行，如实登记不写全绿。workspace_exec 默认放行裁决零改动，仅补补偿控制；生产接线 done-partial 归 M6-A/M6-C，逐件补腿条件在册。证据=acceptance/m-blueprint-2026-11-11/m5/。串行槽位转空；M6 按预授权继续。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    auditRecord: '| ✅ **BLOCK-431（第六轮 M5 · 安全与正确性纵深）completed（8 项判据层 done / 生产接线 done-partial）**：8 类判据收敛单一纯模块，HK-01 15/15、专项门 0 issues、lint/secret/arch 全绿；workspace_exec 默认放行裁决与既有裁决全部保持；生产接线归 M6-A/M6-C 带拆前拆后同套绿基线。证据=`acceptance/m-blueprint-2026-11-11/m5/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | BLOCK-431 / COMPLETED |',
    roadmapAnchor: '最后更新：2026-11-11（🏁 **第六轮 M4=BLOCK-430',
    roadmapLine: '最后更新：2026-11-11（🏁 **第六轮 M5=BLOCK-431（安全与正确性纵深）completed，8 项判据层 done / 生产接线 done-partial**：8 类判据收敛单一纯模块；HK-01 15/15、gate:m5-security 0 issues、quality:secret/arch PASS、docs:check 576；workspace_exec 默认放行零改动；closeout exit 1 两红 W 归属如实登记。串行槽位转空；下一阶段=M6 工程债务与体验 A–F（按预授权继续）。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    handoffAnchor: '最后更新：2026-11-11（**第六轮 M4=BLOCK-430',
    handoffLine: '最后更新：2026-11-11（**第六轮 M5=BLOCK-431 completed（8 项判据层 done / 生产接线 done-partial）**：串行槽位转空；证据=acceptance/m-blueprint-2026-11-11/m5/m5-evidence.json；下一阶段=M6 工程债务与体验 A–F。八项生产接线补腿条件逐件在册，归 M6-A/M6-C；workspace_exec 默认放行裁决保持。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    uiNote: '> M5 / BLOCK-431 六件套同批登记（2026-11-11）：本阶段为 core 判据纯新增模块，**零 UI 增量**；权限 session 与帧导航判据属纯函数门，未改渲染层；台账不新增 UI-### 编号、不改状态词、不重打 debt 棘轮。证据=`acceptance/m-blueprint-2026-11-11/m5/`。G0 开发期常态 · 不外推 packaged/Provider/GA.',
    evidenceDir: 'acceptance/m-blueprint-2026-11-11/m5/',
    auditHeadAnchor: '最后更新：2026-11-11（🏁 **第六轮 M4=BLOCK-430',
  },
  m6: {
    plan: 'docs/block-432-m6-engineering-debt-plan.md',
    closeout: `## 收口笔录（2026-11-11 · BLOCK-432 / COMPLETED，六组终态均 done-partial / W / U / E）

**交付（A→F 组内串行）**：六组全部为**只读视图 / 判据 / 决策材料**，零改写基线。A 三矩阵共用 schema 只读对账 + IPC 三真相视图（168 通道现取）；B 4 个 >1000 行巨型文件只读清单、零拆分；C 静默 catch 分域下降表（412 处 / 102 文件可复算）；D W 类零触碰 + 4 步人眼测试路线（\`pending_human_eye\`、签字槽全空）；E 168 通道逐件只读分诊（结构·行为双列）；F U 类一页材料（\`pending_user_ruling\`、不改默认）+ Skill 清单只读对账。HK-01 9/9；\`gate:m6-debt\` PASS 0 issues；lint 0；逐组证据=\`acceptance/m-blueprint-2026-11-11/m6/<组>/\`。

**门禁实况（不写全绿）**：\`docs:check\` 577 / \`ui:audit:check\` / \`gate:code-size\` / \`gate:arch-cycles\` / \`gate:silent-catch\` / \`quality:knip:check\` / \`skills:check\` 七门当次全绿；\`test:changed\` 1497 tests / 2 fail（UI-629 与 P6 两红均 W 类在制 WIP）；\`closeout\` **exit 1**（第 5 门拦停，前 4 门 PASS、后续 13 门 fail-fast 未执行）。

**范围守住**：\`silent-catch\` 412 / knip 330 / code-size 86605 / arch-cycles 12 / UI debt 35 / perf 基线全部零改写；\`surface-matrix.json\` 起始即在制 WIP（M），本包只读；4 个巨型文件 git diff 0 行；零新增依赖 / 零触碰在制 WIP / 零 stage 零提交 / 零撤销既有裁决 / 零 G1+ 外推。

**六组终态（无一组冒充 done / verified）**：A/C/E/F \`done-partial\`、B \`W + done-partial\`、D \`W + pending_human_eye\`、F 含 \`pending_user_ruling\`。U/E/V/W 四类逐件在册、不计入完成数，M7 gap-ledger 终态化。补腿条件逐组见 \`m6-evidence.json:groups[].closureCondition\`。

**六维度评审**：无 P1；六组终态如实登记，未用文档措辞升级运行时结果。ocr 本轮未做（可选外部工具、未装/未配置），按 skill 降级如实声明。

**证据**：\`acceptance/m-blueprint-2026-11-11/m6/\`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
`,
    tableRow: ['| M6 工程债务与体验 A–F | 待发令 | P2 | 未开工 |', '| M6 工程债务与体验 A–F | BLOCK-432 | P2 | completed（六组只读视图 + 9/9 负测；终态均 done-partial / W / U / E，零改写基线） |'],
    auditLine: '最后更新：2026-11-11（🏁 **第六轮 M6=BLOCK-432 completed（六组终态均 done-partial / W / U / E）**：A–F 组内串行，全部为只读视图/判据/决策材料，零改写基线（silent-catch 412 / knip 330 / code-size 86605 / arch-cycles 12 / UI debt 35 / surface-matrix 在制 WIP 零触碰）；三矩阵 schema 只读对账 + IPC 三真相视图 / 巨型文件只读清单 / 静默 catch 分域下降表 / 165 通道逐件分诊 / W 零触碰 + E 人眼路线 / U 类材料。HK-01 9/9、gate:m6-debt 0 issues、lint 0、七门治理门全绿。test:changed 1497/2 fail 两红 W 归属；closeout exit 1（第 5 门拦停），前 4 门 PASS、后 13 门未执行，如实登记不写全绿。六组无一组冒充 done 或 verified；U/E/V/W 逐件在册交 M7 终态化。证据=acceptance/m-blueprint-2026-11-11/m6/。串行槽位转空；M7 总收口按预授权继续。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    auditRecord: '| ✅ **BLOCK-432（第六轮 M6 · 工程债务与体验 A–F）completed（六组终态均 done-partial / W / U / E）**：六组组内串行只读视图，HK-01 9/9、专项门 0 issues、七门治理门全绿；零改写基线、零触碰在制 WIP、巨型文件 git diff 0 行；U/E/V/W 不代答交 M7。证据=`acceptance/m-blueprint-2026-11-11/m6/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | BLOCK-432 / COMPLETED |',
    roadmapAnchor: '最后更新：2026-11-11（🏁 **第六轮 M5=BLOCK-431',
    roadmapLine: '最后更新：2026-11-11（🏁 **第六轮 M6=BLOCK-432（工程债务与体验 A–F）completed，六组终态均 done-partial / W / U / E**：六组组内串行只读视图/判据/决策材料；HK-01 9/9、gate:m6-debt 0 issues、七门治理门全绿、docs:check 577；零改写基线、零触碰在制 WIP；closeout exit 1 两红 W 归属如实登记。串行槽位转空；下一阶段=M7 总收口与证据（按预授权继续）。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    handoffAnchor: '最后更新：2026-11-11（**第六轮 M5=BLOCK-431',
    handoffLine: '最后更新：2026-11-11（**第六轮 M6=BLOCK-432 completed（六组终态均 done-partial / W / U / E）**：串行槽位转空；证据=acceptance/m-blueprint-2026-11-11/m6/m6-evidence.json；下一阶段=M7 总收口。六组补腿条件逐件在册；U/E/V/W 四类交 M7 gap-ledger 终态化；零改写基线、零触碰在制 WIP。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    uiNote: '> M6 / BLOCK-432 六件套同批登记（2026-11-11）：本阶段为只读视图/判据/决策材料，**零 UI 增量**；focus-visible 与设置面板 CSS 属在制 WIP 零触碰，人眼路线保持 pending_human_eye；台账不新增 UI-### 编号、不改状态词、不重打 debt 棘轮。证据=`acceptance/m-blueprint-2026-11-11/m6/`。G0 开发期常态 · 不外推 packaged/Provider/GA.',
    evidenceDir: 'acceptance/m-blueprint-2026-11-11/m6/',
    auditHeadAnchor: '最后更新：2026-11-11（🏁 **第六轮 M5=BLOCK-431',
  },
  m7: {
    plan: 'docs/block-433-m7-final-closeout-plan.md',
    closeout: `## 收口笔录（2026-11-11 · BLOCK-433 / 八阶段收口，程序终态 done-partial）

**交付**：① 70 条发现 + G-01…G-12 共 **82 件逐件终态**（机械解析蓝图、零 \`in_progress\`、零编造计数：done 21 / done-partial 47 / pending_human_eye 2 / external-blocked 3 / pending_user_ruling 3 / W 6）；② **十一维第八列复评** 8 升 3 平 0 降，逐维归因与源码锚点，不回溯改第七列、非 verified；③ **长任务自证包**（1000 轮 fixture manifest + 成功率基线 + \`gate:long-task-resume\` 三连 + trace/usage 对账 + 13 条负面边界，9223 实机腿 external-blocked）；④ 六件套同批回写 + AUDIT-LOG 登记 + registry/front-matter/README 状态一致；⑤ 硬门当次读数（\`gate:post-h9-contracts\` 186/186 全绿、\`docs:reconcile\` 0 issues、\`closeout:full\` 三连）。HK-01 7/7、逐件终态门 0 issues、lint 0、docs:check 578。

**门禁实况（不写全绿）**：\`closeout:full\` **连续 3 次 exit 1**，均在第 5 门 \`test:changed\` 拦停（UI-629 布局 gap 锚与 P6 源绑定，两红均 W 类在制 WIP）；前 4 门 PASS、后续 13 门 fail-fast 未执行。首轮另有「M7 plan 未注册 + coverage 漂移」本包引入项，已修后复跑（首轮读数并列留痕）。\`test:changed\` 独立读数 1504 tests / 2 fail / 7 skipped。

**§8 完成定义逐条对账**：已满足 1/2/4/6/7/8；**第 3 条（干净树三连全门 PASS 0 SKIP）与第 5 条（长任务自证包 9223 实机腿）未达证据上限**。按用户 §8 末句「未达证据上限如实标未完成，不得用文档措辞升级运行时结果」⇒ **程序终态 = \`done-partial\`**；治理生命周期 \`status: completed\` 仅表示八阶段执行完毕，不等于验收通过。

**补腿条件**：① owner 收口 89 M + 68 ?? 在制 WIP → 干净树 → 重采 P6 源绑定 → \`closeout:full\` 三连复跑；② 9223 离屏实例跑崩溃注入→重启 resume（禁 \`PETRI_TEST_ONSCREEN\`、跑完立即 kill，截图失败标 \`screenshot_unavailable\`）；③ U/E/V/W 四类保持不代答，签字槽全空、默认语义未改；④ acceptance 蓝图原件属起始 untracked WIP 零触碰，状态由已注册 living-plan 台账承载，回写原件需用户裁决。

**六维度评审**：无 P1；七维逐项过（契约/单一真相/失败语义/测试有效性/边界安全/死代码/YAGNI），详见 \`m7/m7-evidence.json:sixDimensionReview\`。ocr 本轮未做（可选外部工具、未装/未配置），按 skill 降级如实声明。

**范围守住**：零新增依赖 / 零放宽基线 / 零触碰在制 WIP / 零 stage 零提交 / 零撤销既有裁决（\`MAX_AGENT_ITERS=Infinity\`、\`workspace_exec\` 默认放行、ADMISSION/FK/MCP 计量/主题/中栏）/ 零 G1+ 外推。

**证据**：\`acceptance/m-blueprint-2026-11-11/m7/\`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
`,
    tableRow: ['| M7 总收口与证据 | 待发令 | P2 | 未开工 |', '| M7 总收口与证据 | BLOCK-433 | P2 | completed（82 件逐件终态 + 十一维第八列 + 自证包；程序终态 done-partial，closeout:full 三连 exit 1） |'],
    auditLine: '最后更新：2026-11-11（🏁 **第六轮优化程序 M0–M7 八阶段收口（程序终态 done-partial）**：BLOCK-426～433 单包串行全部收口；70 条发现 + G-01…G-12 共 82 件逐件终态（零 in_progress、零编造计数：done 21 / done-partial 47 / pending_human_eye 2 / external-blocked 3 / pending_user_ruling 3 / W 6）；十一维第八列 8 升 3 平 0 降（不回溯改第七列、非 verified）；长任务自证包（1000 轮 fixture + 三连恢复门 + trace/usage 对账 + 13 条负面边界）。HK-01 逐阶段累计 106 项、5 个专项门、lint 0；gate:post-h9-contracts 186/186 全绿、docs:reconcile 0 issues、docs:check 578。**closeout:full 三连均 exit 1**（第 5 门 test:changed 两红 W 类在制 WIP 拦停），前 4 门 PASS、后 13 门未执行，如实登记不写全绿、不写 PASS 0 SKIP。§8 完成定义第 3/5 条未达证据上限 ⇒ 程序 done-partial；治理 status=completed 仅表示执行完毕。补腿=干净树 + owner 重采 P6 + 9223 离屏实机腿。零新增依赖/零放宽基线/零触碰 WIP/零 stage 零提交/零撤销裁决/零 G1+ 外推。证据=acceptance/m-blueprint-2026-11-11/m7/。串行槽位转空。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    auditRecord: '| ✅ **第六轮 M0–M7 优化程序收口（BLOCK-426～433，程序终态 done-partial）**：八阶段单包串行各有 closeout 读数与六件套回写；82 件逐件终态零 in_progress；十一维第八列复评；长任务自证包；post-h9 契约 186/186、reconcile 0 issues。closeout:full 三连 exit 1 两红 W 归属如实登记，§8 第 3/5 条未达证据上限，不冒充全绿/verified。证据=`acceptance/m-blueprint-2026-11-11/m7/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | M-PROGRAM / DONE-PARTIAL |',
    roadmapAnchor: '最后更新：2026-11-11（🏁 **第六轮 M6=BLOCK-432',
    roadmapLine: '最后更新：2026-11-11（🏁 **第六轮优化程序 M0–M7 八阶段收口（BLOCK-426～433，程序终态 done-partial）**：82 件逐件终态零 in_progress + 十一维第八列 8 升 3 平 0 降 + 长任务自证包 + 六件套回写；post-h9 契约 186/186、reconcile 0 issues、docs:check 578；closeout:full 三连均 exit 1（两红 W 类在制 WIP），§8 第 3/5 条未达证据上限，如实标注不写全绿。串行槽位为空；补腿=干净树 + owner 重采 P6 源绑定 + 9223 离屏实机腿，需用户裁决/owner 收口。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    handoffAnchor: '最后更新：2026-11-11（**第六轮 M6=BLOCK-432',
    handoffLine: '最后更新：2026-11-11（**第六轮 M0–M7 八阶段收口（BLOCK-426～433，程序终态 done-partial）**：串行槽位为空；恢复顺序=AUDIT-LOG → state → 程序台账(docs/m-blueprint-2026-11-11-program.md, completed) → acceptance/m-blueprint-2026-11-11/m7/（gap-ledger / eleven-dimension-col8 / long-task-self-proof / closeout-runs）。未闭合=干净树 closeout:full 三连（两红 W 类，owner 收口后重采 P6）、9223 离屏崩溃恢复实机腿、U/E/V/W 四类（签字槽全空、默认语义未改）、M5 生产接线与 M6-A 结构单源续包。零放宽基线/零触碰 WIP/零 stage 零提交。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    uiNote: '> M7 / BLOCK-433 六件套同批登记（2026-11-11）：总收口为治理/证据批，**零 UI 增量**；台账不新增 UI-### 编号、不改状态词、不重打 debt 棘轮。证据=`acceptance/m-blueprint-2026-11-11/m7/`。G0 开发期常态 · 不外推 packaged/Provider/GA.',
    evidenceDir: 'acceptance/m-blueprint-2026-11-11/m7/',
    auditHeadAnchor: '最后更新：2026-11-11（🏁 **第六轮 M6=BLOCK-432',
  },
  m5a: {
    plan: 'docs/block-434-m5-wiring-closeout-plan.md',
    closeout: [
      "## 收口笔录（2026-11-11 · BLOCK-434 / COMPLETED，4 项 done + 3 项仍 done-partial）",
      "",
      "**交付（判据层 → 生产路径接线，不新增判据）**",
      "",
      "- **W1 `scripts/secret-scan.mjs`**：`catch { continue }` 改为消费 `adjudicateGitGrepResult`——只有 exit 1 且 stderr 空算「无命中」，ENOENT/128/-1/stderr 非空一律 **fail-closed**，`main()` 打印 FAIL 并 exit 1。此前 git 故障会让密钥门静默假绿。",
      "- **W2 `core/petri-server/bootstrap.js`**：`rejectUntrustedOrigin` 挂到 `setupBootstrap`（requestId 之后、业务路由之前）。规则只拦「**真实 http(s) 且不可信**」来源；无 Origin 放行；`Origin:'null'`/file:// 交各路由 token 门裁决。",
      "- **W3 `core/petri-server/helpers/ddl-migrate.js`（新增）+ `routes/ai-memory.js`**：六条迁移 DDL 收口到单一入口，按 `ddlOutcome` 分类 applied / suppressed / failed；failed 用 `redactLog` 脱敏后落 stderr 且不抛；结果经 `module.exports.ddlMigration` 可读。原四处裸 `catch {}` 清零。",
      "- **W4 `src/plugin/zip.js`**：解压失败先清理本函数创建的 destDir 再原样抛错，不再留半成品目录。",
      "",
      "**负测（HK-01 先红后绿）**：`test/m5a-production-wiring.test.mjs` **8/8**，覆盖 5 种 git 故障码、403 三形态（外部站 / 回环非白名单 / 无 Origin 放行）、DDL 三分类、zip 失败清理与不误删。",
      "",
      "**自纠**：W2 初版拦所有非可信 Origin（含字符串 `'null'`），会破坏 BLOCK-67「Origin:null + token → 200」拖出下载语义；改为仅拦真实 http(s) 后，`test/block67-routes.test.mjs` **9/9** 回归通过。",
      "",
      "**门禁实况（不写全绿）**：改动 5 文件 lint **0**；`quality:arch` PASS、`quality:secret` PASS、docs:check 579、docs:reconcile **0 issues**；`test:changed` **1684 tests / 2 fail / 11 skipped**（两红仍为 UI-629 与 P6，均 W 类在制 WIP，接线未引入新红）；`closeout` **exit 1**（第 5 门拦停，前 4 门 PASS、后 13 门未执行）。",
      "",
      "**仍 done-partial（如实登记，不冒充八项全接线）**：M5-3 drag 登记根（需新增 IPC 通道 + preload 包装，触碰契约面与 UI 拖放链路）、M5-2 MCP command 白名单（真实 spawn 点不在 routes/mcp-client.js，需定位 core/mcp 执行链）、M5-4 帧导航 allowlist（落在主进程装配 + 需 9223 离屏实机腿）。逐项补腿条件见 `m5a-evidence.json:stillDonePartial`。",
      "",
      "**范围守住**：零新增依赖 / 零放宽基线 / 零触碰在制 WIP / 零 stage 零提交 / 零撤销既有裁决（`MAX_AGENT_ITERS=Infinity`、`workspace_exec` 默认放行、`Origin:null`+token、主题、中栏）/ 零 G1+ 外推。",
      "",
      "**证据**：`acceptance/m-blueprint-2026-11-11/m5a/`。",
      "",
      "G0 开发期常态 · 不外推 packaged/Provider/GA。",
      "",
    ].join('\n'),
    tableRow: ['| M7 总收口与证据 | BLOCK-433 | P2 | completed（82 件逐件终态 + 十一维第八列 + 自证包；程序终态 done-partial，closeout:full 三连 exit 1） |', '| M7 总收口与证据 | BLOCK-433 | P2 | completed（82 件逐件终态 + 十一维第八列 + 自证包；程序终态 done-partial） |'],
    auditLine: '最后更新：2026-11-11（🏁 **M5-A=BLOCK-434 completed（4 项判据层→生产路径接线 done / 3 项仍 done-partial）**：W1 `scripts/secret-scan.mjs` 的 git grep 故障 fail-closed；W2 全局 Origin 门挂到 `bootstrap`（只拦真实 http(s) 不可信来源，`Origin:null`+token 拖出下载语义 9/9 零破坏）；W3 `ai-memory` 迁移期 DDL 收敛单一入口 `ddl-migrate`（`ddlOutcome` 分类 + `redactLog` + 不阻断启动）；W4 `zip` 解压失败清理半成品目录。HK-01 8/8 先红后绿、改动 5 文件 lint 0、quality:arch/secret PASS、docs:check 579、docs:reconcile 0 issues。test:changed 1684/2 fail 两红仍为 UI-629 与 P6（W 类在制 WIP，接线未引入新红）；closeout exit 1（第 5 门拦停），如实登记不写全绿。仍 done-partial：drag 登记根 / MCP 白名单 / 帧导航 allowlist（补腿条件在册）。证据=acceptance/m-blueprint-2026-11-11/m5a/。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    auditRecord: '| ✅ **BLOCK-434（M5-A · 判据层→生产路径接线收尾）completed（4 项 done / 3 项 done-partial）**：secret-scan 故障 fail-closed、全局 Origin 门、DDL 单一入口、zip 失败清理；HK-01 8/8、lint 0、arch/secret PASS、block67 拖出语义 9/9 回归；drag/MCP/帧导航补腿条件在册。证据=`acceptance/m-blueprint-2026-11-11/m5a/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | BLOCK-434 / COMPLETED |',
    roadmapAnchor: '最后更新：2026-11-11（🏁 **第六轮优化程序 M0–M7 八阶段收口',
    roadmapLine: '最后更新：2026-11-11（🏁 **M5-A=BLOCK-434（判据层→生产路径接线收尾）completed，4 项 done / 3 项 done-partial**：secret-scan git 故障 fail-closed、全局 Origin 门（`Origin:null`+token 语义零破坏）、ai-memory DDL 单一入口、zip 失败清理；HK-01 8/8、lint 0、arch/secret PASS、docs:check 579、reconcile 0 issues；test:changed 1684/2 fail 仍为 W 类两红、closeout exit 1 如实登记。仍 done-partial：drag 登记根 / MCP 白名单 / 帧导航 allowlist。程序 M0–M7 已收口（终态 done-partial），本包为其生产接线补腿，不改变程序终态结论。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    handoffAnchor: '最后更新：2026-11-11（**第六轮 M0–M7 八阶段收口',
    handoffLine: '最后更新：2026-11-11（**M5-A=BLOCK-434 completed（4 项 done / 3 项 done-partial）**：串行槽位转空；证据=acceptance/m-blueprint-2026-11-11/m5a/m5a-evidence.json。判据单源=core/petri-server/agent-tools/security-boundaries.js，接线点=scripts/secret-scan.mjs、core/petri-server/bootstrap.js（rejectUntrustedOrigin）、core/petri-server/helpers/ddl-migrate.js、src/plugin/zip.js。仍 done-partial=drag 登记根（需新 IPC 通道）、MCP 白名单（需定位真实 spawn 链）、帧导航 allowlist（需主进程装配 + 9223 实机腿）。G0 开发期常态 · 不外推 packaged/Provider/GA.）',
    uiNote: '> BLOCK-434 六件套同批登记（2026-11-11）：本包为后端/脚本/主进程接线，**零 UI 增量**；台账不新增 UI-### 编号、不改状态词、不重打 debt 棘轮。证据=`acceptance/m-blueprint-2026-11-11/m5a/`。G0 开发期常态 · 不外推 packaged/Provider/GA.',
    evidenceDir: 'acceptance/m-blueprint-2026-11-11/m5a/',
    auditHeadAnchor: '最后更新：2026-11-11（🏁 **第六轮优化程序 M0–M7 八阶段收口',
  },
};

const STAGE_MAP = new Map(Object.entries(STAGES));
const cfg = STAGE_MAP.get(stage);
if (!cfg) { process.stderr.write('未知阶段（当前仅登记 m2；新阶段须显式补配置）\n'); process.exit(2); }

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const write = (f, s) => fs.writeFileSync(path.join(ROOT, f), s);
const once = (s, anchor, insert) => {
  if (s.includes(insert)) return s;
  if (!s.includes(anchor)) throw new Error(`anchor missing: ${anchor.slice(0, 60)}`);
  return s.replace(anchor, `${insert}\n${anchor}`);
};
const actions = [];

// ① plan 收口段（追加，不覆盖）
let s = read(cfg.plan);
if (!s.includes('## 收口笔录')) { write(cfg.plan, `${s}\n${cfg.closeout}`); actions.push('plan:closeout'); }

// ② 程序台账表格行
s = read('docs/m-blueprint-2026-11-11-program.md');
if (!s.includes(cfg.tableRow[1])) {
  if (!s.includes(cfg.tableRow[0])) throw new Error('program table row missing');
  write('docs/m-blueprint-2026-11-11-program.md', s.replace(cfg.tableRow[0], cfg.tableRow[1]));
  actions.push('program:table');
}

// ③ AUDIT-LOG 头部 + 最近处理记录
s = read('docs/AUDIT-LOG.md');
const headAnchor = cfg.auditHeadAnchor || '最后更新：2026-11-11（🏁 **第六轮 M1=BLOCK-427';
const t = s.includes(cfg.auditLine) ? s : once(s, headAnchor, cfg.auditLine);
if (t !== s) actions.push('AUDIT-LOG:head');
// 最近处理记录需插在标题行**之后**（once 是前插，故单独处理）
let t3 = t;
if (!t.includes(cfg.auditRecord)) {
  t3 = t.replace('## 最近处理记录\n', `## 最近处理记录\n${cfg.auditRecord}\n`);
  actions.push('AUDIT-LOG:record');
}
if (t3 !== s) write('docs/AUDIT-LOG.md', t3);

// ④ roadmap
s = read('docs/next-steps-roadmap.md');
const r = once(s, cfg.roadmapAnchor, cfg.roadmapLine);
if (r !== s) { write('docs/next-steps-roadmap.md', r); actions.push('roadmap'); }

// ⑤ handoff
s = read('docs/project-workspace-handoff.md');
const h = once(s, cfg.handoffAnchor, cfg.handoffLine);
if (h !== s) { write('docs/project-workspace-handoff.md', h); actions.push('handoff'); }

// ⑥ UI 台账零增量登记
s = read('docs/ui-productization-audit.md');
if (!s.includes(cfg.uiNote)) {
  write('docs/ui-productization-audit.md', s.replace('# Petri Desktop UI 产品化审计台账\n', `# Petri Desktop UI 产品化审计台账\n\n${cfg.uiNote}\n`));
  actions.push('ui-audit:zero-increment');
}

process.stdout.write(`[m-writeback] ${block} 六件套回写：${actions.join(', ') || '无新增（幂等）'}\n`);
