---
capability: refactor-candidates
goal: BLOCK-152 重构候选批——把三个在册重构候选落成根修复：①平台映射三副本收敛（deriveHostPlatform/currentPlatform/detectPlatform 三实现 → core 单源 + 既有锚测试守护）②hunk 级后端 stage（commitReview 按文件级 stage 的根改造——147 前端拦截是缓解，本批治本）③隧道 publicUrl 周期自探活（端到端 probe 喂徽标，468 留的方向）
acceptance:
  - 三项红绿先行：①一致性锚已绿（block149 锚测试），重构后同锚保绿 + 三消费方行为零回归；②hunk 级 stage 临时 git 仓行为测（混合 accept/未决文件的 index 内容断言）红→绿；③自探活 fetch mock 测试红→绿（probe 成功/失败/超时三态）
  - ①收敛形态取舍留痕：core/shared-backend 新单源模块；scripts 可 require core；src 侧若 arch 禁止 require core 则保留薄实现+锚测试守护（如实登记不硬拆）
  - ②后端 commitReview hunk 级语义：全 accept 文件=整文件 stage（现状保绿）；混合文件=按 hunk patch 精确 stage（git apply --cached）；前端 147 拦截保留为第二道防线不拆
  - ③probe 结果进 tunnel status()（probeState/probedAt 字段）+ MobileSync 徽标消费（probe 失败时即使 ≥15min 也不宣称公网可用——从紧）；自签 CA 依赖既有 NODE_EXTRA_CA_CERTS 链路
  - 定向门禁 + closeout 十一门（集成提交后）
reopen: src 侧薄实现合并（若本批证实 arch 允许则本波内做，不允许则维持锚守护形态）
status: active
---

# BLOCK-152 重构候选批（审视序列第 7 波·内功）

## 1. 背景

- 源头：三个在册重构候选——平台映射三副本（BLOCK-146 评审 P2-3/149 登记）、hunk 级 stage（BLOCK-147 plan §3 明言「另立批」）、publicUrl 自探活（BLOCK-149 非范围留痕）。
- 发令：用户「继续 按顺序都搞完」批量授权序列。
- 定位：内功根修复——三件都是「前几批治标、本批治本」的收尾。

## 2. 范围（三轨并行，文件面互斥）

| 轨 | 项 | 主文件 |
| --- | --- | --- |
| P 平台映射 | 三副本收敛：新 core/shared-backend/host-platform.js 单源（deriveHostPlatform+平台键集合）；capability-bundles 复用；scripts/build-r-bundle.mjs currentPlatform 改 require 单源；src/plugin/runtime.js detectPlatform 按 arch 判定（可 require 则收敛，否则薄实现+锚守护登记） | core/shared-backend/capability-bundles.js、scripts/build-r-bundle.mjs、src/plugin/runtime.js、src/plugin-schema.js（只读） |
| H hunk 级 stage | commitReview：按 decisions 把可 stage 面精确化——整文件 accept=git add；混合=构造 per-hunk patch git apply --cached；reject=不入 index（现状已对）；未决=不 stage（治本，前端拦截保留） | src/ipc/working-tree-review.js（commitReview :326-343 段）+ 临时仓行为测 |
| T 隧道自探活 | tunnel.js 周期 probe（如 60s 间隔，5s 超时，AbortController；401=活判定）→ status() 增 probeState/probedAt；MobileSync 徽标消费（probe ok+≥15min 才宣称；probe 失败降级「连接建立中」语义） | core/biof3-server/mobile-gateway/tunnel.js、frontend/.../MobileSync.tsx |

## 3. 非范围

- git 操作库引入（ADR-RS-3 禁令维持，用 git apply --cached spawn）；隧道连接管理逻辑本身；probe 多地址/多协议。

## 4. 实现形态

dynamic workflow 三轨并行 → 独立评审（P1 必修；H 轨重点审 patch 构造正确性）→ 统一门禁（红了即修 ≤2 轮）。工作流内不提交，主代理终审集成。

## 5. 验收与证据

红绿证据（H 临时仓断言/T mock 三态/P 锚保绿+消费方回归）+ 定向门禁 + closeout 十一门（集成后）；证据落 acceptance/block-152/；台账五件回写。

## 6. 风险与边界

- H 轨 patch 构造：hunk 上下文行取舍错一行为 index 与工作树静默分叉——用临时仓断言 index 内容（git show :file）而非仅退出码；git apply 失败 fail-closed 返回结构化错误。
- T 轨 probe 自环：probe 打公网门会过 nginx 回源本机——确认不与隧道清场逻辑互踩（remotePortSweep 已异步化）；probe 频率从保守（60s）起步。
- P 轨 src 侧 arch 红线以 quality:arch 实测为准。

## 7. 完成语义

三轨交付 + 评审 P1 清零 + 门禁绿 + 主代理集成提交 + closeout 十一门 PASS + 台账五件回写。收官后接 BLOCK-153 两 Goal 收口对账。
