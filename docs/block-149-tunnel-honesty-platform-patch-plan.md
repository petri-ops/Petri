---
capability: tunnel-honesty-platform-patch
goal: BLOCK-149 A5 隧道诚实化+平台域点状修补——隧道徽标按 stateSinceTs 分级宣称（>15 分钟才说「公网可用」，对齐台账健康判据，消灭假活恒绿）；PL-D2=30 天保留落地（对齐 task_events 先例，只改默认值）；nul 游离文件根修；平台映射三副本一致性契约锚
acceptance:
  - 各项红绿先行（HK-01）：先失败测试再实现，红→绿证据随收口笔录留痕
  - A5#5：前端消费 TunnelStatus.stateSinceTs（字段已在 tunnel.js:341 返回），徽标三态——未连接/连接建立中（<15min，不宣称公网可用）/持续连接（≥15min 才显示「公网可用」）；文案不得谎报（台账判据 SKILL.md §3 为准）；后端零改动优先（纯前端消费），如需后端补字段留痕取舍
  - PL-D2：tool-jobs-retention 默认保留天数 0（无限）→ 30（BIOF3_TOOL_JOBS_RETENTION_DAYS 缺省值；显式 env 覆盖语义不变）；契约测试锁定默认值=30 与 env 覆盖；g0-platform §8 裁决点台账对账行补「已裁决 30 天删除（主代理按推荐代裁，用户批量推进授权）」
  - nul 根修：定位产生仓库根 nul 游离文件的命令源头（spawn shell 重定向类），修源头；不可定位则 hygiene:check 加 nul 检出兜底并留痕
  - 平台映射锚：契约测试断言 deriveHostPlatform 输出键 ⊆ 平台键约定集合且与 plugin-schema PLATFORM_IDS 一致（core 测试引 src 若触 arch 红线则降级为文件内锚+注释指向 canonical，取舍留痕）
  - 定向门禁：test:changed + quality:types/lint/secret/arch 全绿 + 前端定向；closeout 十一门（集成提交后）
reopen: 后端周期性 publicUrl 自探活（端到端 probe 门控）留后续；平台映射三副本收敛为单源属重构候选
status: active
---

# BLOCK-149 A5 隧道诚实化 + 平台域点状修补批（审视批序列第 4 批·收官）

## 1. 背景与裁决溯源

- 源头：审视 A5 高影响发现 #5 + 剩余工作地图平台域点状修补批；用户「按顺序直接推进 尽可能的走远」批量发令。
- PL-D2 裁决：主代理按推荐代裁=30 天删除（用户对话框未答+批量推进授权，roadmap BLOCK-147 立项行留痕；对齐 task_events TASK_EVENTS_RETENTION_DAYS=30 先例；只改默认值零新实现；用户可一句话改回）。

## 2. 范围（四项，两轨并行）

| 轨 | 项 | 内容 | 主文件 |
| --- | --- | --- | --- |
| A（隧道诚实化） | #5 | 徽标按 stateSinceTs 三态分级；「公网可用」仅持续连接 ≥15min 宣称 | frontend/.../MobileSync.tsx:53-62/375（TunnelStatus 消费）；core/.../mobile-gateway/tunnel.js 只读（字段已在） |
| P1（保留策略） | PL-D2 | 默认 0→30 天；env 覆盖语义不变；g0-platform 裁决点对账 | core/biof3-server/helpers/tool-jobs-retention.js:10 + 契约测试 + g0-platform-goal-plan.md §8 |
| P2（nul 根修） | 卫生 | 定位游离 nul 文件产生源（spawn/shell 重定向）修之；兜底 hygiene 检出 | 待定位（scripts/ 或 spawn 面全仓 grep） |
| P3（映射锚） | BLOCK-146 P2-3 余项 | deriveHostPlatform ↔ PLATFORM_IDS 一致性契约测试 | test/ 新增 + src/plugin-schema.js（只读） |

A 轨与 P 轨文件面互斥可并行；P1/P2/P3 同轨串行。

## 3. 非范围

- 后端 publicUrl 周期自探活（端到端 probe）——后续批。
- 平台映射三副本合并单源（重构）——候选在册。
- G1+ 不外推；不新增依赖；不动隧道连接管理逻辑本身。

## 4. 实现形态

dynamic workflow 双轨并行实现员（A 轨/P 轨）→ 独立评审 → 统一门禁（红了即修 ≤2 轮）；工作流内不提交，主代理终审集成。CSS 若触走 token。

## 5. 验收与证据

红绿证据 + test:changed + 四质量门 + 前端定向；closeout 十一门（集成后）；证据落 acceptance/block-149/。PL-D2 台账对账行随收口回写。

## 6. 风险与边界

- stateSinceTs 时钟源与前端时钟偏差：阈值判断留裕量（如 ≥14min 判过线）或用后端返回的持续时长字段（若有），取舍留痕；拿不准从紧（不宣称优于假宣称）。
- nul 根修若源头在第三方/npm 内部不可改：hygiene 检出兜底+登记，不强改。
- core 测试引 src/plugin-schema 若触 arch 门：降级为测试内字面锚+注释指向 canonical（取舍留痕）。

## 7. 完成语义

四项交付 + 评审 P1 清零 + 统一门禁绿 + 主代理终审集成 + closeout 十一门 PASS + 台账五件回写（含 PL-D2 裁决对账）。至此审视批序列四批全部收口，剩余仅观察项/池态/用户过目项。
