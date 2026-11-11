---
capability: block-414-post-k7-w5b-slice-1-simplechat
status: completed
goal: W5b 拆分第一刀（L-46 续）：SimpleChat.tsx（2089 行）按内聚块抽取子模块，行数只减锚生效；拆前拆后同套定向测试绿（BLOCK-92 先例）。零行为变化、零新增依赖。
acceptance:
  - 拆前基线：SimpleChat 邻域 vitest 全套 pass 数记录在案
  - 抽取块为内聚单元（纯函数/hooks/渲染段），import 图无新环（arch-cycles 门零新环）
  - 拆后同套绿（pass 数 ≥ 拆前）；SimpleChat.tsx 行数下降≥80 行；code-size/big-file-anchor 双基线重打留因
  - 零行为变化：不改任何运行时逻辑（纯移动+re-export 接线）
reopen: 拆分引入行为差异或测试红时回滚重刀
---

# BLOCK-414 · W5b 拆分第一刀：SimpleChat.tsx（L-46 续）

> 发令来源：预授权连续工作延续（用户 2026-11-11「按照你的建议 继续走吧」）。
> 蓝图=docs/post-k7-full-audit-and-blueprint-2026-11-10.md §4-L5 L-46（一切片=一会话+拆前拆后同套绿）。

## 执行留痕

| # | 状态 | 关键交付 | 证据 |
| --- | --- | --- | --- |
| 拆前基线 | done | copilot 域 104 文件/763 tests 全绿；SimpleChat.tsx=2089 行 | vitest 输出 + wc |
| 抽取单元 | done | SimpleChat/hooks/useGuardAck.ts（193→206 行）：guard-ack 状态簇+pendingGuardAck 派生（抽为模块级纯函数 findPendingGuardAck 可单测）+handleGuardAck/Dismiss（useCallback 语义保持）；主文件 2089→1963（−126） | useGuardAck.ts 在场 |
| 同套绿 | done | 拆后 104 文件/763 tests 全绿（与拆前逐数一致） | vitest 输出 |
| 双基线重打 | done | big-file-anchor（SimpleChat 1963）+ code-size（SimpleChat sha/行数随抽取） | 两 --write 输出 |
| 门禁 | done | arch-cycles 12 环无新环 / arch R1-R5 / tsc 净 / eslint 文件级净 / ledger PASS | 各 tail |

## 红绿先行记录

- 拆后首跑两红（eslint purity + preserve-manual-memoization + compiler skip）→ useCallback 恢复 + purity 行内豁免留因（Date.now 过期判定为 memo 语义一部分）+ memo 主体抽模块级纯函数 findPendingGuardAck（React Compiler 可保留 + 可单测改进）→ 全清。

## 红批归属（test:changed 5569/5580）

- agent-runner 1143>1140 ×2 = BLOCK-398 增长（L5-5 W5b 后续刀范围）
- BLOCK-93 ×2 = deepseek key 缺失（V 类，用户 export 后重跑）
- P6 = CSS WIP（W 归属）
- block350 = ai-conversations/branch-db 热路径变化（BLOCK-412/补腿）→ 重采后绿

## 事故披露（2026-11-11 · 本刀附带修复链发现）

**L1 stdin 表单缺陷（本会话 BLOCK-405 L1-6 引入，事故级）**：`security add-generic-password -w` 从 stdin 读密码时会提示**两次**（password + retype）——单行 input 触发 "passwords don't match" 后仍**静默存入空密码**（实测存储=1 字节换行）。后果：用户 deepseek keychain 条目被覆写为空 → `deepseek_configured: false` → 应用「deepseek 断开连接」。

**修复**：stdin 双行同值（value+\n+value+\n）+ 探针账户端到端往返 PASS + 事故转机械门禁（test/block414-backend-port-reuse.test.mjs 事故门禁用例，探针账户用后即清）。

**影响与补救**：deepseek key 被覆写为空，**原值不可恢复**（keychain 无历史）——需用户在设置面重新粘贴 deepseek API key（仅用户持有，V 类不代办）。其他凭据（4 个 model/openai-compatible 账户 36-52 字节）完好未受损。profile-1 账户同为 1 字节空密码（与 deepseek 同期被同形态覆写）。

**门禁**：keychain SET/GET 往返逐字一致 → test/block414-backend-port-reuse.test.mjs 事故门禁用例永久承载（探针账户往返 + 空白污染断言）。
