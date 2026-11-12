---
capability: m-blueprint-2026-11-11-program
status: completed
goal: 承载第六轮 M 波次 M0-M7 的程序状态与阶段台账，作为 living-plan 不占单包串行槽位，并指向 acceptance 下唯一审计输入
acceptance:
  - 阶段与串行槽位、裁决来源、红线、WIP 边界逐项留痕
  - 程序状态与 acceptance 审计输入职责分离，不建第二份发现清单
  - 收口时状态由 active 转 completed 并与 registry 一致
reopen: 用户裁决或阶段终态变化后先复核本台账与 registry 再推进
---

# 第六轮优化程序 M0–M7 · 程序台账（living-plan）

> 本文件是 M 波次的**程序状态台账**，不是审计输入。唯一审计输入 =
> `acceptance/m-blueprint-2026-11-11/FULL-AUDIT-AND-BLUEPRINT.md`（§2 七十条发现 M-01…M-70 / §3 差距 G-01…G-12 / §4 阶段 / §6 验收）
> 与 `acceptance/m-blueprint-2026-11-11/EXECUTION-PROMPT.md`。两者位于 `acceptance/`（非 `docs/` managedRoot），
> 按 `docs/DOC-REGISTRY.json` 的 `PATH_INVALID` 契约不能直接注册为 canonical 文档，故由本台账承载程序状态并指向原件。
> 原件属会话起始未跟踪 WIP，全程零触碰、零改写。

## 裁决来源（预授权连续工作模式）

用户 2026-11-11 裁决原话：「依据蓝图独立完成全部优化任务，无需用户额外参与；工程判断全部下放给你并逐项留痕」，
「现在开始：先执行第 1 节恢复顺序与第 4 节第 1 步，然后按 M0 发令开工，逐阶段推进到 M7，全程不再向用户提问」。
按 `$petri-dev-infra`「预授权连续工作模式」视为有效裁决；不豁免任何治理红线。

## 阶段与串行槽位

| 阶段 | BLOCK | 主线 | 状态 |
| --- | --- | --- | --- |
| M0 判据校准与可信起点 | BLOCK-426 | 修尺子，零产品行为变化 | completed（带 W/V 类红归属，closeout exit 1 如实登记） |
| M1 长任务内核（状态机/边界族/verifier） | BLOCK-427 | P0 主线 | completed（内核三件套 + 18/18 负测；主循环接线 done-partial 归 M6-A） |
| M2 崩溃续跑 / 任务图 / 幂等 | BLOCK-428 | P0 主线 | completed（五项能力 + 14/14 负测；DB 约束与 9223 实机腿 external-blocked） |
| M3 上下文与工具能力面 | BLOCK-429 | P1 | completed（六项能力 + 18/18 负测；生成器改造 done-partial 归 M6-A） |
| M4 评测与可观测 | BLOCK-430 | P1 | completed（1000 轮 fixture + 14/14 负测；evals run / perf 扩面 / SSE 实机 external-blocked 或 W） |
| M5 安全与正确性纵深 | BLOCK-431 | P0/P1 | completed（8 类判据 + 15/15 负测；生产接线 done-partial 归 M6-A/M6-C） |
| M6 工程债务与体验 A–F | BLOCK-432 | P2 | completed（六组只读视图 + 9/9 负测；终态均 done-partial / W / U / E，零改写基线） |
| M7 总收口与证据 | BLOCK-433 | P2 | completed（82 件逐件终态 + 十一维第八列 + 自证包；程序终态 done-partial） |
| M5-A 判据→生产接线收尾 | BLOCK-434 | P0/P1 | completed（4 项 done：secret-scan fail-closed / 全局 Origin 门 / DDL 单一入口 / zip 失败清理；3 项仍 done-partial） |

同一时间只有一个 active work-package 与一个进行中阶段；阶段收口后才发令下一阶段。
常驻 living-plan `G0-LF` 属层 2，不占串行槽位；本台账同为层 2。
M0 收口后串行槽位为空，M1 发令时登记新的 active work-package（BLOCK-427）。
**M7 收口（2026-11-11）**：八阶段 BLOCK-426～433 全部按单包串行收口，串行槽位为空；
`status: completed` 仅表示治理生命周期执行完毕，**程序验收终态 = `done-partial`**——
`closeout:full` 三连均 exit 1（第 5 门 W 类红拦停），§8 完成定义第 3/5 条未达证据上限，
不写「全绿 / verified / PASS 0 SKIP」。详见 `acceptance/m-blueprint-2026-11-11/m7/m7-evidence.json`。

## 红线（逐阶段适用）

- G0 长期开发期：不外推 packaged/Provider/GA，不把 `qualificationEligible:false` / Result Studio / RS-P7 / i18n / 签名写成待办。
- `MAX_AGENT_ITERS=Infinity` 是产品契约（goal-terminated, not round-terminated）；M1 补状态机与边界族，不加步数上限。
- `workspace_exec` 默认放行（2026-11-05 S2 裁决）只补补偿控制；ADMISSION / FK / MCP 计量 / 主题 / 中栏裁决保持。
- 不照搬 ZCode 三类云端耦合；只取「单一真相源 + command inbox 串行 admission + 幂等边界」。
- 零新增依赖；WIP 零触碰（见下）；零放宽基线；零 stage / 零提交；TS strict；渲染层 IPC 必经 `desktopBridge.ts`。
- 证据五类不互冒充；未跑/跳过/复用/在制红如实标注；exit 124/125 = unknown，不是成功；绝不写「全绿 / verified」。
- 实机：不开可见窗口；:3000 vite + :3001 后端无窗栈；UI 腿只在 9223 离屏跑，禁设 `PETRI_TEST_ONSCREEN`，跑完立即 kill。

## WIP 边界的解释（逐项留痕）

会话起始真实读数 `git --no-optional-locks status --porcelain` = **89 M + 68 ??**（任务书/蓝图记 67 untracked，当次输出优先，差 1 已留痕）。
本轮对在制文件仅做**精确增量追加或字段级状态翻转**：

- `docs/DOC-REGISTRY.json`：仅追加本程序两个条目 + 对两份已完成蓝图做 `planned → completed` 字段翻转（M0-4 明确要求）；既有条目字节零改写。
- `docs/AUDIT-LOG.md`：按治理模板在头部前插本包「最后更新」行 + 待处理项表首插 🔵 启动行；既有行零改写。
- `docs/README.md`：仅追加 1 行入口链接；`docs/next-steps-roadmap.md` / `docs/project-workspace-handoff.md` / `docs/ui-productization-audit.md` 同理只做精确增量。
- `test/impact-map.json`：仅追加 1 条 M 波次 rule（解 `test:changed:list` 当次 exit 2 FAIL_CLOSED）；既有 rule 字节零改写。
- 其余 89 M 中他方/用户资产（多个 `.module.css`、设置面板、`frontend/src/App.tsx`、`acceptance/ui-design-assessment-2026-11-11/`、`assets/` 等）：**零触碰**。

零 stage / 零提交（禁用 `git add -A`）：本包所有登记均留在工作区，收口笔录显式枚举本包自有路径。
与治理 skill「同提交登记」的张力按本轮硬红线处置并留痕。

## 当次基线（M0-6 复取样，2026-11-11，HEAD `4127f5b5`）

14 门逐门前台串行取样，读数表见 `acceptance/m-blueprint-2026-11-11/m0/m0-canonical-readings.json`。
与蓝图 §0.2 的「12 绿 2 红」不同：当次为 **11 绿 / 2 红 / 1 个 exit 2 FAIL_CLOSED**——
`test:changed:list` 因本轮两个 acceptance 输入文件未挂 impact-map rule 触发 fail-closed（本包引入，M0 内补 rule 消解）。
`quality:ear` 当次 1052/2271 = 46.3%（蓝图记 46.4% / 2269，分母随在制 WIP 变动）。

## U / E / V / W 合规解法（不代答）

U 出决策材料且 `pending_user_ruling` 不改默认；E 自动生成测试路线且保持 `pending_human_eye` 不写 verified；
V 标 `external-blocked` + 补腿条件、G0 不外推；W 零触碰登记 owner。四类不计入完成数，M7 逐件终态化。

## 证据位置

`acceptance/m-blueprint-2026-11-11/m0/` … `m7/`（逐阶段），原件同目录。

G0 开发期常态 · 不外推 packaged/Provider/GA。
