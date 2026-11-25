# item 43 — harness 集成收尾笔证据

- **基**：开工前 `git fetch origin` 核最新 = `cff483598c72306ac2555c41870efac27e9fb91e`（与发令时一致，无更新）。
- **工作区**：独立 worktree `/Users/zhangdiandian/orca/workspaces/Petri/ropefish`，分支 `petri-ops/codex-item43-harness-code`。owner dev 实例、主工作区他方 WIP、19 项未跟踪文件、兄弟 worktree 零触碰。
- **零新依赖**：`package.json` 仅新增 npm script，dependencies/devDependencies 未改；未安装任何包。

## 第一部分：code-size 台账重打

### 1.1 边界核实（git diff 实证）

`git diff --name-status 86efb04ca..cf30b8f92` 中本次集成改过的入册文件恰为下表 7 个（`test/agent-runner-a2-wave2.test.mjs` 为新增测试、非入册文件）：

| 文件 | 基线→当前 行 | 指纹漂移 |
|---|---|---|
| `frontend/src/components/desktop/PluginStorePanel.tsx` | 535→535 | ✓ |
| `core/petri-server/helpers/tools-executor.js` | 2081→2106 | ✓ |
| `core/petri-server/mcp/registry.js` | 983→984 | ✓ |
| `frontend/src/styles/custom.css` | 1485→1401 | ✓ |
| `core/shared-backend/skill-runtime.js` | 1136→1139 | ✓ |
| `core/petri-server/agent-runner.js` | 1153→1038 | ✓ |
| `core/petri-server/mcp/registry/run-plugin-script.js` | 911→912 | ✓ |

`frontend/src/pages/project-workspace/WorkspaceFilePreview.tsx`：`git diff 86efb04ca..HEAD` **零命中**；`git show 86efb04ca:… | wc -l` = **731**，`git show … | shasum -a 256` = `def0075f…`（与当前工作树一致）。基线记 727 / `3f3ef623…`，即**该存量债在 push 前就已存在**，本次集成未改，按铁律不合法化、不代改。

### 1.2 重打方式与 diff 核实

`node scripts/code-size-ledger.mjs --write` 会重打**整个**基线，且 BLOCK-511 S2.5 要求所有行数上调显式 `--allow-grow`（5 个文件增长，含 WorkspaceFilePreview），会把存量债一并合法化。故：

1. 先在临时基线 `/tmp/item43-baseline-write.json` 跑 `--write`（5 个 `--allow-grow` 全部留因，其中 WorkspaceFilePreview 明确标 TEMP）做**工具正典值交叉核对**；结果确认恰 8 文件漂移（7 集成 + WorkspaceFilePreview）。
2. 对真实基线 `acceptance/block-92/size-baseline.json` 做**最小定点重打**：只更新上述 7 个文件的 `lines`/`bytes`/`sha256`，`WorkspaceFilePreview.tsx` 与全部 `growAllowances` 一字未动。

`git diff --stat acceptance/block-92/size-baseline.json` = **20 insertions / 20 deletions**，逐条核对只有 7 个文件条目；`WorkspaceFilePreview.tsx` 那条保持 727 / `3f3ef623…` 原样。

### 1.3 --check 结果与例外机制裁定

`node scripts/code-size-ledger.mjs --check` 仍 **exit 1**，但违规从 12 条降到 2 条，且**只剩存量债**：

```
- WorkspaceFilePreview.tsx: 731 > 基线 727（棘轮只减不增）
- WorkspaceFilePreview.tsx: 内容指纹漂移（sha256 变更未随提交重打基线）
```
原始输出：`gate-code-size-after-item43.txt`。

**size-exceptions.json 不适用**（逐条核码 `scripts/code-size-ledger.mjs` `evaluateGate`）：
- 该文件 `wave: L0` → 预算例外 enforcement 明确不适用（v3 头注释 + evaluateGate 分支）；
- 不在 `allowedExceptionPaths` 冻结白名单（只出不进，不得新增路径）；
- 例外只作用于 `lines > BUDGET_LINES` 检查，**不豁免行数棘轮、更不豁免 sha256 指纹漂移**（指纹检查无条件）。

结论：**不存在既不碰 WorkspaceFilePreview 又能让 `--check` 全绿的仓库既有机制**。按铁律停下如实报，由主人裁决该存量债处置；不压门禁、不合法化、不擅自改他方债。CI `gate:code-size` 因此仍会红在该存量项（非本次集成回归）。

## 第二部分：防前端依赖缺失静默跳过（治根因）

### 2.1 改动（复用既有设施，零新工具类别、零新依赖）

1. **`scripts/quality-frontend-deps-gate.mjs`（新增，仅 node:fs/path/url）**：`frontend/node_modules` 缺失或不完整（缺 `typescript/package.json`）即打印明确原因 + 修复命令并 `exit(1)`。这是 type-aware lint 的**前置硬门**，不是第二套 lint/tsc。
2. **`package.json`**：新增 `quality:frontend-deps`、`quality:ts-syntax`（`node --test test/b1-inline-var-syntax.test.mjs`）两个 script，并插入 `closeout` 的 `--gate quality:lint` **之前**，使本地质量门在缺依赖时先红、不再静默跳过。
3. **`test/b1-inline-var-syntax.test.mjs`（item 41 既有工具，扩展不新建）**：保留 S1/S2，新增 **S3 全前端树 parse-only 语法门**（`ts.createSourceFile` + `parseDiagnostics`，964 个 TS/TSX，含 `.d.ts` 不抛错）+ **S4 合成红自证**。用仓库已声明的 `typescript`（root devDeps + frontend devDeps），解析不依赖 `frontend/node_modules` 的类型解析，因此缺依赖时这道真语法门照常生效。

### 2.2 HK-01 红绿先行（真实命令）

| 门 | 场景 | 结果 | 原始输出 |
|---|---|---|---|
| `quality:frontend-deps` | `frontend/node_modules` 缺失（本 worktree 原状） | **exit 1 / FAIL**，明确「type-aware lint 会静默跳过 TSX 解析」+ 修复命令 | `hk01-frontend-deps-red.txt` |
| `quality:frontend-deps` | 临时 `ln -s ../node_modules frontend/node_modules` | **exit 0 / PASS**（随后已删除 symlink） | `hk01-frontend-deps-green.txt` |
| `quality:ts-syntax` | 现状 964 文件 | **4/4 PASS**（S3 绿） | 见下 |
| `quality:ts-syntax` | 注入 `frontend/src/__item43_syntax_probe.tsx` 含裸 `var(--petri-z-toast)` | **exit 1 / S3 FAIL**，逐条 `TS1109 Expression expected` 等 | `hk01-ts-syntax-red.txt` |
| `quality:ts-syntax` | 删除探针后 | **4/4 PASS**（复绿） | 现场输出 |

绿证原文：`✔ S1… ✔ S2… ✔ S3 全前端树 parse-only 语法门 ✔ S4… / pass 4 / fail 0`。
注入探针的 S3 失败信息含 `frontend/src/__item43_syntax_probe.tsx: TS1109: Expression expected.; TS1138…`；探针已删除，工作树干净（`git status` 无该文件）。

至此：缺依赖 → 依赖硬门红（不再跳过）；即便缺依赖 → 全树 TS 语法门仍生效且能抓 item 41 同型裸 `var()` 红。

## 第三部分：本地可验 / CI 不可本地全验（如实标注）

| 项 | 本地结果 | 说明 |
|---|---|---|
| `npm run docs:check` | 见提交前实测 | 治理门禁 |
| `npm run ui:audit:check` | 见提交前实测 | 台账门禁 |
| `npm run quality:secret` / `quality:arch` | 见提交前实测 | 静态门禁 |
| `git diff --check` | 见提交前实测 | 空白/冲突标记 |
| `npm run quality:ts-syntax` | **PASS 4/4** | 本次新增，缺依赖下仍绿 |
| `npm run quality:frontend-deps` | **本地 FAIL（缺依赖，符合 HK-01）** | owner dev 实例有完整 frontend 依赖则 PASS |
| `npm run gate:code-size` | **PASS（见 coordinator 补记）** | 7 集成文件重打 + WorkspaceFilePreview 存量按裁决重锚后转绿 |
| `npm run quality:lint` / `quality:types` | **未本地全验** | 本 worktree 无 `frontend/node_modules`，lint 类型感知规则缺完整 program（本地产生大量 `no-unsafe-*` 噪音），tsc 报缺 `vitest`/`@testing-library/react` 等模块；按令不强装依赖、不借他方实例。CI（`npm --prefix frontend ci` 后跑两门）才是其真值环境。 |
| `npm run quality:knip:check` | **本地 FAIL（环境阻塞）** | 缺 `frontend/node_modules` 导致 knip 把 285 处 frontend export 误报为新增死代码；输出**零命中**本笔新增文件，属既有环境假红，非本笔引入；有依赖的 CI 环境为真值。 |
| `npx eslint scripts/quality-frontend-deps-gate.mjs test/b1-inline-var-syntax.test.mjs` | **PASS（exit 0）** | 两个改动 JS 文件定向 lint 零违规。 |
| `npm run check` 全量 / `test:all:workspace` | 未跑 | 按定向纪律，留给发布前 / CI；未验证范围如实说明。 |

## 第四部分：纪律边界

- 观感零代签、无 UI/视觉改动；未翻 `qualificationEligible`；未扩 G1 范围。
- 未碰 owner dev 实例 / 主工作区他方 WIP / 19 项未跟踪文件 / 兄弟 worktree；临时 symlink 与注入探针均已清除。
- 提交留本地，**未 push**（由 coordinator fetch 核实后亲自执行）。

## 第五部分：coordinator 补记 — WorkspaceFilePreview 存量重锚（2026-11-25）

worker 交付后按兴奋 msg_602bf9f8ef61 / msg_32555ffe46d7 裁决补齐：该存量债来自提交 `f5ef94165`「fix(workspace): 3D html 预览放行 allow-scripts 保 opaque origin（HTML-SANDBOX-A）」，727→731（+4 行）是**有正当理由的安全修复**，但该笔未重打基线才留存量红。按裁决「带提交号留因重锚」处置：

- `acceptance/block-92/size-baseline.json` 中 `frontend/src/pages/project-workspace/WorkspaceFilePreview.tsx` 条目：lines 727→731、bytes 34624→35060、sha256 → `def0075fb1874adfab9d3c4c11058d65a0f376e639ebd64e3f86cae2b748d444`（当前文件真值）。
- 仅改这一条，`total` 字段保持原值 86730（非 files 求和语义，不擅改）；其余 7 个集成文件重打不变。
- 复验：`node scripts/code-size-ledger.mjs --check` → **PASS v2**（台账 74 文件，基线 86730，生效例外 16，预算 700），exit 0。gate:code-size 红消除。
