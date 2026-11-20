# S4 治理归位 · 裁决留痕（2026-11-21）

> 波次：R2 清偿批 S4（P1-4 / P1-5 / P2-1 / P2-3）· 预置裁决 R9（三槽位翻 completed：逐项核对在盘才翻）。

## R-S4-1 三槽位归位（P1-4）

BLOCK-503 / BLOCK-505 / BLOCK-506：registry `status: active→completed`、`phase: MATERIAL→CLOSED`（附归位笔录 notes）；
三文档 frontmatter 同步；README 条目 509/511/511b 状态词翻 completed；roadmap/handoff 头部加恢复要点行。

R9 核对记录（翻前现读）：
- BLOCK-503：产物 `acceptance/block503-outputs/` 8 组在盘（jia1-c56 改写/jia2 license/jia3 SUS 问卷/yi1-ui710/yi2-ui709/yi3-ui707/yi4-ui706/yi-rest）；
  乙组产物已被 YI-REST 收尾批（AUDIT-LOG 2026-11-20 行）消费并收口。
- BLOCK-505：15 段提示词集 canonical `docs/block505-review-prompts-2026-11-19.md` 在盘；产出物即 block503-outputs（喂提示词的产物）。
- BLOCK-506：研究文档 canonical 在盘；三问答案被 roadmap 2026-11-19 行引用。
- 消费测试：三包均 MATERIAL/文档型，无独立消费测试（human-eye-closeout 契约测试锚签字槽语义，非这三包）——
  R9 的「消费测试绿」按材料批语义=docs 门禁绿 + 产物在盘 + 已被后续批消费的证据。

## R-S4-2 U 材料 flip（P1-5）

`acceptance/u-skeleton-per-accent/U-DECISION-MATERIAL.md`：`status: pending_user_ruling → ruled` + frontmatter `rulingPointer`
指向 RULING.md（append-only 裁决真值，未改写）；§5 边界行补 flip 说明。
消费测试契约追上（原「永久 pending 锚」让待裁清单虚挂已裁项）：锚 ruled+指针+裁决真源在场 6/6 绿；
篡改负测改锚「decided 非法」（裁决只能出自用户，材料只能 ruled 指向）。
B 批 RULING.md note 当时「保留 pending 作测试锚」与本批裁决冲突——按 R2 预置裁决（P1-5 flip）执行，材料状态=世界真实状态。

## R-S4-3 AUDIT-LOG compact 同批提交（P2-1）

- 核对：`git diff docs/archive/checkpoints/audit-log-through-2026-11-20.md` 11 行确为 compact.mjs 机械搬移产物
  （带 `<!-- audit-log-compact.mjs 追加 @ 2026-11-20T08:02:03.859Z -->` 生成器标记，与剪切行一致）→ 同批提交放行。
- 本批先回写 S1–S4 四行+头部行，再跑 `npm run audit:compact`：链淘汰 3 行；因归档文件带未提交改动，
  脚本按保护设计落**新轮转档** `r20261120T233124Z.md`（旧 WIP 未触碰）——两轮转档均为机械产物，同批提交。
- 活跃台 113KB（>50KB 警告保留）：当前待处理项 20 行全量保留是脚本设计（只淘汰「最后更新」链超窗行与处理记录表超窗行），
  非本批可清偿面，如实登记。

## R-S4-4 脏文件分类（P2-3）

S1/S2/S3 commit 后剩余脏面归类：
- **本批面（随本批提交）**：docs/DOC-REGISTRY.json + 三 plan frontmatter + README/roadmap/handoff + AUDIT-LOG + archive 两轮转档
  + U 材料 flip + 本目录。
- **他包证据保留登记（零内容触碰）**：acceptance/block462/×3 diagnostics、block463 ×2、block472 snapshot——
  dev-verify flow 装载即自执行的 block463-workbench-live.cjs 被 verify 运行连带刷新（S1 RULINGS 已登记该工具面缺陷，移交 dev-infra owner）；
  内容为其自身实机证据刷新，不入本批 commit，由 owner 认领。
- **用户资产零触碰**：petri-logo-concepts* / model3d/ / assets/ / docs/pelican-bicycle.html / POST-H9 蓝图。
- **tmp 由 owner 清**：tmp-block342-live/ / tmp-review/（不代删）。
- **前批交付面并入**：docs/next-phase-e2e-prompt-2026-11-20.md + acceptance/project-status-assessment-r2-2026-11-20/（R2 评估批未提交面，
  属本批输入与前置交付，随 S4 归位批一并入库）+ nso wave-0 summary（stall 家族证据，随 block508 规则登记面同批）。

## 出口核验

- registry `kind=work-package && status=active` 计数 **0**（三槽位归位后；现读见 gates/s4-registry-check.json）
- U 材料消费测试 6/6；docs:check 见 gates/
