# A2 / B4+B5 证据（2026-11-25）

分支：`petri-ops/b4-focus`（独立分支，不与 A1 的 `petri-ops/codex-a1-silent-error` 交叉）。

## 0 材料与核真前提

- 任务书指定材料 `docs/harness-invisible-issues-optimization-2026-11-25.md` 在本分支工作树中不存在——它属主线未跟踪 WIP（AUDIT-LOG 已记为「他方未跟踪文档」），按纪律**零触碰**。本包按任务书转述的审计结论逐条重新核真，不依赖该文档。
- 原始出处：`acceptance/ui-ux-audit-2026-10-10/ui-ux-audit-report.md` §1（B5=表行 63/64）、§2.1（B4=表行 91/93）。
- 所有 B5 判定均按铁律：全仓 grep（代码 + 字符串 + 动态引用）确认零消费者才删；任何一处仍有引用则保留并在此说明。

## 1 B4 键盘 focus-visible

### 1.1 改前核真

- `frontend/src/pages/welcome.module.css`：改前 384 行，`grep -n focus` **零命中**；两处 `outline: none` 主动抹焦点环——`projectSearch`（原 204 行）、`actionInput`（原 297 行）。
- `frontend/src/components/RouteErrorBoundary.tsx:77,80`：两个按钮用 `button.primary` / `button.ghost`（共享 `frontend/src/components/ui/controls/button.module.css:50,57`），该共享文件与 `RouteErrorBoundary.module.css` 改前均无 `:hover` / `:focus-visible` 定义。
- 全仓既有焦点先例：`TitleBar.module.css:123`、`BranchTabs.module.css:66`、`ExperimentalFeaturesSection.module.css:70` 统一用 `outline: 2px solid var(--petri-accent); outline-offset: 2px;`——照此形态补齐，不造新范式。

### 1.2 改动

- `frontend/src/pages/welcome.module.css:386-400`：为 9 个**实际被 welcome.tsx 使用**的交互类补统一 `:focus-visible` 环：`.chip` / `.pickerTrigger` / `.projectSearch` / `.projectRow` / `.panelAction` / `.actionInput` / `.actionBack` / `.actionPrimary` / `.dirSuggestion`。`outline:none` 只对鼠标态生效，键盘由 `:focus-visible` 还原。
- `frontend/src/components/RouteErrorBoundary.module.css:58-62`：`.actions button:focus-visible`——作用域仅本回退页两个按钮，不全局改共享 button 变体。
- 两条规则均用 `--petri-accent`（已在 `custom.css:92/267/1109` 亮暗双套定义），**无 transition/animation**，`reduced-motion` 全局兜底零触碰。

## 2 B5 死代码 / 死 CSS 逐项核真

| 项 | 全仓核真结果 | 判定 | 动作 |
| --- | --- | --- | --- |
| `PageHeader.tsx` | 代码面零命中；仅 docs/acceptance 历史叙述与 `scripts/qa-smoke.mjs:91` 字符串（该清单明确「缺失仅告警并跳过」）。git：`296fcd243 chore(frontend): remove dead web-era source files` 已删 | 早已删除，零复生 | 不动脚本 |
| `WorkbenchEmpty` 组件 | `.tsx` 由 `296fcd243` 已删；存活的 `components/ui/WorkbenchEmpty.module.css` **仍被** `frontend/src/styles/theme-token-contract.test.ts:413` 的 token 棘轮按文件名引用 | **有活字符串消费者** | 按铁律**保留** CSS 与测试棘轮，不删 |
| `PageHeader.css` | 文件不存在；`6a2fefe0b feat(block-161)` 已删；仅 `qa-smoke.mjs:91` 容错字符串 | 零 DOM 消费 | 不动 |
| `LoginModal.css` | 文件不存在；`6a2fefe0b` 已删；`components/desktop/desktop.css:5` 仅注释「与 LoginModal 同款模态风格」，非选择器/导入 | 零 DOM 消费 | 不动（注释-only 引用，非消费者） |
| `custom.css` `.run-modal`（审计标 1208-1233） | 当前 `grep run-modal` 零命中；`6a2fefe0b` 删除 | 已清退 | 零复生断言入契约 |
| `custom.css` `.navbar*` | 桌面壳无 navbar：`global.css:3`「无 navbar/footer」、`:12` `--ifm-navbar-height:0px`、`src/preload.js:8`「SPA 没有 navbar」；全仓代码 grep `navbar__` 仅命中 acceptance 历史快照，无 DOM/字符串消费；无 Docusaurus/web 构建配置 | 零消费者死 CSS | **删除** `.navbar__items--right` / `.navbar .navbar__search-input` 及三处 media 规则 / `.navbar__brand` / `.navbar__title` / `.navbar-separator` + media / `html.petri-desktop .navbar__inner`，仅保留 `.navbar__search` 选择器摘除后的 DocSearch 共享规则（原 1018-1107、1092-1107、1145-1148；现 `custom.css:1018` 留一行去向说明）。`custom.css` 1483→1399 行 |

## 3 HK-01 红绿先行

- 契约：`test/harness-b4b5-contract.test.mjs`（纯 Node `node:test`，**零依赖**。frontend 的 vite/vitest 本机未安装，故静态 CSS 契约走 Node，不用 vitest）。
- 红：`acceptance/harness-invisible-issues/hk01-red.txt` → `tests 6 / pass 1 / fail 5`（welcome 交互类缺焦点环、两处 outline:none 未还原、回退页按钮缺焦点环、焦点规则走 token 断言、navbar 死选择器在场）。
- 绿：`acceptance/harness-invisible-issues/hk01-green.txt` → `tests 6 / pass 6 / fail 0`。
- 契约含篡改负向面：禁裸色（`hex`/`rgba`）、禁动效（`transition`/`animation`）、已删文件零复生、`WorkbenchEmpty.module.css` 因测试引用必须保留。

## 4 门禁结果

| 门禁 | 结果 |
| --- | --- |
| `node --test test/harness-b4b5-contract.test.mjs`（HK-01） | PASS 6/6 |
| `npm run ui:audit:check` | PASS（657 UI 编号；台账同步登记 UI-727 `in_progress`） |
| `npm run docs:check` | PASS（673 registered documents） |
| `git diff --check` | CLEAN |

诚实边界（非本包引入、未冒认绿）：

- `theme-token-contract.test.ts` 未能执行——frontend `vite`/`vitest` 未安装；本包新增规则只用既有 `--petri-accent`，且静态契约已断言禁裸色/禁动效。
- `npm run test:changed:list` 基线 exit 2：`closed-batch-evidence-dirs` 引用缺失的 `test/c56-user-manuscript-fidelity.test.mjs`（HEAD 既有），非本包改动，零触碰。
- 未跑 dev Electron 实机；焦点环为静态可访问性契约，观感零代签、`pending_human_eye` 项维持不翻。

## 5 纪律

- 零新依赖（`package.json`/锁文件未动）；主文件净减行（custom.css -84 行）。
- 观感零代签：UI-727 保持 `in_progress`，不写 verified；不碰 owner dev 实例。
- A1 分支与主线未跟踪 WIP 零触碰；提交留本地，push 等主人逐批口令。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
