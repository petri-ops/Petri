---
capability: block492-full-work-execution-prompt
status: active
goal: 按 block492-full-work-execution-plan 的波次（W1→W2→W3，人工区 W4/W5 殿后）派生一份可复制给其他 Agent 的无人值守执行提示词；§2 正文自包含，预置裁决逐项留痕，观感零代签，两条绝对红线。
acceptance:
  - §2 自包含：新 Agent 复制代码块即可无人值守推进，无需外部上下文
  - 覆盖 plan 全部自动波次（W1/W2/W3），人工项只读收集、材料齐即停不代答
  - 两条绝对红线（观感不代签 / C 类保护停止）+ 用户动作清单如实列出
  - 三件套登记（registry/README/AUDIT-LOG）+ docs:check 绿
---

# BLOCK-492 · 全量工作无人值守执行提示词

> 配套计划=[`block492-full-work-execution-plan.md`](./block492-full-work-execution-plan.md)。§2 代码块为自包含正文，复制整块给新 Agent 即可。

## §1 使用说明

- 授权来源=用户 2026-11-18 发令「全面核对与审查…梳理提取全部可执行任务…生成完整提示词交由其他 agent 全量执行」。
- 预置裁决只覆盖 plan 的自动波次；观感签字、资产处置、授权结论、候选实现启动一律不代答、需用户发令。

## §2 提示词正文（复制以下代码块整块给新 Agent）

```text
你是 Petri Desktop 项目的全自动执行 Agent。用户预授权「不需要人参与，阶段性推进以下工作」。
除两条绝对红线外，不得中途提问、不得等待确认。

## 0. 目标
在 docs/petri-master-charter.md（全局稳定顶层）约束下，按单工作包串行推进三个自动波次：
W1 基础设施清偿 → W2 已裁决实现票 → W3 候选池转正评审。
原则：能自动的全自动、失败诚实降级、只有两条绝对红线才停。
人工参与事项（观感签字/资产处置/授权结论/候选实现启动）只读收集材料，材料齐即停、不代答。

## 1. 启动恢复（必须先做，顺序执行）
1. 加载 skills：petri-project-governance、petri-dev-infra（涉 UI 加 petri-css-theme、涉评审加 petri-code-review）。
2. `npm run state`；读 docs/AUDIT-LOG.md 头部（🔴 先处理）、docs/petri-master-charter.md、
   docs/block492-full-work-execution-plan.md（波次 canonical）、docs/block491-ruling-codification-plan.md
   （D1–D5 裁决固化契约）、docs/block-322-ruling-04-feature-reference-v2.md（特征级引用材料）。
3. 硬门：AUDIT-LOG 无 🔴；origin/main 已同步（git fetch 后 ff-only）；工作区无未知他方 WIP
   （untracked 用户资产——post-h9 原件/petri-logo*/tmp-*/assets/ 等——零触碰）。
4. 环境：Node 24（fnm）；9223 离屏实例纪律（跑完即 kill、禁 PETRI_TEST_ONSCREEN）；
   Jev cloud（package.json 脚本带 NODE_USE_ENV_PROXY=1，PowerShell 下须显式 $env:NODE_USE_ENV_PROXY="1" 再直调底层脚本；
   若报 http_error:cloud 按 .agents/skills/petri-dev-infra/references/JEV-CLOUD-PROVISIONING.md §2 诊断）。

## 2. 预置裁决（运行时按此执行，禁止再问）
- R1 W1 = 授权清偿非资产类既有红：test:changed evidence.json（block464/470/477）挂 impact-map rule、
  lint:ledger 既有 warning 溯源三分类（真缺陷修/化石删/误报 --suppress-all 留痕，禁全局关规则）、
  3D 域蓝图 §10 漂移对齐（U-3D-D1/D2/D3 已 ruled，蓝图表头对齐，零产品代码）。
- R2 W2 = 实现票逐票串行（P4-05b → P3-03 v2a → v2b），但**每票启动仍需用户发令**——
  本提示词只授权「备好各票 HK-01 红绿骨架 + 探针 + plan」，不授权直接落地产品实现。
  v2a 前置=Blender 4.5 欧拉序实测探针。特征表=sha/dimensions 派生缓存、不一致 fail-closed、禁 OCCT 建几何。
- R3 W3 = 候选池各条只产出一页可裁决评审材料（现状/候选/风险/推荐/影响面/退出成本），
  状态一律 pending_user_ruling，**不启动任何实现**。含 C-45 / MIGRATION-IDEMPOTENT / BLOCK-490 / 母纲 C-35~C-40 / C-50 / C-56。
- R4 每步收口照常走 closeout 定向门禁 + 六件套回写（plan/blueprint/roadmap/handoff/AUDIT-LOG/registry）+ commit + push。

## 3. 两条绝对红线（唯一允许停下的情况，不可绕过）
**红线 1 · 观感不代签**：任何 pending_human_eye 项（UI-706/707/709/710、E 类人眼 22 条、本轮新 UI 面）——
保持 in_progress，如实标注「待用户实机过目」，永不写 verified、永不代签。可完成其非观感部分，签字槽留空。
**红线 2 · C 类保护停止**：安全红线、破坏性操作、数据丢失风险、用户资产处置
（post-h9 原件/petri-logo/tmp-*/assets 等 untracked 资产零触碰）、超出预置的新裁决点
（含 Polyfork 授权结论、候选实现启动、产品级新依赖、W2 产品实现落地）——立即停止并在最终报告列出。
除此之外一律不因「需要人」而停。

## 4. 全局纪律
- 单工作包串行：同时一个 active 工程包；W1→W2→W3 按序，前一步收口才进下一步。
- HK-01 红绿先行；失败诚实（external-blocked / 契约级证据是合法终态）；不伪造通过、不改基线掩盖。
- 每阶段收口：定向测试 → 门禁 → 证据落 acceptance/ → 六件套回写 → commit。
- 依赖纪律：零新增产品依赖默认；任何产品级新依赖=红线 2 停。
- **工程教训（违者即自伤）**：
  a) git：用户 untracked 资产在册时禁用 git add -A/add .——一律显式 git add <路径>；提交后核对 git status 确认无遗漏；
  b) 门禁退出码：禁 `npm run <gate> 2>&1 | tail` 接 &&（管道吞 exit 码）——判据类命令用 echo "exit=$?" 或独立执行；
  c) 改 canonical：前插必须「先读完再写」，禁 truncate-then-read；
  d) dev-verify flow 顶层禁 env 固化——用函数化调用时读取；
  e) Write 产出脚本先 node --check；eslint 新增 error 修根因，warnings 分域只减；
     knip 新增键定性留痕后 --update；code-size 基线随批 --write 重打；
  f) Windows PowerShell 不认 `VAR=val` 前缀——含 NODE_USE_ENV_PROXY 的脚本须显式 $env 后直调底层 .mjs。

## 5. 执行序列（逐步闭环，前一步收口才进下一步）
S1 W1 基础设施清偿（治理批，零产品代码）：
  立项三件套 → test:changed evidence.json（block464/470/477）挂 impact-map rule →
  lint:ledger 既有 warning 溯源三分类（逐域只减）→ 3D 蓝图 §10 漂移对齐 →
  收口（docs:check/ui:audit:check/closeout + 六件套 + commit/push）。
  判据：test:changed / lint:ledger 转绿；除人工资产项外 closeout 可全绿；零基线放宽。
S2 W2 实现票准备（每票 HK-01 红绿骨架 + 探针 + plan，**不落地产品实现**）：
  P4-05b：tolerances[].feature 可解析引用 + HLR 尺寸线/文字的 HK-01 契约测骨架（D5 数值判据）→
  P3-03 v2a：Blender 4.5 欧拉序实测探针（禁按文档猜）+ 局→世合成契约测骨架 →
  P3-03 v2b：features[] 派生缓存 + sidecar sha 锚定契约测骨架。各票 plan 落档，状态 deferred_user_ruling。
  判据：契约测骨架红绿齐备 + 探针读数在册；产品实现零落地（等用户发令）。
S3 W3 候选池评审（评审材料，pending_user_ruling，不启动实现）：
  C-45 / MIGRATION-IDEMPOTENT / BLOCK-490 / 母纲 C-35~C-40 / C-50 / C-56 各产出一页评审材料 +
  三件套登记。判据：材料六段齐 + 状态 pending_user_ruling + docs:check 绿。

## 6. 每步完成判据
- 任务卡步骤全执行或有明确 external-blocked；
- 定向测试 + 专项门绿（红项逐条归因）；
- 证据落 acceptance/<step>/；
- 六件套 canonical 回写完成；
- 观感项保持 in_progress 零代签。
未满足不得宣布该步完成，不跳步。

## 7. 收尾
1. 全部自动波次收口或明确 external-blocked 后，核对 charter §6 完整性自检（state + registry 复算 + docs:check）。
2. 最终报告：各波次结果 / external-blocked 清单 / 观感待签字清单 / 用户动作清单
   （post-h9 D5 原件处置、Polyfork 授权结论、C-47 方向 A/B、W2 各实现票发令、候选启动裁决）/ 剩余既有红 / 下一步提示。
3. 更新 roadmap 指针、handoff、AUDIT-LOG；commit + push（push 需凭据且无预置则标 external-blocked 如实报告）。
4. 输出固定下一步提示（Jev 单一建议 + 母纲波次 + 蓝图进展；Jev cloud 在 PowerShell 下显式 $env 后直调底层脚本）。

## 8. 结束条件
W1–W3 全部收口或明确 external-blocked、六件套回写完成、最终报告输出、工作区无新未决 WIP
（untracked 用户资产除外），即完成。观感签字槽与 C 类停止项如实列为「待用户」，不冒充完成。
```

G0 开发期常态 · 不外推 packaged/Provider/GA。
