# 文件树纯净策略（File Tree Policy）

> 自包含策略文件：界定仓库各区域的生命周期与"纯净"标准。与宿主 hygiene:check / docs:reconcile 门禁配套；
> 门禁管检测（机械化），本文件管判据（什么该留、什么该归档、何时清理——处置由人裁决）。

## 区域划分与生命周期

| 区域 | 性质 | 生命周期 |
| --- | --- | --- |
| 仓库根 | 入口面，保持清单干净 | 只放入口与配置文件；临时文件/构建碎片即删（先例：IntlProvider-tmp.js 为 dist chunk 调试遗留，2026-09-09 确认无源码价值后清除） |
| `docs/` | 治理圈 | 全量登记 DOC-REGISTRY；过期文档走 docs:reconcile 候选 → 人裁决 → 归档到 docs/archive/ |
| `scripts/` | 可执行资产 | 见下方脚本生命周期判据 |
| `acceptance/` | **受保护证据** | 永不作为普通文档清理；按包组织（acceptance/<block>/），证据 JSON/PNG 随包永久保留 |
| `.agents/skills/`、`.claude/skills/`、`.aionrs/skills/` | Agent 资产与路由 | 死链即删（链接目标不存在即无复用价值）；新链接必须相对路径，禁止绝对机器路径（先例：7 条 macOS 死链，2026-09-09 清除） |

## scripts/ 生命周期判据

两类脚本，命运不同：

1. **可复跑验收脚本**（`*-live.cjs`、harness 脚本等）——证据链一部分，**保留**：
   - 判据：可重复执行 + 断言可复核 + 证据落 `acceptance/`；
   - 义务：保持 impact-map 登记与可运行状态（依赖的 dev 栈约定变化时要跟进修）。
2. **一次性 driver/setup/probe**（临时网关、探针、复制粘贴变体）——**可归档**：
   - 前置：对应工作包已收口 + 结论性证据已落 `acceptance/`（脚本删除后结论仍可追溯）；
   - 动作：移入 `scripts/archive/`（保留 git 历史，目录表达"不再是活脚本"）或经用户裁决删除；
   - 归档后从 impact-map 对应规则 patterns 中移除（validateMap 的"恰好一规则"约束会自然放行 scripts/archive/** 不受分类）。

注意：`scripts/archive/**` 不再被 script 分类规则覆盖是**预期行为**；若未来恢复某脚本，移回 `scripts/` 并重新登记。

## 与门禁的分工

- `hygiene:check`：检出死链与临时命名残留（fail-closed）——检测自动化；
- `docs:reconcile`：列出归档候选（advisory）——检测自动化；
- 本文件：给"检出之后怎么判"的判据——**处置由人裁决**，任何自动清理都不被允许（护栏先例：UI-LEDGER 误删 dev 会话事故）。
