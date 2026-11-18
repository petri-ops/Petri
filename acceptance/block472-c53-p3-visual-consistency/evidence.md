# BLOCK-472 / C-53 P3 视觉一致性 — 证据（2026-11-18）

## 发令与范围
- 用户发令「开始 C-53 P3」（批2提示词 `docs/next-phase-e2e-prompt-2026-11-18-b2.md` S2/R10）；前序 S1（BLOCK-471 / P2）已收口。
- 范围=沿 P1/P2 先例新增独立静态扫描器，把 design-charter / petri-css-theme token 落地承诺机械复算为模型可读可复算契约；纯只读机械面，零 CSS/组件写面。
- 关键决策：**不改** `theme-token-contract.test.ts`（其 19 断言数被 P0 快照 `tokenGate.assertions` 逐读数深等锚定，改动会连带红）；改为新增独立扫描器，避免基线漂移。

## HK-01 红绿
- RED（实现前，扫描器模块缺席）：`node --test test/c53-visual-consistency.test.mjs` → ERR_MODULE_NOT_FOUND（pass 0 / fail 1）。
- GREEN：`tests 9 / pass 9 / fail 0` —— ①快照/契约结构完整 ②四组读数现读一致（可复算）③海军蓝阶梯四档明度严格递增+规范值对齐 ④广谱 slate ratchet 不超冻结基线 ⑤accent 现读对账（终态未达如实标 false）⑥token 完整性（零 var(--color-*) + 零未定义 --petri-*）⑦manifest sha256 一致 ⑧篡改负测 fail-closed ⑨P0/P1/P2 包零回归。

## 现读产物
- `resources/design-context/visual-consistency.json`：四组读数——
  - **navyLadder**：dark 块 canvas #0b1220(17.52) → surface #111a2e(25.53) → subtle #182339(34.25) → elevated #1d2945(40.47)，相对明度严格递增，四值对齐 petri-css-theme §1 规范。
  - **slateFamily**：广谱 11 家族成员，存量命中冻结 5 文件（custom.css 4 处=终端/状态/气泡 token 定义值；terminal-themes.ts 5 处=light 终端主题 ANSI 色；ContextBudgetBar/PluginStorePanel/desktop.css 各 1 处散落字面量），overRatchet=[]；新增即红。
  - **colorBudget**：accent 现读总数 356，逐文件计数在册；declaredCeiling=130（design-charter §2 现读），targetMet=false（如实标注终态未达，存量由 theme-token-contract 逐文件 ratchet 冻结，本包不扩改）。
  - **undefinedTokens**：undefinedColorRefs=[]，missingPetriRefs=[]。
- `scripts/c53-visual-consistency.mjs`：`collectVisualConsistency`/`scanNavyLadder`/`scanSlateFamily`/`scanColorBudget`/`scanTokenIntegrity`/`validateVisualConsistencyIntegrity` 纯函数 + `--check`（不写盘）；契约 sha 由生成器自身维护 manifest（沿 P1/P2 先例）。
- `--check` PASS（readingIds=4，accentTotal=356，slateRatchetFiles=5）。

## 边界与零回归
- P1 包 `test/c53-design-context-pack.test.mjs` 8/8 零回归；P2 包 `test/c53-ia-map.test.mjs` 7/7 零回归；`theme-token-contract` 19/19 零回归。
- 观感零代签：本包无 pending_human_eye 面（资源 JSON+脚本+测试非用户 UI 写面）；UI-706/707/709/710 + E 类 22 条保持 in_progress，不冒充 verified。
- 零产品代码/CSS/组件/运行时写面/新依赖；design-charter 冻结项零触碰（只读对齐）；用户 untracked 资产零触碰。

G0 开发期常态 · 不外推 packaged/Provider/GA。
