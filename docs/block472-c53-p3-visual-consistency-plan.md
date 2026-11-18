---
capability: block472-c53-p3-visual-consistency
status: completed
kind: work-package
truthDomain: block472-c53-p3-visual-consistency
entrypoint: docs/README.md
goal: C-53 UI-DESIGN-QUALITY 的 P3（视觉一致性）——沿 P1/P2 先例新增独立静态扫描器，把 design-charter / petri-css-theme token 落地承诺机械复算为模型可读可复算契约（海军蓝暗色阶梯取值单调性 + 广谱 slate 家族 ratchet + 颜色预算现读对账 + 禁零定义/token 覆盖），消费测试锚定；纯只读机械面，零 CSS/组件写面、零观感代签
acceptance:
  - HK-01 红绿先行：消费测试先红（扫描器模块缺席）后绿；含篡改负测 fail-closed
  - 视觉一致性契约可复算：collectVisualConsistency 从 custom.css 暗色块/全源现读机械派生，落 resources/design-context/visual-consistency.json；--check 重算与落盘逐读数一致（忽略易变字段）
  - 海军蓝暗色阶梯：canvas→surface→subtle→elevated 四档取值严格明度递增，且等于 petri-css-theme §1 / custom.css 规范值（#0b1220/#111a2e/#182339/#1d2945）
  - 广谱 slate 家族 ratchet：11 家族成员逐文件命中冻结入册，新增即红；存量命中如实登记豁免理由（不改 CSS）
  - 颜色预算现读对账：accent 实际引用总数逐文件 ≤ theme-token-contract 已登记 ratchet，宣称终态目标（≤130）如实标注未达
  - 观感零代签：本包纯资源 JSON + 脚本 + 测试，无 pending_human_eye 面；UI 台账观感项保持 in_progress
  - 零新增产品依赖、零 CSS/组件运行时写面；closeout 定向门禁全绿 + impact-map 登记 + 六件套回写
---

# BLOCK-472 · C-53 P3 视觉一致性（completed / P3-LAUNCH→CLOSED）

> **发令**：用户 2026-11-18 发令「开始 C-53 P3」——承接批2提示词 `docs/next-phase-e2e-prompt-2026-11-18-b2.md` S2 / R10，前序 S1（BLOCK-471 / C-53 P2）已收口。
> **从属**：`docs/petri-master-charter.md` + AUDIT-LOG C-53 权威阶段（P0 基线冻结→P1 上下文包硬化→P2 IA→P3 视觉一致性→…→P7 人眼收口）+ BLOCK-465（P0/P1）/ BLOCK-471（P2）已完成。

## 1. 范围（scope）

1. **静态扫描器**：新增 `scripts/c53-visual-consistency.mjs`——纯函数 `collectVisualConsistency(root)` 从 canonical 真源机械复算四组读数，落 `resources/design-context/visual-consistency.json`（沿 P1/P2 design-context 先例，生成器自身维护 manifest sha256）：
   - **navyLadder**：从 `custom.css` 暗色块解析 `--petri-bg-{canvas,surface,subtle,elevated}` 四档 hex + 相对明度，断言严格递增（`lum(canvas) < lum(surface) < lum(subtle) < lum(elevated)`），且四值等于规范集合；纯函数 `scanNavyLadder(customCss)` 供篡改负测。
   - **slateFamily**：广谱 11 家族成员（slate-950/900/800/700/600/500/400/300/200 + slate900-rgba + slate500-rgba）逐文件命中计数，冻结现存命中为 ratchet；纯函数 `scanSlateFamily(sources)`。
   - **colorBudget**：现读 accent 引用总数 + 逐文件计数，与 `theme-token-contract.test.ts` 已登记 accent RATCHET 对账；宣称终态目标（≤130）如实标注未达；纯函数 `scanColorBudget(cssSources)`。
   - **undefinedTokens**：`var(--color-*)` 零残留 + `var(--petri-*)` 引用 ⊆ 定义（沿现有契约口径 + JS 注入白名单）；纯函数 `scanTokenIntegrity(sources)`。
2. **消费测试**：`test/c53-visual-consistency.test.mjs`——可复算（现读 vs 落盘逐读数深等）、阶梯单调性断言、slate ratchet 新增即红、颜色预算对账、token 完整性、篡改负测（改阶梯值/插 slate/改哈希）fail-closed、P0/P1/P2 包零回归；HK-01 红→绿留痕。

## 2. 非范围（exclusions）

- CSS/组件/路由任何运行时写面、观感签字（pending_human_eye 零代签）、design-charter 冻结档位/预算变更（只读对齐，不改值）；
- 改 `theme-token-contract.test.ts`（其 19 断言数被 P0 快照 `tokenGate.assertions` 逐读数深等锚定，改动会连带红）；
- C-53 P4–P7（响应式 a11y/性能可信态/Skill v1.1/人眼收口）；新产品 Skill；用户 untracked 资产零触碰；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：`node --test test/c53-visual-consistency.test.mjs` 先红（模块缺席）后绿。
- **G2 可复算**：`node scripts/c53-visual-consistency.mjs --check` 重算通过；阶梯四档严格递增且值对齐规范；slate 命中与冻结基线一致；manifest sha256 一致。
- **G3 零回归**：P0 `test/c53-design-context-pack.test.mjs` + P2 `test/c53-ia-map.test.mjs` 零回归；`theme-token-contract` 19/19 绿；`petri-css-theme` 报告级；docs:check/ui:audit:check 绿；零新增依赖。
- **G4 治理**：closeout 定向门 + impact-map 登记 + 六件套回写。

## 4. 完成语义

G1–G4 全绿或明确 external-blocked + 六件套回写 + 证据落 `acceptance/block472-c53-p3-visual-consistency/`。本包无观感面（资源 JSON+脚本+测试均非用户 UI 写面），如实登记；不冒充任何 pending_human_eye 项 verified。

## 5. 收口记录（2026-11-18）

HK-01 红→绿 9/9（模块缺席 ERR_MODULE_NOT_FOUND → 9/9）；`--check` PASS（readingIds=4，accentTotal=356，slateRatchetFiles=5）；P1 包 8/8、P2 包 7/7、theme-token 19/19 零回归；docs:check(626)/ui:audit:check/hygiene 绿；零 UI 写面/观感代签/新依赖。证据=acceptance/block472-c53-p3-visual-consistency/。C-53 P4-P7 待后续发令。

## 6. 收口门禁归属（2026-11-18）

- `quality:perf` packaged_start 继承抖动（G0 噪声，在册）——本批零 perf 面改动（纯资源/脚本/测试），归属既有基线，不属本包，不重打基线；closeout 以 `--skip=quality:perf` 如实标 SKIPPED（不算 PASS）。
- `test-affected.test.mjs:90` 的 block464/block470 evidence gap = HEAD 既有映射盲区（两 evidence 分别由 1fdcae86/ef8e475c 引入、从未登记 impact-map；提示词 §1 已预告"本批不碰"）；`g0-rs-p6` 源绑定要求 impact-map 工作区==HEAD。两者仅在 commit 前、未提交的 impact-map 进入 diff 时命中 `nso-w5-impact-coverage` 规则才被拉入——按 P2 先例（f5cca3c3 同批提交 impact-map）先 commit 再 closeout，diff 干净后两既有红不入范围。非本包新代码红，不篡改基线、不伪称通过。

G0 开发期常态 · 不外推 packaged/Provider/GA。
