# Harness 七支串行合并集成证据（item 39 · 2026-11-25）

## 范围与纪律

- 基：`origin/main = 86efb04caf28413114d6ad4bc8677b8982758318`（开工前 `git fetch` 实测，与发令一致）。
- 操作位：独立 worktree `/Users/zhangdiandian/orca/workspaces/Petri/turbot`，分支 `petri-ops/item39-harness7`；`merge-base(HEAD, origin/main) = 86efb04caf28`。
- 主工作目录（`~/Documents/1.WorkDir/Petri`）零触碰；他方未跟踪 WIP 与 tracked 改动零触碰；owner dev 实例零触碰。
- 零新依赖；观感 `pending_human_eye` 零代签；不改 CI 配置、不 prune 除 A5 已做之外的东西。
- **绝对未 push**。`origin/main` 全程未变（收尾复核仍为 86efb04ca）。

## 串行合并顺序与落点 SHA（每支合后即跑门禁）

| # | 分支 | 落点 SHA（合并提交） | 冲突 | 该支门禁结论 |
|---|------|----------------------|------|--------------|
| 1 | `petri-ops/codex-a1-silent-error` | `ff269491aec5dc1d1098ee43c297ed21e2496791` | 无 | 全绿（HK-01 5/5） |
| 2 | `petri-ops/b4-focus` | `008f57e3aaece20d0371554e7986369c85e250c2` | 无 | 功能门禁全绿（HK-01 6/6）；1 项非阻塞瑕疵见下 |
| 3 | `petri-ops/b1-zindex` | `4c266fb1b7789471531d3e3812359b145fa7665d` | `docs/ui-productization-audit.md` 1 处 | 全绿（HK-01 6/6） |
| 4 | `petri-ops/codex-harness-invisible-a5` | `fc738bb205a0aa877f8e6957cc9c0a6be8b28325` | 无 | 全绿（HK-01 10/10） |
| 5 | `petri-ops/codex-harness-console-governance` | `8b6129e881428bc77222913715901cefb6745284` | 无 | 全绿（HK-01 4/4） |
| 6 | `petri-ops/codex-harness-q7-a2` | `4d537b7b04613896e33b8b12dcc1482adbe4de4e` | 无 | 合后行数棘轮红，经裁决 A 重锚后转绿（详见下） |
| — | 重锚提交（非分支合并） | `5042ca19499b91961bda4d05a2d179a60ac9d3d6` | — | `loop-orchestrator-subdomains` 16/16 绿 |
| 7 | `petri-ops/codex-a3-d1-lesson`（最后） | `1bcfa205fb75244f4e6581c9dc83f1545e4c25b5` | 无 | 全绿（HK-01 14/14，棘轮 16/16） |

七支全部合入。**最终 HEAD = `1bcfa205fb75244f4e6581c9dc83f1545e4c25b5`**（供协调方 fetch + push）。工作树干净（`git status --porcelain` 0 行）。

每支合后门禁口径：`node --test <该支 HK-01>` + `npm run docs:check` + `npm run ui:audit:check` + `npm run quality:secret` + `npm run quality:arch` + `git diff --check`。全部以真实命令执行；除下列两处如实记录的裁决外均 exit 0。

## 冲突逐处裁决

1. **`docs/ui-productization-audit.md`（B1 合入时 1 处 content conflict）**：HEAD 侧为 B4 的 UI-727 登记块，B1 侧为 UI-728 登记块。裁决：**两块全保留**（删除冲突标记、两段并列）。复核 `UI-726`（A1，文件 6962 行附近）/`UI-727`/`UI-728` 各恰好 1 处，三行登记齐全。观感状态词原样保留 `in_progress`、零代签。
2. **`frontend/src/styles/custom.css` / `frontend/src/pages/welcome.module.css`（B4/B1 双改）**：自动合并无冲突，合后核验——B1 九档 `--petri-z-*` 语义 token 全在场（base 10 / raised 100 / sticky 500 / dropdown 1000 / overlay 4000 / modal 6000 / chrome 7000 / lightbox 8000 / toast 10000），零裸 `z-index:N`；B4 的 `:focus-visible` 在 `welcome.module.css`（10 处）与 `RouteErrorBoundary.module.css`（1 处）全在场；B4 死 CSS `.navbar__*` 清除保留（仅余注释留痕）。
3. **`core/petri-server/agent-runner.js`（A1 + wave2 + D1 三方）**：自动合并无冲突，合后逐项核验——A1 留痕在场（`A1_AGENT_EVENT_EMIT_FAILED` / 「A1 静默吞错」注释）、wave2 facade 重导出在场（`helpers/agent-loop-helpers.js`）、D1 `guardLessonInjection` 在场（194 行，先 guard 后写 `selfEvolutionLessons`）。三方改动零丢失。最终行数 1038。
4. **`test/impact-map.json`（A1 与 D1 各加规则）**：自动合并无冲突，两条规则均在场（`a1-silent-error-grading` 与 `a3-d1-lesson-injection-guard`），`JSON.parse` 校验通过。
5. **`eslint-suppressions.json`（A5）**：保留 A5 对 `LeftPanel.test.tsx` 陈旧项的 prune（合后复核该项不在场），未还原、未重复提交。

## 两处红灯的如实记录与裁决

### ① B4 证据日志尾空格（非阻塞瑕疵）

- 严格口径 `git diff --check HEAD~1 HEAD` 报 4 处 trailing whitespace，全在 B4 自带证据日志 `acceptance/harness-invisible-issues/hk01-red.txt` 的 66/124/161/163 行。
- 性质：B4 分支原样提交内容，非本次合并引入、非冲突、非功能 `.txt` 文件；任务门禁字面命令 `git diff --check`（干净工作树）exit 0；CI `.github/workflows/ci.yml:38-48` static gates 无 whitespace/diff-check 项，不会致 CI 红。
- 裁决（协调方 msg_149d567574cb，选 A）：**留档为非阻塞瑕疵，不改原文、不继续加严**。

### ② q7-a2 合后 agent-runner.js 行数棘轮红 → 授权重锚

- 合后 `node --test test/loop-orchestrator-subdomains.test.mjs` 报：`core/petri-server/agent-runner.js grew past shrink-only anchor 1024 (got 1038)`（test:172）。其余门禁全绿。
- 根因：wave2 单独合入时把 shrink-only 锚从 1153 重锚到 1024（=1153−129）；A1 静默吞错留痕先合入 +15 行（1153→1168），叠加后 1038 = 1023 + 15，超锚 14 行。两分支各自 HK-01 全绿，纯为合并叠加触发元约束；对原始 1153 净减 115 行，wave2 的 −129 收缩成果完整保留。
- 裁决（协调方 msg_24d66c183fed，选 A）：**授权重锚 1024→1038 并留因**。已在 `test/loop-orchestrator-subdomains.test.mjs` 注释写明「1024→1038（+14，非压门禁）：wave2 单独合入锚 1024=1153−129；A1 +15 叠加后 1038=1023+15；净减 115、棘轮仍只减不增卡在 1038、再超即红、拆分回收走 S4.1」。重锚后该测试 16/16 绿。D1 对该文件 4+/4− 行数中性，合后复核仍 1038 行、棘轮 16/16 绿。

## 整合 HK-01 全量复跑（7 支全合后，最终 HEAD）

对 8 个契约测试文件逐支复跑（`node --test`），结果如下：

| 分支 | 测试文件 | 结果 |
|------|----------|------|
| A1 | `test/a1-silent-error-grading.test.mjs` | ✅ 5/5 |
| B4 | `test/harness-b4b5-contract.test.mjs` | ✅ 6/6 |
| B1 | `test/harness-b1-zindex-contract.test.mjs` | ✅ 6/6 |
| A5 | `test/harness-a5-external-supervisor.test.mjs` | ✅ 10/10 |
| console-governance (wave1) | `test/a2-console-wave1.test.mjs` | ❌ 3/4（1 fail，见下） |
| q7-a2 (wave2) | `test/agent-runner-a2-wave2.test.mjs` | ❌ 9/10（1 fail，见下） |
| q7-a2 (棘轮) | `test/loop-orchestrator-subdomains.test.mjs` | ✅ 16/16 |
| D1 | `test/a3-d1-lesson-injection-guard.test.mjs` | ✅ 14/14 |

**两处整合红（均系 D1 最后合入使早先测试的前置假设失效，非代码回归；已停下如实报协调方待裁决）：**

- **WAVE1 `A2-WAVE1 console ratchet 只减不增` fail**：`AssertionError: console 棘轮违规：core/petri-server/helpers/lesson-injection-guard.js: 1 处 > 基线 0（新增 console）`。D1 新增的 `lesson-injection-guard.js` 第 36 行有 1 处 `console.warn`，且受 `process.env.EVO_DEBUG` 门控（非正常路径）；`test/console-baseline.json` 由 console-governance wave1 建基线，当时该文件尚不存在故未登记。wave1 本波目标文件仍全清（其余 3 项绿）。
- **WAVE2 `自进化 lesson 注入块逐字在场且带原始注释` fail**：`AssertionError: lesson-store require 必须逐字保留`。该断言所属 describe 组名为「注入点区域零改断言（**D1 分支将来合回**）」——其设计目的仅是证明 wave2 拆解未触碰注入点，以便 D1 后合。D1 已按裁决合入并正当地改写该注入块（原 `const { listActiveLessons } = require('./helpers/lesson-store');` 改为 `require('./helpers/lesson-injection-guard').guardLessonInjection(...)`），故该 verbatim 前置断言已过期；D1 自身的注入边界语义由 D1 HK-01 第 14 项覆盖且已绿。

`frontend/node_modules` 本机未安装，B1 的 `frontend/src/styles/theme-token-contract.test.ts`（vitest）无法执行，B1 evidence 已如实记录；本次未将其计为绿。

## 收尾状态

- 7 支全部合入独立 worktree 的 `petri-ops/item39-harness7`，工作树干净。
- 当前 HEAD：`1bcfa205fb75244f4e6581c9dc83f1545e4c25b5`。
- **未 push**；由协调方 fetch 核实后亲自 push。
- 整合 HK-01：6 项绿、2 项红（均为 D1 后置使前置断言过期的静态契约，根因与处置建议已上报协调方，等待裁决）。
