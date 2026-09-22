# BLOCK-115-TEST-SUGGEST 计划：增量式测试选择建议（决策内化弧 W1-5 · 谨慎档）

**Plan ID**：`BLOCK-115-TEST-SUGGEST`
**状态**：`active（P0-LAUNCH，2026-09-22 用户裁决「开 按顺序都做完」队列序第 5 点=末项；弧线底稿=docs/planning/decision-primitive-internalization-arc.md §W1-5）`
**立项日期**：2026-09-22
**责任轨道**：BLOCK（开发者侧 dev-infra 工具；零产品面/零用户数据）
**上游文档**：弧线 §W1-5 · `test/impact-map.json`（静态下限，fail-closed 红线不动）

## 0. 立项来源与用户裁决留痕

- 弧线 W1-5（2026-09-21 登记）：「静态 test/impact-map.json 保持下限（fail-closed 红线不动），决策原语**只加不减**——额外建议本次改动可能波及的定向测试，误报代价=多跑一个测试，漏报不存在」。
- **启动裁决（2026-09-22）**：用户裁决原话「开 按顺序都做完」（队列序第 5 点=末项）。

## 1. 范围与非范围

### 1.1 范围

在静态 impact-map 路由（=测试下限，完全不动）之上，提供**增量建议**：`scripts/block115-test-suggest.mjs` 接收本次改动文件清单 → 决策原语 choice 判定「改动语义波及的测试域」（12 测试域分类学，见语料 note）→ 展开为该域的定向测试文件建议（**只追加，从不下判**）。误报代价=多跑一个测试；漏报=0（下限仍在）。产出为建议清单（JSON），执行与否由人/流程决定。

| 阶段 | 内容 |
| --- | --- |
| P0 | 改动→测试域语料 ≥100 条 + choice 校准（θ 曲线）+ D 项评审；证据 `acceptance/block-115/` |
| P1 | 建议器 CLI（`helpers/test-suggest-core.mjs` 内核 + CLI）+ 契约测试（只加不减/弃权=零建议/降级=零建议） |
| P2 | dogfood：对本会话真实改动文件集跑建议器 + closeout 十门 |

### 1.2 非范围（exclusions）

- **impact-map 的路由规则/词表/fail-closed 语义零改动**（红线）。
- 建议不自动执行、不接入 closeout/test:changed 链（v1 纯建议；接入另裁）。
- 测试域分类学为**建议层的展示分类**，不改写任何既有规则。
- 弧线已完结项（W1-1~W1-4）零触碰。

## 2. P0 预登记裁决项（D-1~D-5）

- **D-1 类目集**：12 测试域（agent-loop / conversation / knowledge / result-studio / tools-policy / ipc-preload / window-ui / frontend-vitest / infra-verify / platform / decision-jev / gates-quality）+ `none`（弃权=无增量建议）。
- **D-2 state**：改动文件清单（≤600 字）。
- **D-3 门控阈值**：conf ≥ θ 才出建议（否则零建议）；误报代价=多跑一个测试（可接受），但 precision < 0.80 时建议失去意义——P0 取「precision ≥0.80 约束下最高覆盖档」。
- **D-4 部署形态**：独立 CLI，输出建议 JSON；不接入任何门禁链。
- **D-5 只加不减**：结构化保证——建议清单是独立附加输出，管线任何分支都不可能减少静态下限（下限根本不经过本工具）。

## 3. 关闭语义

- 正常完成：P0 证据门（overall ≥0.80、θ 下 precision ≥0.80、coverage ≥0.50）→ P1 → P2 dogfood + closeout 十门 → completed。
- PoC 失败语义：不达标 → 诚实收缩关闭（决策层放弃，静态下限不受影响），仅冻结本点。

## 4. 验收门禁清单

- P0：`acceptance/block-115/calibration.json`（≥100 样本、θ 曲线）+ 语料入库。
- P1：`test/block115-test-suggest.test.mjs`（弃权=零建议/降级=零建议/只加不减结构断言/类目集钉住/降级五态）。
- P2：对本会话真实改动跑建议器，`acceptance/block-115/dogfood.json`；closeout 十门全绿；impact-map 登记 `block115-test-suggest`。

**预期节奏**：一次会话收口。
