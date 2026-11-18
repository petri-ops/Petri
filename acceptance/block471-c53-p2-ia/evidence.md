# BLOCK-471 / C-53 P2 IA 与高频路径 — 证据（2026-11-18）

## 发令与范围
- 用户复制「可复制启动提示词」发令「开始 C-53 P2」（批2提示词 `docs/next-phase-e2e-prompt-2026-11-18-b2.md` S1/R9）。
- 范围=从 `frontend/src/App.tsx` 机械盘点 IA + 3–5 条高频路径，产模型可读 `resources/design-context/ia-map.json` + 消费测试锚定；纯资源/脚本/测试面，零 UI 运行时写面。

## HK-01 红绿
- RED（实现前，模块缺席）：`node --test test/c53-ia-map.test.mjs` → ERR_MODULE_NOT_FOUND（pass 0 / fail 1）。
- GREEN：`tests 7 / pass 7 / fail 0` —— ①结构完整（两 surface 路由+重定向+5 高频路径+易变字段）②现读 App.tsx 路由逐条一致（可复算）③无死链（重定向目标解析到在册路由）④高频路径每跳可达 ⑤manifest sha256 一致 ⑥篡改负测（改路由/插死链/路由漂移）fail-closed ⑦P1 包在场。
-  repaired two test-design mistakes（非产品缺陷）：路由正则未闭合/ Navigate 误判为路由（已修）；篡改负测的 `.reverse()` 被 `norm().sort()` 抵消（改为真改路径）。

## 现读产物
- `resources/design-context/ia-map.json`：routes=12（main 8 + window 4）、redirects=4（`/skills`→`/extensions?tab=domain-skills`、`/plugins`→`/extensions?tab=domain-plugins`、两 `*→/`）、highFrequencyPaths=5：
  - HFP-1 首问直达工作区 `/` → `/project/:projectId/*`
  - HFP-2 项目管理进入工作区 `/projects` → `/project/:projectId/*`
  - HFP-3 工作区到代码评审 `/project/:projectId/*` → `/review`
  - HFP-4 扩展中心技能/插件 `/extensions` → `/skills` → `/plugins`
  - HFP-5 知识空间回到工作区 `/knowledge` → `/project/:projectId/*`
- `scripts/c53-ia-map.mjs`：`collectIaMap`/`resolveRoute`/`validateIaIntegrity` 纯函数 + `--check`（不写盘）；manifest 的 ia-map sha 由生成器自身维护（沿 P1 先例，避免手算漂移）。
- `--check` PASS（routes=12 redirects=4 hfp=5）；manifest sha256=3132f884…（现读）。

## 边界与零回归
- P1 包 `test/c53-design-context-pack.test.mjs` 8/8 零回归；`quality:lint:ledger` PASS（warnings 2441 基线不动，新脚本零新增告警）。
- 观感零代签：本包无 pending_human_eye 面（资源 JSON+脚本+测试非用户 UI 写面）；UI-706/707/709/710 + E 类 22 条保持 in_progress，不冒充 verified。
- 零产品代码/运行时路由改动/新依赖；design-charter 冻结项零触碰；用户 untracked 资产零触碰。

G0 开发期常态 · 不外推 packaged/Provider/GA。
