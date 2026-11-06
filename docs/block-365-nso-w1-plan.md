---
capability: block-365-nso-w1-agent-resilience
status: completed
goal: NSO-W1 Agent 主链韧性与错误可见性——接收会话起始在制批并兑现 W0 干净树出口，然后让流中断、上下文增长、压缩、降级、最终整理失败都给出确定、可见、可恢复的行为。
acceptance:
  - 首切片：在制批（22 修改 + 3 新契约测试）逐文件审读、其测试与影响面测试绿、lint/types 0 error、model-surface 基线显式重打留因（993→1083）、显式路径提交；P6 源绑定重算（观测数据原样保留）
  - F-01 errorsAsRejections 经 llm-client → ModelGateway → provider 全链透传，流中 RST 触发整轮网络重试（本地 SSE RST 集成测试）
  - F-02 上下文预算每轮估算、每轮 token_budget 事件、trim 幂等（连续两轮增长再次修剪的行为测试）
  - F-03 resolveCompactionMode 单源 + maxOutput 透传 + 四种 flag 组合矩阵；F-14 compaction_failed 事件 + 增量摘要输入有界
  - F-15 trimmer 返回真实 dropped 集，摘要 note 仅在摘要非空时注入；F-16 降级分类单源，不可降级优先（cancelled+timeout / 401+api_error / 多绑定上界负测）
  - SSE 收尾 error/done/task.failed 契约；首 token stall 重试带 agent_status(provider_retry)
  - 证据落 acceptance/nso-2026-11-06/wave-1/；真实 provider 长任务（T7 自然窗口）视环境与成本如实标注
reopen: 范围变化或撞五类停止条件时由用户重新发令
---

# BLOCK-365 · NSO-W1 Agent 主链韧性与错误可见性

> 蓝图依据：§4（W1）+ 评估 F-01/F-02/F-03/F-14/F-15/F-16。授权：用户 2026-11-06「行 … 把剩下没做的统一搞完」（对上一轮唯一阻塞问题「能否授权接收在制批」的答复）。

## 非范围

- 用户资产与临时目录（assets/、model3d/、petri-logo*、tmp-*、docs/pelican-bicycle.html）不在授权内，零触碰
- 并发写入者 UI-696 批（模型偏好 UI，11 项）零触碰
- 不新增依赖；不建第二重试/降级决策面

## 进度

- ✅ 首切片接收在制批（`46bdd0c7`）：24 文件原样落地，在制批测试 80/80，model-surface 有意增长 993→1083（+90，唯一增长项）。
- ⏸ P6 源绑定重算推迟：P6 源文件集合含 `frontend/src/components/copilot/SimpleChat.tsx`，并发写入者 UI-696 正在改它——在其落地前 P6 当前树校验恒红；UI-696 落地后一次性重算（覆盖本提交与 UI-696 两轮源变更），避免两次重打。
- ✅ F-01 errorsAsRejections 全链透传（`95c242ad`）：真实本地 SSE 服务器 + 真实 DeepSeekProvider + 真实 ModelGateway 5/5，含上层整轮重试实证。
- ✅ F-02 / F-15 / F-14 / F-16（`73cdeb5e`）：每轮重估 + 滞回防抖、trimmer 真实 dropped + 活动轮兜底 + 无不实声明、compaction_failed + 增量摘要、降级分类硬不可降级优先；34/34（context-breaker 存量红随修）。
- ✅ F-03 + 重试可观测（`4ee6f4d7`）：resolveCompactionMode 单源（修 B2 屏蔽 resilience）；provider_retry → agent_status 投影。

## 收口（2026-11-06）

- **completed（带例外）**。新契约 23 项全绿；邻域回归全绿；收口门（test:changed 之外 13 门）全部给出结果，仅剩并发写入者两文件指纹项（`acceptance/nso-2026-11-06/wave-1/post-test-gates.log`）。test:changed 805 项 797 过，余 4 红全为他方/存量（BLOCK-332 ×2 并发写入者台账、NEXT-03 环境、P6 待重算），W1 引入为零。
- **例外（reopen）**：①SSE `task.failed` 三态投影到前端（前端投影面与 W3 邻接）；②真实 provider 长任务回归（T7 自然窗口、8 任务连续 3 次 8/8）需真实凭据与成本——G0 不外推 Provider，留待用户发令；③P6 源绑定重算待 UI-696 落地后一次完成；④token 账本 computeCategories/computeContextBreakdown 双口径收编并入 W5b。
