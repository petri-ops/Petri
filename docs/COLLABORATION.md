# 协作约定（Collaboration Convention）

> 本仓库为**私有库、GitHub Free 计划**，无法用分支保护（branch protection）做技术强制。
> 因此以下约定靠**团队自觉 + 工具门禁**兜底，所有参与者（含 AI 辅助生成）必须遵守。

## 1. 分支策略
- 所有工作基于 `main` 开**短命分支**，完成后合回 `main` 即删。
- 命名约定：
  - `feat/<主题>`：新功能
  - `fix/<主题>`：缺陷修复
  - `chore/<主题>`：构建/依赖/杂务
  - `codex/<主题>`：AI（Codex 等）自动生成的分支，合入前必须人工复核
- 禁止在 `main` 上直接提交（见第 3 条）。

## 2. 合并前必须过门禁（本地先跑）
推送/提 PR 前，确保以下全绿（CI 也会跑，但本地先自查更快）：
```bash
npm run docs:check          # 文档治理（当前 43 篇）
npm run ui:audit:check      # UI 产品化审计（当前 102 个编号）
node --test <受影响的测试>   # 受影响测试（仓库用 Node 内置测试运行器，非 vitest）
```
> 注：`vitest` 仅在 `frontend/` 子项目；根仓库测试用 `node --test`。

## 3. 禁止对 main 强制推送 / 回溯
- **禁止** `git push --force` 到 `main` 或任何共享分支。
- 历史一旦合入 `main` 即视为不可变；如需修正，用新提交 revert，不要改写历史。
- 因为 Free 计划无法技术强制，这完全靠自觉。谁 force-push 了 main，视为严重事故。

## 4. 双机并行开发协调（Mac + Windows 同一人/两人）
本仓库常在**两台物理机（macOS / Windows）同时开发**，最易冲突的是「同一批文件被两边同时改」。
- 推之前先 `git fetch` 并确认远程分支/文件没有对方正在改的重叠区域。
- 原生依赖（electron / better-sqlite3 / node-pty 版本）的改动必须**串行**，不要两边同时升。
- 可参考项目内的 `parallel-dev-coordination` 技能做规划期护栏。

## 5. Node / Electron 版本一致性
- 开发机 Node 版本以根目录 `.nvmrc` 为准（当前声明 `24`）。
- **已知不一致（待修，见 Issue #8）**：Electron 仍是 30（内嵌 Node 20.16），与声明的 Node 24 不匹配。
  - 全新 clone 照 `.nvmrc=24` 会因原生模块 ABI 不匹配撞墙（"新人撞墙"陷阱）。
  - 升级到 Electron 41+（即跑步时真正到 Node 24）是独立工作包，未完成前请勿在文档外宣称"已在 Node 24"。
- 改动 Electron 主版本后，必须重编原生模块：**root / `core/r-server` / `core/py-server` 三处 `better-sqlite3` + `node-pty`**，且 r-server 那份须按 Electron 的 ABI（非系统 Node）重编。

## 6. 已知阻塞问题（立项跟踪）
- **Issue #7** 🔴 macOS 运行时 zip 404：新装 macOS 用户首次下载运行时失败（缺原始 zip + OSS 凭据，本机无外部输入）。
- **Issue #8** ⚠️ Node 24 已声明未落地：需升级 Electron 41+（依赖链 electron30→43 / builder24→26.15.3 / @electron/rebuild4.2.0 / node-pty1.1.0 / better-sqlite3 13.0.3，探针已过）。

## 7. 提交规范
- 提交信息用 Conventional Commits：`feat:` / `fix:` / `chore:` / `docs:` / `ui:` 等。
- UI 相关改动需在 `docs/ui-productization-audit.md` 登记对应编号并标注 `verified`（门禁会校验）。
