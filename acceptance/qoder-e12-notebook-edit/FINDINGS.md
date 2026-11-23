# QODER-E12 Notebook 单元格编辑（2026-11-23，completed）

## 范围与裁决

用户发令「开始 E12 Notebook 单元格编辑」，评审稿范围=cell CRUD + 执行契约、零新依赖。P0 评审两待裁决项在默认口径内自主确定（非新裁决点）：
- **D1 cell 执行沙箱边界** = 复用 `workspace_exec` 既有审批门，不新建执行器、不改安全边界；
- **D2 是否复用现有编辑器** = 最小切片先工具层（cell CRUD/执行），前端 cell UI 不在本包。

零新依赖：ipynb 即 JSON，仅用 Node 内置 + 既有 workspace-tools internals。

## 交付

- **P1 纯函数** `core/petri-server/helpers/notebook-edit.js`：`parseNotebook`（source string|array 归一）/ `serializeNotebook` / `applyCellOp`（insert/update/delete，有界、幂等、不改其他 cell、sha 并发由 handler 层）/ `buildCellExecution`（python/R → 既有驱动，temp 落 `.petri-agent-tmp`，`approvalInherited:true`）。HK-01 `test/qoder-e12-notebook-edit.test.mjs` 红4→绿5。
- **P2 agent 工具 `notebook_edit`**：schema `tool-defs/notebook.js` 汇编入 `tool-defs.js`；handler `agent-tools/notebook-tools.js`（复用 `withWorkspace` + `resolveWorkspaceTarget`/`sha256`，真落盘 + expectedSha256 并发冲突 + dryRun）；registry `HANDLERS`/`CONTRACTS`（`workspace-write`/R2）；metadata `needsApproval:true/medium`；工具数 118→119。execute op 只返借道计划、不直接执行——审批门不绕过。
- **诚实降级**：无 Jupyter kernel 状态/%magic/富 MIME/真 execution_count；execute 只支持 python/R 文本驱动、stdout 回填，schema description 明示。

## 验证

- P1 纯函数 5/5 + handler 端到端 3/3（读/insert 落盘/sha 冲突/dryRun/execute 计划继承审批门）+ registry 三方互查 15/15（含工具数 119）+ 邻域 agent-tool/metadata/workspace-tools。
- 累计 Node 定向 **38/38**（`node-tests.txt`）；docs:check PASS(664) / ui-audit PASS / lint 0 error / tsc 0 / test:changed 0。
- 红线：未改产品 sandbox/CSP/凭据/B1 token/handler/pack 声明；零新依赖；观感零代签；不碰 G1+。

## 完成语义

E12 验收达成（cell CRUD + 执行契约），registry `QODER-YELLOW9-REOPEN` 中 E12 → completed；其余 7 项 queued 待逐项发令。

G0 开发期常态 · 不外推 packaged/Provider/GA。
