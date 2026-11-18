# BLOCK-474 / C-53 P5 性能与可信状态 — 证据（2026-11-18）

## 发令与范围
- 用户发令「开始 C-53 P5」（批2提示词 `docs/next-phase-e2e-prompt-2026-11-18-b2.md` S4/R12）；前序 S3（BLOCK-473 / P4）已收口。
- 范围=沿 P1/P2/P3/P4 先例新增独立静态扫描器，把可信态/性能机械承诺从既有真源复算为模型可读可复算契约；纯只读机械面，零 UI 运行时写面。
- 关键决策：**不改**四真源（`referencesStreaming.ts` / `references.ts` / `SimpleChatMessageRow.tsx` / `m4-sse-real-endpoint.test.mjs` / `ui-design-a11y.mjs`）——它们是零回归基线；只新增独立扫描器复用其符号/语义，避免基线漂移。

## HK-01 红绿
- RED（模块缺席）：`node --test test/c53-performance-trust.test.mjs` → `ERR_MODULE_NOT_FOUND: scripts/c53-performance-trust.mjs`（pass 0 / fail 1）。
- GREEN：`tests 11 / pass 11 / fail 0` —— ①快照/契约六组读数结构完整 ②逐读数现读一致（可复算）③流式投影可信态 ④memo 渲染边界 ⑤SSE 断线续传 ⑥加载空错误状态机 ⑦首屏占位 ⑧观感留槽零代签 ⑨manifest sha256 ⑩篡改负测 fail-closed ⑪P0–P4 + B466/B154/M55 零回归。

## 现读产物
- `resources/design-context/performance-trust.json`：六组读数——
  - **streamingProjection**：streaming 分支强制 pending + compose→pending 替换 + completed 升级 + 纯 content 投影 + 嵌套 JSON 前缀判据在场；`references-streaming.test.ts` 现读 8 条契约 it（下限 8）。
  - **memoBoundary**：`React.memo` 在场 + bail-out / 身份击穿 / 回调身份三条契约 it（现读 3，下限 3）。
  - **sseResume**：M55 afterSeq 续传 / [DONE] 哨兵 / 跨 chunk 归并 / ping 透明 / 终态顺序 / 缺哨兵负测六类契约在场（现读 7 条 test，下限 6），`parseSseStream` 纯函数在场。
  - **trustStateMachine**：复用 `STATE_MATRIX` 的 loading/empty/error × 4 kinds = 12 格判据完整；TSX 全源现读 role=alert/status / aria-busy / aria-live 证据逐项 >0；全矩阵 32 格。
  - **renderSkeleton**：`compose-stream-pending` 占位接线在场 + partial 占位 / 完整仍占位 / 纯文本快路径 / 围栏豁免四条契约 it（现读 4，下限 4）。
  - **humanEyeSlots**：`humanEyeSigned=false` / `status=in_progress` / 2 条观感槽清单 / `readOnly=true`——pending_human_eye 零代签。
- `scripts/c53-performance-trust.mjs`：`collectPerformanceTrust`/`scanStreamingProjection`/`scanMemoBoundary`/`scanSseResume`/`scanTrustStateMachine`/`scanRenderSkeleton`/`validatePerformanceTrustIntegrity` 纯函数 + `--check`（不写盘）；契约 sha 由生成器自身维护 manifest（沿 P1–P4 先例）。
- `--check` PASS（readingIds=6，streamingIts=8，memoIts=3，sseTests=7，trustCells=12，skeletonIts=4）。

## 边界与零回归
- P0 `test/c53-design-context-pack.test.mjs` + P2 `test/c53-ia-map.test.mjs` + P3 `test/c53-visual-consistency.test.mjs` + P4 `test/c53-responsive-a11y.test.mjs` + M55 `test/m4-sse-real-endpoint.test.mjs` Node 侧 42/42 零回归。
- 前端三真源 `references-streaming.test.ts`(8) + `GenUiMessageContent.streaming.test.tsx`(4) + `SimpleChatMessageRow.test.tsx`(3) = 15/15 零回归。
- 观感零代签：本包无 pending_human_eye 写面（资源 JSON+脚本+测试非用户 UI 写面）；UI-706/707/709/710 + E 类 22 条保持 in_progress，不冒充 verified。
- 零产品代码/CSS/组件/运行时写面/新依赖；design-charter 冻结项零触碰；用户 untracked 资产零触碰。

G0 开发期常态 · 不外推 packaged/Provider/GA。
