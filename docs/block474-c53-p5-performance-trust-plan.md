---
capability: block474-c53-p5-performance-trust
status: completed
kind: work-package
truthDomain: block474-c53-p5-performance-trust
entrypoint: docs/README.md
goal: C-53 UI-DESIGN-QUALITY 的 P5（性能与可信状态）——沿 P1/P2/P3/P4 先例新增独立静态扫描器，把可信态/性能机械承诺从既有真源（BLOCK-154 memo 边界 + BLOCK-466 流式投影 + M55 SSE 续传 + STATE_MATRIX 加载/空/错误态）复算为六组模型可读可复算读数（流式投影可信态 / memo 渲染边界 / SSE 断线续传 / 加载空错误流式状态机 / 首屏占位 / 观感留槽），消费测试锚定；纯只读机械面，零 UI 运行时写面、零观感代签
acceptance:
  - HK-01 红绿先行：消费测试先红（扫描器/快照缺席）后绿；含篡改负测 fail-closed
  - 可信态契约可复算：collectPerformanceTrust(root) 从 canonical 真源机械派生，落 resources/design-context/performance-trust.json；--check 重算与落盘逐读数一致（忽略易变字段）；生成器自身维护 manifest sha256
  - 流式投影可信态：从 referencesStreaming.ts + references.ts 现读 projectStreamingCompose 的 streaming 分支强制 pending 语义、compose→pending 替换、completed 升级路径；符号/语义缺失必红；引用了 references-streaming.test.ts 的 8 条契约计数
  - memo 渲染边界：从 SimpleChatMessageRow.tsx + test.tsx 现读 React.memo 在场 + 三条 memo 契约 it（bail-out / 身份击穿 / 回调身份）在场；缺失必红
  - SSE 断线续传：从 m4-sse-real-endpoint.test.mjs + lib-sse-frames.mjs 现读 afterSeq 续传 / [DONE] 哨兵 / 跨 chunk 归并 / ping 心跳四类契约 in 册；缺失必红
  - 可信态状态机：复用 ui-design-a11y.mjs STATE_MATRIX 的 loading/empty/error 12 格判据（aria-busy-or-status / role-alert-or-status / empty-copy-or-placeholder）+ 现读 role=alert/status/aria-busy 证据逐项 >0；空格/证据缺失必红
  - 首屏占位：从 GenUiMessageContent.streaming.test.tsx 现读 compose-stream-pending 占位 + partial/完整仍占位/纯文本快路径/围栏豁免四条接线契约在场；缺失必红
  - 观感零代签：动画/加载视觉观感 pending_human_eye 保持 in_progress，签字槽留用户；本包纯资源 JSON+脚本+测试，无 pending_human_eye 写面
  - 零新增产品依赖、零 UI 运行时写面；复用 B466 流式(8)/B154 memo(3)/M55 SSE(7) 零回归；closeout 定向门禁全绿 + impact-map 登记 + 六件套回写
---

# BLOCK-474 · C-53 P5 性能与可信状态（completed / P5-LAUNCH→CLOSED）

> **发令**：用户 2026-11-18 发令「开始 C-53 P5」——承接批2提示词 `docs/next-phase-e2e-prompt-2026-11-18-b2.md` S4 / R12，前序 S3（BLOCK-473 / C-53 P4）已收口。
> **从属**：`docs/petri-master-charter.md` + AUDIT-LOG C-53 权威阶段（P0 基线冻结→P1 上下文包硬化→P2 IA→P3 视觉一致性→P4 响应式 a11y→P5 性能与可信状态→P6 产品 Skill v1.1→P7 人眼收口）+ BLOCK-465/471/472/473 已完成。

## 1. 范围（scope）

1. **静态扫描器**：新增 `scripts/c53-performance-trust.mjs`——纯函数 `collectPerformanceTrust(root)` 从 canonical 真源机械复算六组读数，落 `resources/design-context/performance-trust.json`（沿 P1/P2/P3/P4 design-context 先例，生成器自身维护 manifest sha256）：
   - **streamingProjection**：`referencesStreaming.ts` 现读 `projectStreamingCompose` streaming 分支强制 pending + compose→pending 替换 + completed 升级 + 纯函数 content 投影语义；`references.ts` 现读 `projectGenUiReferences` / `isComposeJsonPrefix` / `{ kind: 'pending' }`；`references-streaming.test.ts` 8 条 it 计数在场。
   - **memoBoundary**：`SimpleChatMessageRow.tsx` 现读 `React.memo` + `SimpleChatMessageRow.test.tsx` 三条 memo 契约 it（bail-out / m 身份击穿 / 回调身份）；缺失必红。
   - **sseResume**：`m4-sse-real-endpoint.test.mjs` 现读 M55-1~6 契约（[DONE] 哨兵 / 跨 chunk 归并 / ping 透明 / afterSeq 续传 / 终态顺序 / 缺哨兵负测）；`lib-sse-frames.mjs` 现读 `parseSseStream` 纯函数；计数在场。
   - **trustStateMachine**：复用 `ui-design-a11y.mjs` `STATE_MATRIX` 的 loading/empty/error × 4 kinds = 12 格判据完整；TSX 全源现读 `role=alert/status` / `aria-busy` / `aria-live` 证据逐项 >0。
   - **renderSkeleton**：`GenUiMessageContent.streaming.test.tsx` 现读 `compose-stream-pending` 占位接线 + 4 条契约 it（partial 占位 / 完整仍占位 / 纯文本快路径 / 围栏豁免）；`GenUiMessageContent.tsx` 现读占位渲染分支在场。
   - **humanEyeSlots**：动画观感 / 加载视觉 pending_human_eye 保持 in_progress，签字槽留用户；本包零观感写面如实登记。
2. **消费测试**：`test/c53-performance-trust.test.mjs`——可复算（现读 vs 落盘逐读数深等）、六组读数断言、篡改负测（符号/证据/哈希清零、结构破坏）fail-closed、P0/P1/P2/P3/P4 包零回归；HK-01 红→绿留痕。

## 2. 非范围（exclusions）

- CSS/组件/路由/任何运行时写面、观感签字（pending_human_eye 零代签）、design-charter 冻结档位/预算变更；
- 改 `referencesStreaming.ts` / `references.ts` / `SimpleChatMessageRow.tsx` / `m4-sse-real-endpoint.test.mjs` / `ui-design-a11y.mjs` 等真源（它们是零回归基线，只读复算，不改断言/实现）；
- 改 `theme-token-contract.test.ts`（19 断言数被 P0 快照锚定）；
- C-53 P6–P7（Skill v1.1/人眼收口）；新产品 Skill；用户 untracked 资产零触碰；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：`node --test test/c53-performance-trust.test.mjs` 先红（模块/快照缺席）后绿。
- **G2 可复算**：`node scripts/c53-performance-trust.mjs --check` 重算通过；六组读数与落盘一致；manifest sha256 一致。
- **G3 零回归**：P0 `test/c53-design-context-pack.test.mjs` + P2 `test/c53-ia-map.test.mjs` + P3 `test/c53-visual-consistency.test.mjs` + P4 `test/c53-responsive-a11y.test.mjs` 零回归；B466 `references-streaming.test.ts`(8) + B154 `SimpleChatMessageRow.test.tsx`(3) + M55 `m4-sse-real-endpoint.test.mjs`(7) 零回归；docs:check/ui:audit:check 绿；零新增依赖。
- **G4 治理**：closeout 定向门 + impact-map 登记 + 六件套回写。

## 4. 完成语义

G1–G4 全绿或明确 external-blocked + 六件套回写 + 证据落 `acceptance/block474-c53-p5-performance-trust/`。本包无观感写面（资源 JSON+脚本+测试均非用户 UI 写面），如实登记；不冒充任何 pending_human_eye 项 verified。

## 5. 立项真值摸底（2026-11-18，HK-01 前）

| 读数 | 现读预期 | 真源 |
| --- | --- | --- |
| 流式投影 | projectStreamingCompose + pending 替换 + completed 升级在场，8 条 it | `referencesStreaming.ts` / `references.ts` / `references-streaming.test.ts` |
| memo 边界 | React.memo + 3 条 memo 契约 it | `SimpleChatMessageRow.tsx` / `.test.tsx` |
| SSE 续传 | M55-1~6 契约 + parseSseStream 在场 | `m4-sse-real-endpoint.test.mjs` / `lib-sse-frames.mjs` |
| 可信态状态机 | loading/empty/error 12 格 + alert/status/busy 证据 >0 | `ui-design-a11y.mjs` STATE_MATRIX + TSX 全源 |
| 首屏占位 | compose-stream-pending + 4 条接线 it | `GenUiMessageContent.streaming.test.tsx` / `.tsx` |
| 观感留槽 | pending_human_eye 保持 in_progress | UI 台账 UI-706/707/709/710 + E 类 22 条 |

## 6. 收口记录（2026-11-18）

HK-01 红→绿 11/11（扫描器模块缺席 ERR_MODULE_NOT_FOUND → 11/11）；`--check` PASS（readingIds=6，streamingIts=8 / memoIts=3 / sseTests=7 / trustCells=12 / skeletonIts=4）；performance-trust.json 六组读数（流式投影 pending 强制+compose→pending 替换+completed 升级+纯 content 投影 / memo 边界 React.memo+3 契约 it / SSE 六契约+parseSseStream 纯函数 / 加载空错误 12 格+alert/status/busy 证据>0 / 首屏占位 compose-stream-pending+4 接线 it / 观感留槽 in_progress 零代签）；P0/P1/P2/P3/P4 消费测试 + M55 Node 侧 42/42 零回归、B466(8)+首屏(4)+B154 memo(3) 前端 15/15 零回归；docs:check/ui:audit/hygiene 绿；零 UI 运行时写面/观感代签/新依赖。证据=acceptance/block474-c53-p5-performance-trust/。C-53 P6–P7 待后续发令。

## 7. 收口门禁归属（2026-11-18）

- `quality:perf` packaged_start 继承抖动（G0 噪声，在册）——本批零 perf 运行时面改动（纯资源/脚本/测试），归属既有基线，不属本包，不重打基线；closeout 以 `--skip=quality:perf` 如实标 SKIPPED（不算 PASS）。
- `test-affected.test.mjs:90` 的 block464/block470 evidence gap = HEAD 既有映射盲区（提示词 §1 已预告"本批不碰"）；按 P2/P3/P4 先例先 commit 再 closeout，diff 干净后两既有红不入范围。非本包新代码红，不篡改基线、不伪称通过。

G0 开发期常态 · 不外推 packaged/Provider/GA。
