---
capability: execution-unification
goal: agent/MCP 同步路径并入 tool_jobs 异步装置——并发准入/心跳/硬超时/僵尸扫描/取消链对两条执行路径同等生效，300s 内建上限退役
acceptance:
  - block128 契约 4/4（共享单例/300s 退役+共享预算/并发准入同语义/claim-release 回归）
  - test:changed 定向回归 0 红（共享 Map 行为敏感改动的全量对账）
  - 实机（栈重启后）：agent 对话跑分析→job 行有心跳推进+Jobs Wall 可见+取消可达
reopen: 实机待 dev 栈重启；真异步产品形态（对话内提交-跨轮查询回执）登记 PL-3 候选
status: active
---

# BLOCK-128 — 执行语义统一（G0-PLATFORM PL-1）

> 立项：2026-09-29。用户裁决「继续」= G0 Goal 交织序 PL-1 启动（BIO-4 bulk 链解冻的硬前提）。
> 形态：BLOCK（执行器核心手术，BLOCK-76/57 家族敏感区）。阶段：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 一句话目标

同一类分析的两条执行路径（HTTP 异步 / agent-MCP 同步）共享同一套可靠性装置——此前 MCP 路径 300s 硬上限、无并发准入、无心跳、无僵尸扫描覆盖、取消链断。

## 2. 差距（G0-PLATFORM plan §2.1 证据）

- `run-plugin-script.js` execFile `timeout: 300000`（长分析必死）+ 建行直写 running（不走 CAS）+ 不在 activeToolJobs（HTTP 路径工厂局部 Map）→ 心跳/僵尸/取消全不覆盖 + 并发上限只在 HTTP 路径检查。

## 3. 修法（三件）

1. **进程级共享登记表** `helpers/tool-job-lifecycle-registry.js`：activeToolJobs 单例 + countActiveUserToolJobs（每用户 pending+running，终态不计）。tools-executor 工厂局部 Map 换共享（生产单进程单 executor 语义等价）。
2. **MCP 路径并入装置**：建行前并发准入（≥max_concurrent 拒绝，429 契约字样同 HTTP）；execFile 前 claimActiveToolJob（重入拒绝）；child 到手后 owner.process=child + armActiveToolJobLifecycle（心跳 30s + 硬超时 BIOF3_TOOL_HARD_TIMEOUT_MS 默认 30min）；回调收尾 clearTimers→release→finalize。**timeout: 300000 → 0**（内建退役，硬预算统一由装置管）。
3. 装置层 db 用 better-sqlite3 原句柄（lifecycleDb；不可用时退化无心跳但硬超时仍生效）。

## 4. 非范围

- **真异步产品形态**（run_tool 返回提交回执、模型跨轮查询）——产品语义大改，登记 PL-3/后续候选；本包保留同步等待语义（但预算 30min）。
- 远程（SSH 直跑）路径不动（自有 budget 280s+取消登记）；终态事件已由 BLOCK-126 覆盖。
- 队列化/自动重试（PL-3 本体）。

## 5. 验收

- `test/block128-execution-unification.test.mjs` 4 用例（源码守卫+行为）。
- test:changed 定向 0 红；实机待栈重启（心跳可见+取消可达+长任务不再 5min 死）。
