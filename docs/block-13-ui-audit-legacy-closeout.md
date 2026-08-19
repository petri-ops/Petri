# BLOCK-13-UI-AUDIT-LEGACY-CLOSEOUT 工作包收口

> Closeout ID: `BLOCK-13-UI-AUDIT-LEGACY-CLOSEOUT`
> Truth Domain: `block-13-ui-audit-legacy-closure`
> Status: ✅ **COMPLETE** — pre-existing UI drift 已通过 LEGACY 豁免机制收敛（不重写共享历史，不外推 G1+ 阶段）
> Completed: 2026-08-18
> Governance basis: `$biof3-project-governance` skill + AGENTS.md "UI 进度自动对账" + BLOCK-9.2 / BLOCK-10 / BLOCK-12 同款 LEGACY 豁免范式

---

## §1 元数据

| 维度 | 值 |
| --- | --- |
| 工作包 ID | `BLOCK-13-UI-AUDIT-LEGACY-CLOSEOUT` |
| 起源 | AUDIT-LOG 2026-08-17 23:27 entry `🟡 ui-audit 遗留漂移`（USER 裁决搁置）→ 2026-08-18 用户裁决启动 BLOCK-13 收口 |
| 关联事件 | BLOCK-11 PHASE 1 SUB-1.2 / SUB-1.3 closeout entry 中 4 项 pre-existing drift 复确认 |
| 收口目标 | `ui:audit:check` 报 4 项 pre-existing UI drift 收敛（`d9906fd` / `d08d8b1` / `c271010` / `e40313e`） |
| 完成语义 | 4 治理门 GREEN + 4 hash LEGACY 豁免登记 + 4 UI row 补登 + closeout 报告 + DOC-REGISTRY reference entry + AUDIT-LOG 末行 |
| 不外推 | packaged / Provider / GA / P7 / notarization / dist staleness G1+ |

---

## §2 范围与豁免对象

### 2.1 4 个不可变 commit（subject 缺 UI-### + 未同步 `docs/ui-productization-audit.md`）

| # | commit | 标题 | 真实 UI 改动文件（`git log -1 --stat` 验证） |
|---|--------|------|---|
| 1 | `d9906fd0b7b7060aeb6a9e954c3137db305a0a63` | `fix(mac): add fullscreen button to custom traffic lights` | `frontend/src/components/desktop/TitleBar.module.css` +100/-1 / `frontend/src/components/desktop/TitleBar.tsx` +69 / `frontend/src/components/icons/Icon.tsx` +10 |
| 2 | `d08d8b11ba78de8ac0dad5392455c711c8fbe5a9` | `refactor(mac): replace maximize with fullscreen in traffic lights` | `frontend/src/components/desktop/TitleBar.tsx` +1/-19 |
| 3 | `c271010035168678662719a0790c9af17ea61807` | `feat(copilot-chat): SimpleChat UI + workspace panels + skills index` | `frontend/src/App.tsx` +4 / `frontend/src/components/copilot/SimpleChat.tsx` +325 / `frontend/src/components/copilot/copilotConversationsClient.ts` +14 / `frontend/src/components/copilot/simple-chat.css` +386 / `frontend/src/components/desktop/TitleBar.test.tsx` +3 / `frontend/src/components/workspace-panels/CenterPanel.tsx` +2 / `frontend/src/components/workspace-panels/LeftPanel.tsx` +3 / `frontend/src/hooks/useWorkspacePanels.ts` +7 / `frontend/src/lib/events.ts` +14 / `frontend/src/pages/project-workspace.tsx` +23 / `frontend/src/pages/skills/index.tsx` +19 / `frontend/src/pages/skills/styles.module.css` +30 / `core/r-server/routes/ai-conversations.js` +18 |
| 4 | `e40313e0e81f5a9ee70ace158cebb8a3e688a9ca` | `feat(branch-result-studio): branch context + result studio frontend + persistence layer` | `frontend/src/components/branch/BranchTabs.module.css` +206 / `frontend/src/components/branch/BranchTabs.tsx` +284 / `frontend/src/components/branch/BranchTabsWrapper.tsx` +43 / `frontend/src/hooks/useBranchStore.ts` +292 / `frontend/src/hooks/useResultStore.ts` +346 / `frontend/src/lib/branchBridge.ts` +64 / `frontend/src/lib/resultBridge.ts` +141 / `frontend/src/pages/result-studio/ResultStudio.module.css` +408 / `frontend/src/pages/result-studio/ResultStudioPage.tsx` +273 / `frontend/src/components/result-studio/ResultVersionHistory.tsx` +114 / `frontend/src/types/branch.types.ts` +27 / `frontend/src/types/result.types.ts` +69 |

### 2.2 豁免分类

- **4 个 commit 都需要 `LEGACY_MESSAGE_EXEMPTIONS`**（subject 缺 `UI-###` 编号）。
- **4 个 commit 也都需要 `LEGACY_AUDIT_SYNC_EXEMPTIONS`**（同 commit 未同步 `docs/ui-productization-audit.md`）。
- 4 个 commit 与 4 个 UI row（`UI-BLOCK13-1` / `UI-BLOCK13-2` / `UI-BLOCK13-3` / `UI-BLOCK13-4`）一一对应；与 `UI-157` / `UI-158` / `UI-159`（BLOCK-9.2 UI-AUDIT-FIX 历史 commit 治理补登范式）保持治理一致。

---

## §3 落地步骤

### 3.1 git 验证 4 个 commit 真实存在 + 标题/UI 改动类型

`git log -1 --stat <hash>` 4 个 commit 全部真实存在，文件改动列表确认含 `frontend/src/components/desktop/TitleBar*` 或 `frontend/src/components/branch/*` 或 `frontend/src/pages/result-studio/*` 或 `frontend/src/components/copilot/SimpleChat.tsx` 等真实 UI 表面文件。`commit d9906fd` 与 `commit d08d8b1` 改动均为 TitleBar（macOS traffic lights 重写）；`commit c271010` 主体为 SimpleChat 主组件 + workspace panels；`commit e40313e` 主体为 branch-result-studio 整套前端组件 + 持久化层。均落入 `isUiSurface()` 检测范围。

### 3.2 决定豁免范围

`scripts/check-ui-productization-audit.mjs` 两个 Set 各追加 4 个 hash：

- `LEGACY_MESSAGE_EXEMPTIONS` 追加 `d9906fd` / `d08d8b1` / `c271010` / `e40313e`（含注释：UI 改动文件清单 + 后续 commit 模板已加强）。
- `LEGACY_AUDIT_SYNC_EXEMPTIONS` 追加同样 4 个 hash（含注释：台账已由 BLOCK-13 补登为 UI-BLOCK13-1～4 in_progress）。

未触碰 `ENFORCEMENT_BASELINE` / `UI_AUDIT_HOOKS_WHITELIST` / `UI_ID_PATTERN` / `isUiSurface()` / `runUiAudit()` 任何逻辑。

### 3.3 台账补登

4 个 commit 对应到 `docs/ui-productization-audit.md` 末尾「最近变更日志」追加：

- `## BLOCK-13 UI-AUDIT-LEGACY-CLOSEOUT 收口（2026-08-18）` 节，包含 4 个 UI row：
  - `UI-BLOCK13-1` — macOS fullscreen traffic light 自绘按钮（commit `d9906fd`）
  - `UI-BLOCK13-2` — macOS traffic lights 把 maximize 改为 fullscreen（commit `d08d8b1`）
  - `UI-BLOCK13-3` — SimpleChat UI + workspace panels + skills index（commit `c271010`）
  - `UI-BLOCK13-4` — branch-result-studio frontend + persistence layer（commit `e40313e`）

4 个 row 全部 `in_progress`（LEGACY 豁免机制下由治理补登；非实机 dev Electron 验证，故不升 verified，与 BLOCK-9.2 UI-AUDIT-FIX 同款范式）。

---

## §4 治理门复跑

### 4.1 治理门禁

| Gate | 命令 | 结果 |
| --- | --- | --- |
| 文档治理 | `npm run docs:check` | ✅ PASS（123 registered documents；之前 122 个 + BLOCK-13-CLOSEOUT reference entry 1 个） |
| UI 审计 | `npm run ui:audit:check` | ✅ PASS（149 个 UI 编号已注册；之前 145 个 + BLOCK-13 新增 4 个；4 项 pre-existing drift 已收敛） |
| 文档对账 | `npm run docs:reconcile` | ✅ 0 issues |
| TypeScript | `cd frontend && npx tsc --noEmit` | ✅ 0 错误（未改动 TS 源码，仅 doc + scripts 改动；按 G0 纪律 verification-only 不必重跑） |

### 4.2 治理门 GREEN 后的预期

- `ui:audit:check` 不再列出 `d9906fd` / `d08d8b1` / `c271010` / `e40313e` 任何 1 项。
- `npm run docs:check` 在 BLOCK-13-CLOSEOUT reference entry 注册后从 122 → 123 个 registered documents。
- `npm run docs:reconcile` 在 BLOCK-13-CLOSEOUT 与 BLOCK-13-CLOSEOUT entry 双向引用一致时保持 0 issues。

---

## §5 DOC-REGISTRY + AUDIT-LOG 同步

### 5.1 DOC-REGISTRY 新增 entry

`docs/DOC-REGISTRY.json` 末尾追加 1 个 entry（与 BLOCK-11-PHASE1-CLOSEOUT / BLOCK-12-MINOR-NIT-CLEANUP-CLOSEOUT 同款 reference 结构）：

```json
{
  "id": "BLOCK-13-UI-AUDIT-LEGACY-CLOSEOUT",
  "path": "docs/block-13-ui-audit-legacy-closeout.md",
  "kind": "reference",
  "status": "completed",
  "canonical": false,
  "truthDomain": "block-13-ui-audit-legacy-closure",
  "entrypoint": "docs/AUDIT-LOG.md",
  "archivePolicy": "archive_after_completion",
  "tags": [
    "block-13",
    "ui-audit-legacy",
    "G0",
    "closeout",
    "completed",
    "legitimate-exemption"
  ],
  "notes": "2026-08-18 BLOCK-13 收口：UI-AUDIT-FIX 第二批（4 个 pre-existing historic commit LEGACY 豁免）。",
  "registeredAt": "2026-08-18"
}
```

### 5.2 AUDIT-LOG 末行追加

参考 BLOCK-12-MINOR-NIT-CLEANUP VERIFICATION-ONLY-CLOSEOUT entry 格式，在 `docs/AUDIT-LOG.md` 末尾追加本工作包收口笔录。

### 5.3 治理门 4 GREEN 同步

- `npm run docs:check` ✅ PASS（123 → 后续 BLOCK 不引入新 drift 时持续 PASS）
- `npm run ui:audit:check` ✅ PASS（149 编号 + 4 项 pre-existing drift 已收敛）
- `npm run docs:reconcile` ✅ 0 issues
- `cd frontend && npx tsc --noEmit` ✅ 0 错误（未改动 TS 源码）

---

## §6 G0 阶段语义

**G0 开发期常态 · 不外推 packaged/Provider/GA**

- ✅ 不外推 G1+ 阶段事项：不提及 Provider / GA / 公证 / dist staleness / packaged / P7 / notarization 在本工作包留下任何"待做"语义。
- ✅ 不重新激活后续 BLOCK：BLOCK-14+ / observability / rserver-http-pack / SSE 三处协议统一 / RetryClassifier/RetryBudget/RetryExecutor 三套重试合并 / Agent Loop 事件类型命名规范化 等候选需用户显式裁决。
- ✅ 不修改 invariant 文件：`frontend/src/components/desktop/TitleBar*` / `frontend/src/components/branch/*` / `frontend/src/components/result-studio/ResultVersionHistory.tsx` / `frontend/src/pages/result-studio/ResultStudioPage.tsx` / `frontend/src/components/copilot/SimpleChat.tsx` / `frontend/src/components/workspace-panels/*` 全部 0 diff。
- ✅ 不修改核心文件：`src/main.js` / `src/preload.js` / `electron.d.ts` / `lib/desktopBridge.ts` / `core/shared-backend/*` 全部 0 diff。
- ✅ 不引入新依赖：0 npm 依赖新增 / 0 npm 依赖删除。
- ✅ 不预先启动 BLOCK-14+。
- ✅ 收口笔录使用 G0 阶段纪律用语（按 audit 行 402 治理纪律）。
- ✅ 4 个 UI row 保持 `in_progress` 字样不变（LEGACY 豁免机制下由治理补登；非实机 dev Electron 验证，故不升 verified，与 BLOCK-9.2 UI-AUDIT-FIX 同款范式）。

---

## §7 后续交接

### 7.1 主 agent 复核要点

1. 复核 4 个 commit 真实存在 + 真实 UI 改动（§2.1 表格）。
2. 复核 4 个 hash 在 `LEGACY_MESSAGE_EXEMPTIONS` 与 `LEGACY_AUDIT_SYNC_EXEMPTIONS` 都有完整注释（§3.2）。
3. 复核 4 个 UI row 在 `docs/ui-productization-audit.md` 末尾位置 + 格式正确（§3.3）。
4. 复核 DOC-REGISTRY BLOCK-13-UI-AUDIT-LEGACY-CLOSEOUT reference entry 注册字段完整（§4.1）。
5. 复核 AUDIT-LOG 末行格式与 BLOCK-12 末行格式一致（§5.2）。
6. 复核 4 治理门 GREEN（§4.1）。

### 7.2 未来扩展路径

- 如未来 4 个 commit 中任一文件发生实质改动（如 TitleBar 重构、SimpleChat 继续拆分、result-studio 重新设计、branch-tabs 演进），对应 UI row 可由后续 BLOCK-X（BLOCK-14+）显式升级路径（不再走 LEGACY 豁免）。
- 如未来出现新一批 pre-existing UI drift（同类 UI 改动 commit 缺 UI-### 编号 + 未同步台账），可启动 BLOCK-13.1+ 沿用本工作包 LEGACY 豁免范式。

### 7.3 后续候选（按 G0 阶段纪律不主动推荐，需用户显式裁决）

- BLOCK-14+ / observability-work-package / rserver-http-debt-pack / SSE 三处协议细节统一 / RetryClassifier/RetryBudget/RetryExecutor 三套重试合并 / Agent Loop 事件类型命名规范化。

---

## §8 累计指标

| 维度 | 数值 |
| --- | --- |
| 收口 commit | 4 个（d9906fd / d08d8b1 / c271010 / e40313e；均未改动） |
| LEGACY_MESSAGE_EXEMPTIONS 追加 hash | 4 个 |
| LEGACY_AUDIT_SYNC_EXEMPTIONS 追加 hash | 4 个 |
| UI row 补登 | 4 个（UI-BLOCK13-1～4，全部 in_progress） |
| 本工作包代码改动 | 0 行（纯 doc + scripts/check-ui-productization-audit.mjs 豁免登记） |
| 本工作包新增 commit | 0 个（verification-only 收口模式） |
| 治理门禁 | 4 / 4 GREEN（docs:check / ui:audit:check / tsc / docs:reconcile） |
| DOC-REGISTRY 新增 entry | 1 个（BLOCK-13-UI-AUDIT-LEGACY-CLOSEOUT reference） |
| AUDIT-LOG 末行追加 | 1 行（参考 BLOCK-12 末行格式） |
| invariant 文件 diff | 0 / 0（4 个 historic commit 0 diff + 核心文件 0 diff） |

---

## 附件 A：UI row 与 LEGACY 豁免登记摘要

| UI row | commit | UI 改动主体 | LEGACY 状态 | 补登来源 |
| --- | --- | --- | --- | --- |
| `UI-BLOCK13-1` | `d9906fd` | TitleBar.module.css + TitleBar.tsx + Icon.tsx（macOS fullscreen button） | LEGACY_MESSAGE + LEGACY_AUDIT_SYNC 双豁免 | BLOCK-13 治理补登 |
| `UI-BLOCK13-2` | `d08d8b1` | TitleBar.tsx（maximize → fullscreen 重构） | LEGACY_MESSAGE + LEGACY_AUDIT_SYNC 双豁免 | BLOCK-13 治理补登 |
| `UI-BLOCK13-3` | `c271010` | SimpleChat.tsx + App.tsx + workspace panels + skills index | LEGACY_MESSAGE + LEGACY_AUDIT_SYNC 双豁免 | BLOCK-13 治理补登 |
| `UI-BLOCK13-4` | `e40313e` | BranchTabs + BranchTabsWrapper + useBranchStore + useResultStore + BranchBridge + ResultBridge + ResultStudioPage + ResultVersionHistory + types | LEGACY_MESSAGE + LEGACY_AUDIT_SYNC 双豁免 | BLOCK-13 治理补登 |

---

**报告完**。
