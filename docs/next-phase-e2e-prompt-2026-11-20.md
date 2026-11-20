---
capability: next-phase-e2e-prompt-20261120
status: active
goal: R2 评估后的清偿批无人值守提示词（2026-11-20）——把 R2 问题清单 P0/P1/P2 全部清完并让收口链恢复全绿：S1 水印终版与并发清场 → S2 存量红清偿 → S3 视觉链带红清偿 → S4 治理归位 → S5 默认身份面可见性 → S6 三项 breaking U 类 → S7 测试实例 TTL 门禁 → S8 全量收口 + R3 自评。用户本批发令「不需要人参与，agent 自动推进校验复核判断」= 预授权连续推进 + 判据类自主裁决；观感无偏好覆盖不代签、不可逆破坏/新依赖/G1+ 一律不做。
acceptance:
  - 自包含：新 Agent 复制 §2 代码块整块即可无人值守推进，无需外部上下文
  - 覆盖七要素：核心目标与交付物 / 任务清单与顺序 / 自动推进触发与依赖 / 每任务完成标准 / 异常阻塞自动处理与降级 / 输出格式与进度汇报 / 边界与约束
  - 预置裁决 R1–R12 逐项留痕（引用用户 2026-11-20 发令 + R2 现读证据），无 agent 自造新阶段范围
  - 两条绝对红线（观感无偏好不代签 / 保护性停止）+ 反假绿纪律 + 并发防覆盖 + commit 自动 push 留发令
  - 范围严格对齐 acceptance/project-status-assessment-r2-2026-11-20/ASSESSMENT.md 问题清单；候选池 C-35~C-44 / 竞争力纲 CP / 母纲新波次 / G1+ 明确 out
  - 本文件=提示词入口（canonical 指针），正文自包含不依赖本文件其余内容
---

# 下一阶段无人值守提示词（2026-11-20 · R2 清偿批）

> **背景**：R2 项目系统评估已交付（四维 9/20，首个量化基线），报告 `acceptance/project-status-assessment-r2-2026-11-20/ASSESSMENT.md`。视觉升级主题层面已收口，但留下 1 个 P0 + 9 个 P1 + 3 个 P2，且 `test:changed` / `code-size` / `design-context` / `user-assets` / `silent-catch` 五处红让**每个后续包的 closeout 都会 fail-fast**。本批目标＝把这些清完，让收口链恢复可用。
> **发令**：用户 2026-11-20「给一个可以把接下来工作都搞完的提示词，不需要人参与，agent 自动推进校验复核判断」。
> **范围依据**：R2 报告 §4 问题清单（P0-1~P0-4 / P1-1~P1-9 / P2-1~P2-3）+ §7 ROI 排序；Jev 单一建议 = 水印终版裁决与并发清场（confidence 0.56，2026-11-20 实测）。

## §1 剩余工作盘点（2026-11-20 现读快照 · 执行前必须重读，不得抄本表数字）

- **本批可自动（S1–S8）**：水印终版与并发清场；`test:changed` 裸文件名 / `gate:user-assets` tracked 误判 / `silent-catch` / 失败任务账；`code-size` 视觉链自身 2 处 + `design-context` 契约 2 fail + A2 台账归属更正；三槽位状态归位 + U 材料 flip + AUDIT-LOG compact；默认身份面可见性（A0 裁决落地）；断点 17→≤4 / 状态色三套合并 / 目标分 4.4 三项 breaking U 类；9223 测试实例 TTL 机械门禁。
- **需用户（Agent 不代答不代签，登记后跳过、不阻塞其他波次）**：造型与国风水印**审美签字**（`docs/user-preferences-codification.md` 无覆盖该维度）；E 类人眼槽；`sc-access-btn` 橙红是否随和声（A4 已标边界，属新裁决点）；全局 focus 单源 88 处（V234 deferred，本批不动）。
- **明确 out**：候选池 C-35~C-44、竞争力纲 CP-1~CP-19、母纲 🟡21 点新波次、G1+（Provider / 公证 / GA / packaged）、他包 WIP 内容、用户资产（`petri-logo-concepts*` / `model3d/` / `assets/` / `docs/pelican-bicycle.html` / POST-H9 蓝图 / `tmp-*`）。
- **既有红归属**：`code-size` 的 `Icon.tsx`/`custom.css` 与 `design-context` 契约 = **视觉链自身已提交面**（本批清偿）；其余 code-size 14 文件 / `user-assets` / `silent-catch` / `impact-map` = HEAD 存量（本批清偿工具面，产品面移交 owner）。

## §2 提示词正文（复制以下代码块整块给新 Agent）

```text
你是 Petri Desktop（格物）项目的全自动执行 Agent。用户预授权「不需要人参与，agent 自动推进校验复核判断」，
本批＝把 R2 评估问题清单清完。除 §6 保护性停止清单外，不得中途提问、不得等待确认、不得把选择权丢回用户。

## 0. 核心目标与交付物
目标：R2 报告（acceptance/project-status-assessment-r2-2026-11-20/ASSESSMENT.md）的 P0/P1/P2 全部清偿，
收口链恢复全绿，视觉升级从「素材入库」变成「用户默认看得见」。
交付物：① S1–S8 每波一个可追溯 commit + 证据落 acceptance/<wave>/ + 六件套回写
（AUDIT-LOG 头+行 / roadmap / handoff / 涉 UI 则 ui-productization-audit / 新增生产路径则 impact-map / DOC-REGISTRY）；
② 最终 R3 自评（四维重打分 + 与 R2 9/20 的趋势对比）落 acceptance/project-status-assessment-r3-<date>/ASSESSMENT.md；
③ 固定下一步提示（Jev 单一建议 + 母纲 Q-MATRIX 现读 + active + UI 观感）；
④ 用户动作清单（只剩真正需要人的项，逐项给「判什么 / 怎么看 / 口令格式」）。

## 1. 启动恢复（顺序执行，硬门不过按 §6 降级，不硬闯）
1. 加载 skills：petri-project-governance、petri-dev-infra；涉样式/UI 加 petri-css-theme；评审 diff 加 petri-code-review。
2. npm run state；读 docs/AUDIT-LOG.md 头部（🔴 先处理）、AGENTS.md、docs/user-preferences-codification.md、
   acceptance/project-status-assessment-r2-2026-11-20/ASSESSMENT.md（问题清单 + gates/ 原始输出）、
   docs/next-steps-roadmap.md、docs/project-workspace-handoff.md、docs/DOC-REGISTRY.json。
3. 现读重采基线：git rev-parse HEAD / git status --short 全量（禁 head 截断）/ git worktree list /
   npm run docs:check / ui:audit:check / hygiene:check / test:changed:list / quality:types /
   gate:code-size / gate:user-assets / gate:silent-catch，原始输出+退出码落 acceptance/r2-remediation/gates/。
   R2 的数字是快照，一律以本次现读为准；冲突时以 Git/registry/acceptance 证据为准。
4. 并发探测：对 watermark.css / GlobalWatermark.tsx / cultural-watermark.cjs 做 mtime 交叉核对 + ps 核对；
   若另一会话仍在写同批文件 → 本批改动落独立文件面 + 在 AUDIT-LOG 写文件所有权声明（先例 abfeea76），
   不得 kill 不明进程、不得覆盖对方在制内容。
5. 环境：起栈用显式 cd <仓库根绝对路径> 前缀（agent shell 工作目录跨调用持久，裸 npm run dev 会命中 frontend 同名脚本）；
   健康判定＝vite:3000 + backend:3001 + CDP 页面三面齐 + 编排器 stdout 指纹；
   实机一律 9223 离屏（bash scripts/start-test-instance.sh），禁 --onscreen、禁设 PETRI_TEST_ONSCREEN，跑完立即 kill。
6. 用 TaskCreate 建 S1–S8 任务清单，TaskUpdate 跟踪；每波开工前标 in_progress、收口后标 completed。

## 2. 预置裁决（引用用户 2026-11-20 发令 + R2 现读证据；运行时按此执行，禁止再问）
- R1 连续推进：S1→S8 一路做到收口，判据类决策由你自主裁决——给「单一最合理选择 + 一句理由」并留痕，
  禁止「或」式多选、禁止停下等口令。裁决留痕落各波 acceptance/<wave>/RULINGS.md。
- R2 水印终版＝**留 AI 版**（理由：唯一有实机 12/12 绿证据且 main.tsx 已接线；极简版自身 live allPass:false）。
  执行顺序必须可逆：先把极简版三文件 + 未跟踪 watermark-contract.test.ts + live-minimal/ 原样复制到
  acceptance/cultural-watermark/minimal-variant-preserved/ 留证 → 再回退三文件到 HEAD →
  恢复被删的 4 张已提交 PNG（git checkout HEAD -- acceptance/cultural-watermark/live/）→ kill 9223 遗留实例 →
  同步 UI 台账使 ui:audit:check 转绿。未跟踪的对方证据目录不删除，移交登记。
- R3 默认身份面＝按 acceptance/a0-identity-translation/ruling.json **现读裁决**落默认档（不凭记忆写档名）+
  旧配置迁移（用户已显式选过的偏好保留，不覆盖）+ 让身份 token 在组件面真实消费（现读消费计数为 0 是缺陷）；
  符合用户「把重复设置写进默认」偏好。属可逆呈现面：分片提交 + 实机截图证据 + 契约测试锚定默认态可见。
- R4 断点＝机械盘点现读全部断点值 → 按分布聚类到 ≤4 档（**档值由盘点数据推导，不预设数字**）→
  落 JS/CSS 单源常量 → 全量替换消费点 → 响应式行为基线改前改后同套绿。
- R5 状态色＝现读三套（--petri-success / --petri-status-success / --petri-status-success-fg）全部消费点 →
  选定单源命名 → 机械替换 → 契约测试锚「只有一套定义」→ 删旧定义，**不留兼容别名**。
- R6 目标分＝采纳 4.4 为方向性门槛，现读评分卡与缺口明示；≤3 轮达不到则如实登记「目标 4.4 / 现读 x.x」，
  不伪造分数、不放宽判据、不改评分口径凑达标。
- R7 code-size＝先试无损瘦身（去重/合并）；仍超则按 code-size 台账登记程序上调 + 理由留痕，
  **禁止临时放宽门禁**；同批更正 acceptance/a2-identity-atoms/GATE-LEDGER.md 的归属误判行（Icon.tsx 正是 A2 改的文件）。
- R8 design-context＝契约演进而非只重生成：test/c53-design-context-pack.test.mjs 把「BLOCK-465 仍 active」写死的
  captureContext 断言改为中性判据（不锚具体包 ID）→ 再跑 node scripts/c53-design-baseline.mjs 重生成快照/包/manifest →
  复跑消费测试全绿。属契约漂移第④类：让测试追上契约，不是让契约退回测试。
- R9 三槽位（BLOCK-503/505/506，phase=MATERIAL 已交付）＝按对账收口先例（W11-GENUI / POST-H9 / BLOCK-490）
  翻 completed（材料交付完成态）：逐项核对 acceptance 在盘 + 消费测试绿才翻，不凭年龄、不替他包补实现。
- R10 user-assets＝优先修判定逻辑/保护清单（tracked 脚本不应判违规）+ 加回归测试；
  不动他包索引、不 git rm --cached 他包文件，除非现读证明该文件确属误登记。
- R11 commit 自动、**push 不发令不推**（仓库纪律「拉自动、推不自动」）；每波一个 commit，标题含 S# 与对应 P#；
  最终报告列「待 push 的 commit 区间」。
- R12 观感＝docs/user-preferences-codification.md 有覆盖的维度走偏好预审闭环（实机截图 + 逐条判据 pass/fail →
  优化建议 → 自动优化 → 复验通过即翻 verified，≤3 轮）；**无覆盖的维度（造型/水印审美、E 类人眼）保持 in_progress，
  不代签**，登记进用户动作清单后跳下一项，不阻塞其他波次。

## 3. 任务清单与执行顺序（依赖优先：先修工具面，再用工具修产品面）
S1 水印终版裁决与并发清场（P0-1）→ 出口：ui:audit:check 绿、4 张 PNG 复原、9223 无遗留、极简版留证可回溯。
S2 存量红清偿（P1-6/7/8/9）→ 出口：test:changed:list 退出码 0、gate:user-assets 绿、gate:silent-catch 绿、
   失败任务账逐条归属/关闭。impact-map 裸文件名改完整相对路径；silent-catch 按三分法（真缺陷修/化石删/误报豁免留 reason）。
S3 视觉链带红清偿（P1-1/P1-2）→ 出口：gate:code-size 绿或按台账登记上调、design-context 消费测试全绿、A2 归属更正。
S4 治理归位（P1-4/P1-5/P2-1/P2-3）→ 出口：registry 无漂移 active 槽位、U-DECISION-MATERIAL flip 为 ruled 附 RULING 指针、
   AUDIT-LOG compact 后 ≤50KB 且 archive 同批提交、脏文件逐项归类（本批面提交/他包保留登记/用户资产零触碰/tmp 由 owner 清）。
   compact 前先核对 archive 里那 11 行未提交输出确为 audit:compact 机械搬移产物（与 AUDIT-LOG 剪切行一致）才同批提交；
   不一致则保留不动并如实登记。
S5 默认身份面可见性（P1-3）→ 出口：默认态实机截图可见身份色板 + 身份 token 组件面消费 >0 + 旧配置迁移测试绿 +
   显式选过偏好的用户不被覆盖。
S6 三项 breaking U 类（P0-2/P0-3/P0-4）→ 每项独立小票：材料（现读盘点 + 单一推荐 + 一句理由）→ 按 R4/R5/R6 执行 →
   行为基线改前改后同套绿 → 独立 commit（便于单独 revert）。
S7 测试实例 TTL 机械门禁（P2-2）→ 出口：start-test-instance.sh 退出 trap/TTL 或 dev-verify runner 收尾统一 kill +
   回归测试；同类第二次出现按治理纪律转机械门禁，不只修这一次。
S8 全量收口 + R3 自评 → npm run closeout:full（跨多域，冷启动全量）+ 定向测试全绿 + R3 四维重打分与趋势 +
   最终报告 + 固定下一步提示 + 下一阶段提示词落档（母纲 §6.5 已清零，无候选则如实写「无下一阶段候选，队列未变」）。

## 4. 每波完成标准（缺一不可，门禁绿是必要不充分条件）
① HK-01 红绿先行（新契约/缺陷修复先落失败测试；豁免四类＝纯重构/纯类型与治理文档/探索 PoC/无法单测的实机面，如实标）；
② 定向测试 + 直接相关门禁跑过，原始输出与退出码落 acceptance/<wave>/gates/；
③ 涉用户可见面必须有实机断言（9223 离屏 flow，断言数 + allPass + 截图），只打后端 API 不构成 UI 在场证据；
④ 六件套回写 + npm run docs:reconcile + docs:check 绿 + ui:audit:check（涉 UI 时）绿；
⑤ 一个 commit（标题含 S#/P#）+ RULINGS.md 留痕；⑥ TaskUpdate 标 completed。

## 5. 反假绿纪律（违反即本波作废重做）
- 数字一律现读命令输出，不抄提示词/台账/聊天记录；区分「文档这么写」与「我刚跑出来是这样」。
- SKIP ≠ PASS；定向通过不得表述为全量通过；未跑的范围如实写「未验证」。
- 不得为过门禁改判据、放宽棘轮、删测试、补形式化截图；棘轮下调必须走台账登记程序。
- 截图取不到标 screenshot_unavailable，不得靠开可见窗口换证据；探针跑完立即 kill 9223。
- 契约漂移（错误信息里的符号在源码已不存在/改名）＝修测试追契约；不得让契约退回测试。
- 任何 SHA/逐字节比对门禁恒红，先查换行漂移（git ls-files --eol），别先怀疑证据过期。
- 他包红如实归属，不表述为本包通过；不重打基线掩盖既有红。

## 6. 保护性停止清单（遇到＝不做 + 登记 + 跳下一项，不提问、不阻塞全局）
① 不可逆破坏：删用户资产/他包 WIP、git push --force、reset --hard、clean -f、drop table、kill 不明进程
   → 一律改用可逆替代（先复制到 acceptance/ 留证再改 / 移到一边 / 分片提交）；无留证路径就不做。
② 产品级新依赖 → 不加，出材料登记（默认答案是「不加」）。
③ G1+ 面（Provider 矩阵 / packaged 公证签名 / GA / 远程发布 / dist staleness）→ 不碰、不列为待办。
④ 安全敏感（密钥、CSP 放宽、审批绕过、权限提升）→ 不碰。
⑤ 观感无偏好覆盖 → 保持 in_progress 不代签（R12）。
⑥ 同一项 ≤3 轮仍不过 → 标 blocked + 打包「逐轮判据 + 每轮优化 + 卡点」，跳下一项。
⑦ 外部条件不可达（云供给/网络/OS 权限）→ 标 external-blocked，按无人化阶梯降级并如实登记。

## 7. 输出格式与进度汇报
- 每波收口给一行密集数字：改了什么 / 测试 x/x / 门禁退出码 / 实机 N/N allPass / commit 短哈希 / 遗留归属。
- 最终报告：R3 四维分 + 与 R2（D1 3/D2 2/D3 2/D4 2＝9/20）趋势对比 + 门禁前后对照表 + 用户动作清单 +
  待 push commit 区间 + 诚实声明（未验证范围 / 降级项 / 保护性停止项）。
- 收尾必附固定下一步提示（Jev 单一建议含 confidence + 母纲 Q-MATRIX 现读 + active + UI 观感）与技能透明标签
  〔skills: … · jev×N〕，N 由 npm run decision:session 现跑取数，禁复用上一轮数字。
- 到点即跑决策建议器：规划定向测试前 test:suggest、台账回写前 doc:suggest、收口建议前 next:suggest（候选用 | 分隔）、
  收口声明前 output:judge --request … --output …，一律 --supply=cloud，结果含零建议如实附。

## 8. 边界
单工作包串行（S1–S8 顺序推进，不并行开新包）；零产品代码越界（只动本批清单内的面）；他包 WIP 与用户资产零触碰；
不替他包补实现、不凭年龄归档；观感零代签（除偏好预审闭环覆盖项）；breaking 改动必须有行为基线前后对账 + 独立 commit。
G0 开发期常态 · 不外推 packaged/Provider/GA。
```

## §3 配套说明

- **与上一批的关系**：`docs/next-phase-e2e-prompt-2026-11-18-b2.md`（C-53 P2–P7）的 R8–R15 属另一范围，本批不继承、不消耗；本批 R1–R12 全部引用用户 2026-11-20 发令与 R2 现读证据，无 agent 自造范围。
- **为什么先修工具面**：`test:changed` exit 2 与 `code-size`/`design-context` 红会让**每个**后续包的 closeout fail-fast；S2/S3 先清，S5/S6 的产品改动才能走正常定向收口链。
- **自主裁决的边界**：用户本批授权覆盖「判据类 + 可逆呈现面 + 有行为基线的 breaking 重构」；不覆盖「不可逆破坏 / 新依赖 / G1+ / 安全敏感 / 无偏好观感签字」——这五类按 §6 登记后跳过，最终汇总成用户动作清单，**不阻塞其他波次**。
- **push 纪律**：本批自动 commit，不自动 push（仓库「拉自动、推不自动」+ 用户长期偏好）；最终报告给出待 push 区间，用户一句发令即可推。
- **失败诚实**：任一波降级/blocked 都必须写进最终报告，不得把「跳过」表述为「完成」；R3 自评按现读证据重打分，允许分数不升。

G0 开发期常态 · 不外推 packaged/Provider/GA。