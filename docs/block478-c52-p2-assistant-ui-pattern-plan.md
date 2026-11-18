---
capability: block478-c52-p2-assistant-ui-pattern
status: completed
kind: work-package
truthDomain: block478-c52-p2-assistant-ui-pattern
entrypoint: docs/README.md
goal: C-52 余项首包（P2 assistant-ui 模式研究）——从 canonical 真源机械冻结 assistant-ui 五种交互形态（流式消息/工具调用确认/附件/结构化数据/选项列表）在 Petri 本地主权形态中的既有锚点，产模型可读契约 assistant-ui-pattern.json + 消费测试锚定；只做模式借鉴与契约冻结，不替换 SimpleChat、不新增产品依赖、观感 pending_human_eye 零代签
acceptance:
  - HK-01 红绿先行：消费测试先红（扫描器模块缺席 ERR_MODULE_NOT_FOUND）后绿 11/11；含篡改负测 fail-closed（改流式真源/改 package.json 依赖/改观感状态一律判红）
  - 契约可复算：collectAssistantUiPattern(root) 纯函数从六组真源机械复算，落盘快照与 resources/design-context/assistant-ui-pattern.json 逐读数深等；--check 重算与落盘一致；manifest sha256 由生成器维护并一致
  - 六组读数：流式消息（pending 强制/compose→pending/completed 升级/JSON 前缀判据/SSE 续传 8 it+7 test）、工具调用确认（批准卡/防护三变体/计划三选一/两个 hook）、附件（大小上限/校验/工作区落盘/拖放）、结构化数据（compose 五 kind/fail-closed/$state 安全引用/零依赖校验器 12 it）、选项列表（AskUserQuestion 结构化提问/多选自由输入/busy/answered-timedOut 3 it）、边界（零新增依赖/SimpleChat 未替换/观感零代签/许可证来源四条登记）
  - 观感零代签：UI-706/707/709/710 保持 in_progress + pending_human_eye、零 verified；契约 boundaries.humanEyeSigned=false、readOnly=true；本包无 UI 运行时写面
  - 零新增产品依赖、零 SimpleChat 写面；closeout 定向门禁全绿 + impact-map 登记 + 六件套回写
---

# BLOCK-478 · C-52 余项 P2 assistant-ui 模式借鉴与契约冻结（completed / P2-LAUNCH→CLOSED）

> **发令**：用户 2026-11-18 发令「开始 C-52 余项」，并授权主 Agent 先定形 P2–P5 中先做哪一项；纪律=零依赖、只做模式借鉴/契约冻结、不替换 SimpleChat、不新增产品依赖、观感待用户过目零代签。
> **定形裁决**：P2–P5 中先做 **P2（assistant-ui 模式研究）**——发令边界「只做模式借鉴/契约冻结、不替换 SimpleChat、不默认新增依赖」是 C-52 条目 P2 的逐字边界；五种交互形态在 Petri 均有本地主权实现锚点，可纯静态冻结、零产品写面、零观感代签。P3（React Bits 微动效）/P4（21st.dev 灵感库）/P5（参考板评审法）保持候选、不启动。
> **来源**：`docs/pending-work-backlog.md` C-52 条目（候选池 Q1，重开条件=用户显式发令并指定先做哪个 P；本次发令+主 Agent 定形满足）；`docs/AUDIT-LOG.md` C-52 P1/P2 销号条目。

## 1. 范围（scope）

1. **静态扫描器**：新增 `scripts/c52-assistant-ui-pattern.mjs`——纯函数 `collectAssistantUiPattern(root)` 从六组 canonical 真源机械复算六组读数（详见 frontmatter acceptance），暴露 6 个 scan 子函数 + `validateAssistantUiPatternIntegrity` + `LICENSE_REGISTER`（四来源许可证登记）。
2. **模型可读契约**：落盘 `acceptance/block478-c52-p2-assistant-ui/assistant-ui-pattern-snapshot.json`（六组读数快照）+ `resources/design-context/assistant-ui-pattern.json`（模型可读契约）+ `resources/design-context/manifest.json` 追加条目（sha256 生成器自维护）。
3. **消费测试**：`test/c52-assistant-ui-pattern.test.mjs`——结构完整/逐读数现读一致/五形态分组断言/边界/ manifest sha/篡改负测/零回归基线，共 11 项；HK-01 红→绿留痕。
4. **impact-map 登记**：C-52 P2 规则（scripts/test/契约 JSON/证据目录归类），保证新测试纳入定向范围。

## 2. 非范围（exclusions）

- SimpleChat.tsx 及任何 .tsx/CSS/token 写面（只读扫描，零 UI 运行时写面）；观感签字（pending_human_eye 零代签，UI-706/707/709/710 + E 类 + 签字槽保持 in_progress）；
- C-52 P3/P4/P5（React Bits 微动效 / 21st.dev 灵感库 / 参考板评审法）——保持候选、未发令不启动；
- 引入 assistant-ui / react-bits / 21st.dev / framer-motion 等任何产品级新依赖（许可证只登记不引入）；复制品牌标志/文案/插画/整页布局；
- 他方 WIP（`docs/architecture/gateway-design.md`）零触碰；用户 untracked 资产零触碰；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：`node --test test/c52-assistant-ui-pattern.test.mjs` 先红（ERR_MODULE_NOT_FOUND）后绿 11/11。
- **G2 可复算**：`node scripts/c52-assistant-ui-pattern.mjs --check` 重算通过；六读数与快照逐读数深等；manifest sha256 一致。
- **G3 零回归**：C-53 P0–P7 八份契约测试 Node 79/79 零回归（共用 manifest）；`test:suggest --supply=cloud` 零建议；docs:check/ui:audit:check 绿；零新增依赖。
- **G4 治理**：closeout 定向门 + impact-map 登记 + 六件套回写（plan/roadmap/handoff/AUDIT-LOG/ui-audit/DOC-REGISTRY + README 入口）。

## 4. 完成语义

G1–G4 全绿 + 六件套回写 + 证据落 `acceptance/block478-c52-p2-assistant-ui/`。本包无观感面（扫描器/契约 JSON/测试均非用户 UI 写面），如实登记；不冒充任何 pending_human_eye 项 verified。P3/P4/P5 未发令不启动，留用户后续裁决。

## 5. 收口记录（2026-11-18）

HK-01 红→绿 11/11（缺席红 ERR_MODULE_NOT_FOUND → 11/11）；生成器首轮即过全部不变量（composeKinds=5、humanEyeZeroSign=true）；--check PASS；C-53 P0–P7 Node 79/79 零回归；test:suggest --supply=cloud 零建议（area_none，0.31）；零 UI 写面/观感代签/新依赖。证据=acceptance/block478-c52-p2-assistant-ui/。C-52 P3–P5 待后续发令。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口门禁归属（2026-11-18）

本包自身门逐个验证全绿：ui:audit:check 绿（642）/ gate:code-size PASS（基线 86301 不动）/ gate:arch-cycles PASS（12 存量环无新增）/ gate:css-modules PASS / quality:secret PASS / quality:arch PASS（R1–R5 无违规）/ quality:lint 0 error（2442 warnings 存量基线不动，本包 5 处 unused 已修）/ quality:types 绿 / quality:knip:check PASS（346 键冻结）。

closeout 聚合链 stop 于两处**既有红，均非本包文件面**：
- `docs:check` 的 `DOCUMENT_MISSING docs/post-h9-optimization-blueprint-2026-11-10.md`：该 living-plan（`status: planned`）注册表里头脑自述「蓝图原件为受保护未跟踪文件、全程零触碰」，HEAD 全史 0 commit、无 blob，任何干净 checkout 均现此红——本包零触碰该受保护资产，不伪造、不改其状态。
- `test:changed` 两红：`block326 ② dev-verify --list exit 2`（`run.cjs --list` 自身 `padEnd` 崩溃，与本包零 flow 面无关）+ `test-affected.test.mjs:90` 的 block464/470/477 `evidence.json` 未映射（B2 提示词已登记为既有测试面债务）。本包新增的是 `assistant-ui-pattern-snapshot.json`/`evidence.md`，未新增任何 `evidence.json`。

定向链 15 个 node test 中本包 `c52-assistant-ui-pattern.test.mjs` 11/11 通过；上述两红如实归属既有，不表述为本包通过、不重打基线掩盖。`output:judge` 判词 PASS（fit 3.54，首次 2.62 RETRY 后带判词重试）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
