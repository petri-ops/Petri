# BLOCK-7 UI-161 既有 in_progress 实机复核工作包（Vite-only + 静态 grep 验证路径）

**最后更新**：2026-08-16 22:00
**状态**：`active`（2026-08-16 21:55 用户裁决"Block-7 是啥 开搞" + 选项 "Vite-only + 静态 grep 验证（推荐）"）
**Plan ID**：`BLOCK-7-UI-161-VERIFICATION`

---

## 1. 决策与定位

按用户裁决启动 BLOCK-7，目标收口 UI-161 `in_progress`（按 audit 行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 verified"）。

**路径选择**——用户裁决 "Vite-only + 静态 grep 验证"（不同于 BLOCK-6 强行 dev Electron 实机失败）：
- **BLOCK-2 PHASE 3 跳过决策保留**（P1-T-A「Vite-only 跳过 dev Electron」仍生效）
- **UI-161 与 UI-157 / UI-158 / UI-159 关键区别**：UI-161 是**纯 UI 表面 + 静态 token 补全**（LeftPanel/QuickActions/SkillsSidebar 删除/pages/skills error 按钮/styles/custom.css 4 token），**不依赖 IPC 桥接通**。Vite preview 渲染 + 静态 grep 综合验证可证 UI-161 完整性。
- **关键证据**：UI-161 视觉证据（侧栏宽度复位 280px→0、QuickActions 位置、Sparkles icon 存在、error 返回首页按钮）可通过 Vite preview 渲染 + DOM grep + CSS 计算值间接验证；不需要 IPC 桥证据。

---

## 2. UI-161 6 项清理（已 commit `01c5e0b`，BLOCK-2 PHASE 2 已 5/5 PASS）

| # | 项 | 文件 | 验证方式 |
|---|---|---|---|
| 1 | LeftPanel.tsx QuickActions 加 Skills + sparkles icon | `frontend/src/components/workspace-panels/LeftPanel.tsx` L126-132 | grep `QuickActions.*Skills\|handleNavigateToSkills\|icon.*sparkles` |
| 2 | LeftPanel.tsx footer 删除 Skills 冗余 | `frontend/src/components/workspace-panels/LeftPanel.tsx` | grep 确认 footer 不再有 Skills |
| 3 | App.tsx 移除 `<SkillsSidebar>` + import + marginLeft | `frontend/src/App.tsx` | grep 确认无 SkillsSidebar import / JSX |
| 4 | 删除 SkillsSidebar.tsx + .module.css | `frontend/src/components/desktop/SkillsSidebar*` | `ls` 确认文件不存在 |
| 5 | pages/skills/index.tsx error 状态「返回首页」按钮 | `frontend/src/pages/skills/index.tsx` L101-118 | grep `handleReturnHome\|返回首页\|arrow-left` |
| 6 | styles/custom.css 4 token 补全 | `frontend/src/styles/custom.css` 行 74 83 85 86 + 暗色主题行 192 194 | grep `--biof3-accent-soft\|--biof3-border-color\|--biof3-font-mono\|--biof3-font-sans` |

PHASE 1 通过 grep 综合验证 6 项，确认 commit `01c5e0b` 以来**未被任何后续 commit 回退**（`git log 01c5e0b..HEAD -- <6 UI-161 文件>` 应为空）。

---

## 3. PHASE 划分

### PHASE 1：静态 grep 综合验证 6 项

- 1.1 grep `LeftPanel.tsx` QuickActions Skills + handleNavigateToSkills + sparkles
- 1.2 grep `App.tsx` 无 SkillsSidebar import / JSX
- 1.3 ls `frontend/src/components/desktop/SkillsSidebar*` 确认删除
- 1.4 grep `pages/skills/index.tsx` error 返回首页按钮
- 1.5 grep `styles/custom.css` 4 token 明色 + 暗色主题
- 1.6 git log 检查 6 UI-161 文件无回退（`01c5e0b..HEAD` 空）
- 1.7 tsc --noEmit + vitest run 全量核验（保留绿色）

### PHASE 2：Vite preview 渲染 + DOM 检查

- 2.1 vite build 产出 `frontend/dist/` SPA
- 2.2 vite preview 启动 3110 端口（避开 dev 3010 / electron 3000）
- 2.3 用 `curl` + `grep -oE` 检查产物 HTML 中无 SkillsSidebar 引用 + QuickActions 渲染 + 返回首页按钮渲染
- 2.4 检查产物 CSS 中 4 token 已被定义

### PHASE 3：theme-token-contract.test.ts 转绿验证

- 3.1 `cd frontend && npx vitest run src/styles/theme-token-contract.test.ts`（如有）
- 3.2 跑 `npm run test:changed:list` 看 UI-161 关联测试
- 3.3 tsc --noEmit 0 + ui:audit:check PASS

### PHASE 4：audit 收口 + closeout

- 4.1 更新 `docs/ui-productization-audit.md` UI-161 状态：`in_progress → verified`（**仅当 6 项全部 PASS**）
- 4.2 写 `docs/block-7-ui-161-verification-closeout.md` 报告（11 节）
- 4.3 4 canonical 文档同步
- 4.4 DOC-REGISTRY `active → completed` + 新增 CLOSEOUT reference entry
- 4.5 AUDIT-LOG 登记

---

## 4. 验收门禁

| # | 命令 | 必跑 |
|---|---|---|
| 1 | `npm run docs:check` | ✅ PHASE 4 commit 前 |
| 2 | `npm run ui:audit:check` | ✅ PHASE 4 commit 前 |
| 3 | `cd frontend && npx tsc --noEmit` | ✅ PHASE 1 + PHASE 4 |
| 4 | `npm run docs:reconcile` | ✅ PHASE 4 commit 前 |
| 5 | `cd frontend && npm run build && grep产物` | ✅ PHASE 2 |
| 6 | 静态 grep 6 项 | ✅ PHASE 1 |
| 7 | `git log 01c5e0b..HEAD -- <6 文件>` 空 | ✅ PHASE 1 |

---

## 5. 完成语义

- **UI-161 `in_progress → verified`**（仅当 6 项 grep + Vite preview + theme-token test 全部 PASS）
- 4 治理门 GREEN
- **不变量守住**：UI-157 仍 in_progress / UI-158/UI-159 仍 in_progress（仅 UI-161 verified）/ desktopBridge.ts 0 diff / electron.d.ts 0 diff / preload.js 5 方法签名不变 / 4 page 0 diff / core/shared-backend/* 0 diff / agent-tools/ 0 diff

---

## 6. 不外推

- 不外推 packaged / dist / notarization / Provider / P7 / GA
- 不外推 E1-d/E1-e G1+ 架构改动
- 不外推 release-pipeline dist staleness
- 不外推 i18n 资源抽离
- 不重新激活 BLOCK-2/BLOCK-3/BLOCK-4/BLOCK-5/BLOCK-6（均已 completed/superseded）
- 不动 preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/

---

## 7. 下一块候选

按 single work package serial 纪律，本工作包收口后 **不主动启动**新工作包。剩余 4 候选（用户已说"暂时不提"）：
- BLOCK-8 dist staleness（G1+ 红线）
- BLOCK-9 Windows 代码签名 / i18n
- BLOCK-10 E1-d/E1-e G1+ 架构改动
