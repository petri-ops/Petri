# item 41 — 内联 `var()` 引号 hotfix 证据

- **基线**：开工前 `git fetch origin main` 核最新 = `4536aebed68efde164d9e5d2772bff829d67114d`，与本地 HEAD 一致；从该提交拉独立 worktree `/Users/zhangdiandian/orca/workspaces/Petri/hotfix-inline-var`，分支 `codex/harness-inline-var-hotfix`。owner dev 实例、主工作区他方 WIP、兄弟 worktree 零触碰。
- **根因**：B1 z-index 分支在 JSX `style` 对象里把 CSS 变量写成裸表达式 `zIndex: var(--petri-z-xxx)`。JSX style 是 JavaScript 对象字面量，CSS 变量必须写成字符串字面量，裸 `var(...)` 是无效表达式 → `Parsing error: Expression expected`。CI（petri-ops/Petri run 45577227462）干净环境有 `frontend/node_modules`，报 9 处；本地缺该目录时 eslint 跳过 TSX 解析而误判全绿。全仓实为 10 处 / 9 文件（CI 第 10 处前 parser 中止）。

## 1. 全仓核实与修复

核实命令：`grep -rnE 'zIndex:[[:space:]]*var\(--petri-' frontend/src --include='*.tsx'` → 10 处。扩展扫描 `grep -rnE ':[[:space:]]*var\(--' frontend/src --include='*.tsx'` 亦仅这 10 处，**没有其它属性裸写 `var()`**；其余 `var(--petri-*)` 全部位于引号字符串或模板字面量内（合法）。

| # | 文件 | 行 | 修改 |
| - | ---- | -- | ---- |
| 1 | `frontend/src/App.tsx` | 180 | `zIndex: var(--petri-z-overlay)` → 加单引号 |
| 2 | `frontend/src/App.tsx` | 184 | `zIndex: var(--petri-z-modal)` → 加单引号 |
| 3 | `frontend/src/components/copilot/ContextBudgetBar.tsx` | 176 | `zIndex: var(--petri-z-dropdown)` → 加单引号 |
| 4 | `frontend/src/components/copilot/ChatArtifactCard.tsx` | 310 | `zIndex: var(--petri-z-lightbox)` → 加单引号 |
| 5 | `frontend/src/components/desktop/titlebar/TitleBarRightZone.tsx` | 230 | `zIndex: var(--petri-z-dropdown)` → 加单引号 |
| 6 | `frontend/src/components/desktop/InstallDeepLinkDialog.tsx` | 164 | `zIndex: var(--petri-z-overlay)` → 加单引号 |
| 7 | `frontend/src/components/desktop/PluginStorePanel.tsx` | 400 | `zIndex: var(--petri-z-overlay)` → 加单引号 |
| 8 | `frontend/src/components/desktop/CrashNoticeBanner.tsx` | 90 | `zIndex: var(--petri-z-toast)` → 加单引号 |
| 9 | `frontend/src/pages/window/CommandCenterJobsWall.tsx` | 511 | `zIndex: var(--petri-z-base)` → 加单引号 |
| 10 | `frontend/src/themes/ThemeProvider.tsx` | 397 | `zIndex: var(--petri-z-toast)` → 加单引号 |

仅加单引号；层级档位、其它属性、逻辑零改动。`git diff --stat`（源码）= 9 files / 10 insertions / 10 deletions；修复后裸 `var()` grep 归零。

## 2. 防复发契约（红 → 绿）

`test/b1-inline-var-quoting.test.mjs`：遍历 `frontend/src` 全量 `.tsx`，断言对象属性 `键: var(--...)` 形态归零；Q2 合成红自证（裸 var 命中，单/双引号、`'1px solid var(--x)'` 字符串值、`` `var(--x, ${n}px)` `` 模板字面量均不误伤）。

- **红**（HEAD 原始代码，`git archive HEAD frontend/src` 解到临时树后跑同一测试）：Q1 FAIL，逐条列出 10 处 / 9 文件。
- **绿**（修复后）：`node --test test/b1-inline-var-quoting.test.mjs` → 2/2 PASS。

## 3. TS 真语法门禁（红 → 绿）

`test/b1-inline-var-syntax.test.mjs`：对 9 个改动文件逐个 `ts.transpileModule(source, { reportDiagnostics: true, ... })`，断言 0 个 `DiagnosticCategory.Error`。TypeScript 解析顺序：常规 `require` → `frontend/node_modules/typescript` → `node_modules/typescript`，**零新依赖**（`typescript` 本就是仓库已声明依赖）。本机以现成安装 `NODE_PATH=/Users/zhangdiandian/orca/workspaces/Petri/bakekujira/node_modules` 运行，未安装任何包。

- **红**（HEAD 原始代码）：9 个文件全部报 `TS1109 Expression expected`（连带 TS1138/TS1005/TS1381 等），S1 FAIL。
- **绿**（修复后）：9 文件 0 syntax error；S2 合成红自证通过 → 2/2 PASS。

## 4. 其余门禁

| 门禁 | 结果 |
| ---- | ---- |
| `npm run docs:check` | PASS（674 registered documents） |
| `npm run ui:audit:check` | PASS（同提交同步 UI-728 增量注记） |
| `npm run quality:secret` | PASS（生产面 0 命中） |
| `npm run quality:arch` | PASS（R1–R5 无违规；复用已安装 dependency-cruiser 的符号链接，未装新包） |
| `git diff --check` | PASS（无输出） |
| `npm run quality:lint` | **未验证**：本机 worktree 无 `node_modules/frontend/node_modules`，eslint 配置依赖 `@eslint/js` 无法从 worktree 解析；按令不强装依赖。两个新增测试为纯 Node `.mjs`，仅 import `node:*` 内建。 |

附注：`npm run test:changed:list` 在 HEAD 即 exit 2（impact-map `closed-batch-evidence-dirs` 引用不存在的 `test/c56-user-manuscript-fidelity.test.mjs`），属存量问题；本波未触及 `test/impact-map.json`。

## 5. 范围与边界

- 零新依赖：`package.json` / lockfile 未改（既有 B1-5 契约逐键基线口径）。
- 未翻 `qualificationEligible`，未扩 G1 范围，未代签观感项，未改历史证据。
- 提交留本地；push 由 coordinator fetch 核实后亲自执行。
- 最终 HEAD SHA 见 worker_done 回报。
