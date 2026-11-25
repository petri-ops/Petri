# BLOCK-518 能力渠道简化 · 证据（2026-11-25）

## HK-01 红绿先行

- 红：`node --test test/block518-capability-narrowing.test.mjs` → 11 fail（白名单、收窄、销账、角色门、零配置全红）。
- 绿：同命令 + `test/model-profile.test.mjs` + `test/block455-model-capabilities.test.mjs` + `test/block224-model-profile-normalize.test.mjs` + `test/ui638-vision-default.test.mjs` + `test/block155-chat-vision-inline.test.mjs` → **52/52 pass**。
- 前端红→绿：attachments（旧双位门矩阵）→ 始终放行 6/6；VisionRoleBinding（按能力过滤）→ 全模型候选 5/5；EndpointRowDetail（视觉/思考勾选）→ 隐藏 + 向量列/探测钮 7/7。前端定向合计 **31/31 pass**。

## 相邻与追加回归

- 相邻后端（file 凭据后端）：`thinking-level-injection` + `block454-p5-responses` + `block456-model-preferences` + `block201-config-transfer` → **39/39 pass**（注：无头环境默认 keychain 后端会在凭据提示处挂起，按既有 dev-infra 纪律显式 `PETRI_CREDENTIAL_BACKEND=file`）。
- Jev `test:suggest -- --supply=cloud` conf=0.99 追加：`conversation-compaction` + `history-assembly`（Node）+ `frontend/src/components/copilot/conversationRunStore.test.ts`（**50/50 pass**）。
- Jev `doc:suggest -- --supply=cloud`：planDoc suggested=true（0.72）+ frontend/src 台账硬规则命中 → 方案 §7 与 UI 台账同批登记（本文件所在批）。
- `npm run quality:types`：0 error。

## HMR 只读核对（owner dev 实例零触碰）

- 监听：vite PID 56574（:3000）、Electron PID 56602（CDP :9222）、后端 PID 56743（:3001）——核对前后不变，未 kill/重启任何进程。
- `curl http://localhost:3000/src/components/copilot/SimpleChat/attachments.ts` → 服务新源（含「声明面退役」标记）；`curl .../VisionRoleBinding.tsx` → 服务新源（`resolveModelCapabilities` 过滤已消失）。
- CDP 只读断言（/tmp/petri-hmr-readonly-check.cjs，无导航/点击/show）：`{"url":"http://localhost:3000/settings","readyState":"complete","oldVisionTogglePresent":false,"oldThinkingSelectPresent":false}`——owner 窗口无旧 UI 标记。
- 说明：owner 窗口当前停在 /settings 且渠道详情未展开，故逐列标签不在 DOM，按诚实边界不补拍形式化证据；Vite 新源 + 无旧标记 + 进程未变即本批 HMR 生效口径。

## 门禁（2026-11-25 收口）

- `npm run closeout`（file 凭据后端）链：audit:compact / hygiene / docs:check / ui:audit:check 全 PASS；fail-fast 停在 test:changed（本包可修红已逐条清掉，余下见下）。
- `test:changed` 终值 **1311 pass / 6 fail**，6 红全部非本包实现缺陷、如实归属：工具基线 118/120 族 4 条（block113 恒等红线 / block116 BK-04 / block157 KNW-1 / tool-activity-labels；HEAD 既有基线漂移，本包零触碰注册源码）；W5b useGuardAck ≤220 行 1 条（未触碰该 hook）；P6 stored verification `p6_current_source_tree_not_exact` 1 条（本包改了 P6 证据源集合内 4 文件，P6 重采属另一包且需静默仓，不在本包范围）。
- 静态门单跑：gate:user-assets / version-parity / silent-catch / css-modules / tracked-consistency（新测试入提交后） / quality:secret / arch / lint（0 error） / types / knip:check 全 PASS；gate:code-size 用 `scripts/code-size-ledger.mjs --write` 随本包重打 SimpleChat.tsx 指纹；gate:arch-cycles 报 HEAD 存量环 goal-tools→automation-store→registry（三源文件零触碰，不属本包）；gate:post-h9-contracts K-15 debt 29/15/14 计数漂移 2 红属存量文档口径，未触及。
- HK-01 的红→绿史、Jev 建议器读数与 output:judge 结论：见方案 §7 与 `npm run decision:report`。
