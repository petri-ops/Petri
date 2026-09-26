# HK-04 P0：能力级规格层（Spec Layer）设计稿

> 状态：**P0+P1 已收口（2026-09-26 当日）**——三份试点（block-121/119/g0-rs）front-matter 落地 + docs:check 增量校验实现（契约 12/12）+ docs:status capability 视图 + status 漂移抓真演示（acceptance/hk04/p1-consistency-demo.txt）；增量采纳持续生效（新 plan 立项即带）。
> 来源：HK 系列（backlog 推进队列）；缺口锚点=OpenSpec delta 思想对照——工作包收口后「某能力当前应该是什么行为」无单点可查，行为要求散在 roadmap / plan 正文 / ui-audit 台账 / IPC registry 四处，跨工作包不可机读。
> 本文档是规格层设计的 canonical（truthDomain: `spec-layer-design`）。

## 1. 现状盘点（P0 勘察结论）

- **plan 文档**：存量 ~330 份，抽样（block-121/119/105、roadmap）**全部无 YAML front-matter**；状态/验收/重开条件全在正文引语与 §N 节——人读友好，机读不可。
- **DOC-REGISTRY 条目**=（id/path/kind/status/canonical/truthDomain/entrypoint/registeredAt/tags/archivePolicy）：只描述**文档生命周期**，不描述**能力行为要求**；校验器验字段类型与 canonical 必填，不拒未知字段（增量字段零破坏）。
- **docs:check 校验面**：registry schema / 路径失效 / 入口断链 / truthDomain 唯一 / 管理覆盖；无 front-matter 概念。
- **已有机读契约（规格层不重复建设）**：IPC channels registry（双向测试守护=通道契约）、ui-audit 台账（UI 状态机）、knip 棘轮 / impact-map（工程面）。缺的只是「能力级行为要求」这一层的**单点索引**。

## 2. 设计：四键 front-matter + registry 增量 + docs:check 增量

**plan 文档 front-matter 四键**（可选采纳，P1 试点 2-3 份）：

```yaml
---
capability: result-loop          # 能力标识（跨工作包稳定名，命名空间唯一）
goal: >-                         # 一句话行为要求（当前态应是什么）
acceptance:                      # 验收判据指针（flow 名/测试名/证据目录）
  - block121-result-loop 20/20
reopen: >-                       # 重开条件（观察态语义；无则省略）
status: completed                # 与 DOC-REGISTRY status 一致（校验看住漂移）
---
```

- **registry 增量**：entries 可选 `capability` 字段；同 capability 多文档（原 plan 与其加映/续批）合法，报告按 capability 聚合——回答「这个能力现在由哪些文档承载、最新态是哪个」。
- **docs:check 增量校验（只加不改）**：①**触发语义（实现期修正）=registry 条目显式声明 `capability` 才校验**——存量文档大量以 `---` 水平线开头，「文件出现 front-matter 即校验」必误伤，registry capability 即能力命名空间的显式登记（opt-in）；②四键格式必查（缺键/格式错/未知键=红）+「登记了 capability 但文档缺 front-matter」=红；③front-matter.status 与 registry.status 一致性（防第二真相漂移）；④front-matter.capability 与 registry.capability 一致 + kebab-case 命名。**未登记 capability 的文档零影响**（增量采纳，无迁移墙）。
- **查询面**：P1 不建服务——`npm run docs:status` 增 capability 聚合视图（读 registry+front-matter 单次扫描）。

## 3. 反目标（明确不做）

- 不引 OpenSpec CLI / `openspec/` 目录（第二套治理）；不建 specs/+changes/ 双目录（本仓 plan 文档 + backlog 队列已是 changes 载体，缺的只是「当前态」机读索引）。
- 不强制回填 330 份存量：**增量采纳**——新 plan 立项即带，存量文档收口/顺手触及时补。
- front-matter **不是第二账本**：正文仍是 canonical 叙述，front-matter 是其机读投影；两者漂移由 docs:check 一致性校验看住（可机械核对的面只做 status；goal/acceptance 语义对账仍归评审与 output:judge）。

## 4. P1 落地结果（2026-09-26 当日收口；用户委派「你来定」按推荐路线执行）

- **实现**：`scripts/docs-governance.mjs` 增 `parseCapabilityFrontMatter`（受限格式解析器：扁平键+单行值+acceptance 块列表，**不引入 YAML 依赖**）+ validateDocumentRegistry 第三遍历（五类 issue code：FRONTMATTER_INVALID_FORMAT / UNKNOWN_KEY / STATUS_MISMATCH / CAPABILITY_INVALID / CAPABILITY_MISMATCH）+ `--status` capability 聚合视图。
- **红绿先行（HK-01 第二次行使）**：6 条契约测试先落 test/docs-governance.test.mjs（负例红：缺键/未知键/status 漂移/命名漂移；回归基线绿：四键齐备/无 front-matter 零影响）→ 实现 → **12/12 绿**；实现期抓真=「presence 触发」误伤存量 `---` 水平线文档（全仓扫描坐实），触发语义修正为 registry opt-in（§5 留痕）。
- **三份试点**：block-121（result-loop）/ block-119（output-judge，含 reopen 键）/ g0-rs（result-studio，含 reopen 键）front-matter 补齐 + registry capability 字段登记；`docs:status` capability 视图三行全亮。
- **抓真演示**：手改 block-121 front-matter status 制造漂移 → docs:check 精确红（FRONTMATTER_STATUS_MISMATCH 点名文件与两侧值）→ 还原 PASS 282 份；证据=acceptance/hk04/p1-consistency-demo.txt。
- **判据达成**：三份试点 docs:check 绿 ✅ + 一致性抓真演示 ✅ + 既有 282 份门禁零回归 ✅（契约 12/12 含全仓 registry 一致性测试）。
- **增量采纳持续生效**：此后新 plan 立项即带 front-matter（registry 登记 capability），存量文档收口/顺手触及时补。

## 5. 裁决记录

- 2026-09-26 P0 勘察+设计收口；P1 试点裁决在用户。
- 2026-09-26 P1 开工：用户委派「你来定」，按推荐路线执行；当日收口（本文件 §4）。实现期修正一处设计细节=触发语义从「presence 触发」改为「registry capability opt-in」（存量 `---` 水平线误伤，全仓扫描实证），已回写 §2。
