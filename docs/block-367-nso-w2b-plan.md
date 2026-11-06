---
capability: block-367-nso-w2b-audit-boundary
status: completed
goal: NSO-W2b 审批-执行闭环实核与边界审计——实核修正评估 F-06 的预设（agent 主体 once 指纹已在拦截器执行前同步消耗，同步执行器无旁路窗口），补齐「消耗事实向执行边界透传」的审计面；外部 MCP 主体档位与链哈希保持既有裁决位。
acceptance:
  - 拦截器消耗 once 指纹后，把 capabilityEvidence={ fingerprintConsumed: true, guardKey, source: 'once_fingerprint' } 透传 handlerOptions；契约测试钉住「消耗⇒证据在场、未消耗⇒不在场」
  - FK 差异（桌面 ON / 后端 OFF）在 db-connection-policy 头注与 AUDIT-LOG 保持如实登记（本包不加行为）
  - 外部 MCP 主体档位（协议层协商）不实现、不造假门，AUDIT-LOG 🟡 持续在案
reopen: 用户裁决外部 MCP 主体档位方案后另行立项实现 token 机制
---

# BLOCK-367 · NSO-W2b 审批-执行闭环实核与边界审计

> 蓝图依据：§5（W2-3）。**实核修正（2026-11-06）**：评估 F-06 假设「审批决策未在 executor 侧重放/消耗」——实核 `agent-tool-interceptor.js:357-361`：once 指纹在 policy 放行后、handler 执行前**同步消耗**；同进程同步调用不存在「审批后参数改写再执行」的窗口（参数改写走 BLOCK-243 overrides，原始/生效双指纹均入审计）。因此本包不做第二 token 机制（零第二真相），交付剩余审计面。

## 交付与收口（2026-11-06）

- ✅ capabilityEvidence 透传（消耗 ⇒ handlerOptions.capabilityEvidence={fingerprintConsumed, source:'once_fingerprint', guardKey}；未消耗 ⇒ 零噪声）；装配顺序源码契约。
- ✅ FK 差异与外部 MCP 主体档位保持登记（本包零行为变更）。
- **completed**。邻域 approval 31/31；W2 引入为零。
