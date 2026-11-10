---
capability: block-406-post-k7-l2-function-integrity
status: active
goal: 执行第五轮优化程序 L2（功能断链与假成功）：消灭「成功但零执行」「声明有但入口不可达」「声明可比较但产品无入口」三类假兑现，并统一 IPC 失败形状。承载蓝图 docs/post-k7-full-audit-and-blueprint-2026-11-10.md §4-L2 的 14 条发现（L-01~L-11、L-19/20/21）。
acceptance:
  - L2-1 L-01：MCP skill_execute 同源注入执行体或 fail-closed no_execution_backend；红绿先行——当前空产物用例必红；11 个内置 Skill 逐件执行有真实产物或明确 isError:true；协议级 callTool 断言
  - L2-2 L-02：产品 MCP 入口注册 resources + capabilities，ide:// 资源从 bin petri-mcp 可达；prompts 声明不再恒空（或移除声明）
  - L2-3 L-19/20/21：数据桥统一 {ok:false,code,message,retryable}、runtime 三态；单一 ipcFailure()；gen-ui fetch AbortSignal.timeout
  - L2-4 L-03 viewer canCompare 接线或诚实改声明 + 契约测；L-05 skill source enum 同源派生（含 pack）
  - L2-5 L-04~L-11 零消费通道/端点逐件销号或 retain-with-reason
  - L2-6 L-09 通道表增 testOnly 标记，契约测试区分产品/验收通道
  - L2 出口：MCP 协议级契约测 + 168 通道双向门 + gate:post-h9-contracts 全绿；零消费项逐件终态
reopen: MCP 工具面变化或蓝图锚点漂移时重开
---

# BLOCK-406 · post-K7 L2 功能断链与假成功（第五轮优化程序第 3 阶段）

> 发令来源：用户 2026-11-11 执行提示词预授权（同前，连续工作）。canonical 蓝图 §4-L2。
> 红绿先行（HK-01）全适用。U/E/V/W 边界不代答。
