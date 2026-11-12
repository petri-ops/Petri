# BLOCK-431 · M5 安全与正确性纵深（不委派）

> 前置：M4=BLOCK-430 completed（带 external-blocked / W / done-partial）。唯一审计输入：
> `acceptance/m-blueprint-2026-11-11/FULL-AUDIT-AND-BLUEPRINT.md` §4-M5 / §2.6 M-32～M-40、§2.8 M-47～M-53。
> 用户 2026-11-11 预授权连续工作裁决（见 `docs/m-blueprint-2026-11-11-program.md`）。

## 范围（M5-1…M5-8，逐件终态）

| 改进点 | 映射 | 本包交付 |
| --- | --- | --- |
| M5-1 全局 `requireTrustedDesktopOrigin` + MCP 写面 command 白名单 / 会话 token | M-32 | 安全判据模块（纯函数）+ 负测；生产接线 done-partial |
| M5-2 空 Origin 全方法 token + per-boot 随机 token + 废弃常量 Bearer | M-33 | `adjudicateLocalRequest()` + per-boot token 生成 |
| M5-3 `file:start-drag` localPath 登记根 + realpath 边界 + basename + 长度上限 | M-34 | `adjudicateDragPath()`（SSH key / `../` 植入必红） |
| M5-4 权限降级覆盖所有 session + 帧导航 allowlist + CSP unsafe-inline | M-35/M-39 | `adjudicateFrameNavigation()` + `adjudicatePermissionSessions()` |
| M5-5 tar 参数加固 + 条目校验；zip 失败 try/finally 清 destDir | M-38 | `adjudicateTarEntry()` + `cleanupPlan()` |
| M5-6 假成功治理（具名 reasonCode）+ uncaughtException 退出 + 统一 IPC 失败信封 | M-47/M-48/M-53 | `failureEnvelope()` / `ddlOutcome()`（拒绝全 0 统计假成功） |
| M5-7 `quality:secret` git 错误 fail-closed + 文件系统遍历 + 日志脱敏 | M-40/M-19 | `adjudicateGitGrepResult()`（区分 exit 1 与其它）+ `redactLog()` |
| M5-8 上限常量收编 + limit/offset 断言 + 原子写 tmp+rename + 下载失败清理 | M-12/M-50/M-51 | `adjudicatePaging()` / `atomicWritePlan()` |

全部判据收敛到单一纯模块 `core/petri-server/agent-tools/security-boundaries.js`（零新增依赖）。

## 关键工程裁决（逐项留痕）

- **不改 `workspace_exec` 默认放行**（2026-11-05 S2 裁决）：只补补偿控制与风险声明显式化。
- **生产接线 done-partial**：`bootstrap.js` / `mcp-client.js` / `file-dialog.js` / `main.js` /
  `secret-scan.mjs` 等生产文件属跨模块安全改造，改它们会触碰既有调用方契约与 12 环，
  须带 BLOCK-92 拆前拆后同套绿基线；按蓝图归 **M6-A 结构单源组**统一接线（不提前实现）。
  本包交付可机械验证的判据层与安全负测，出口判据「全套安全负测绿」由判据层满足；
  「生产路径接线」逐件标 `done-partial` + 补腿条件，M7 gap-ledger 终态化。
- 不改 `MAX_AGENT_ITERS=Infinity` / ADMISSION / FK / MCP 计量 / 主题 / 中栏既有裁决。
- 零新增依赖；零触碰在制 WIP；零 stage / 零提交；零放宽基线；零 G1+ 外推。

## 验收门

- `node scripts/m-blueprint-m5-security-gate.mjs --check`（八类安全判据植入必红）。
- `node --test test/m5-security-boundaries.test.mjs`（HK-01 红→绿）。
- `npm run quality:secret` / `npm run quality:arch` / `npm run docs:check` / `npm run closeout`（读数如实）。

## 完成语义

八项各有当次证据且零放宽/零撤销裁决/零新增依赖才标 completed；
未达证据上限项逐件标 `done-partial` + 补腿条件，不用文档措辞升级运行时结果。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 收口笔录（2026-11-11 · BLOCK-431 / COMPLETED，8 项判据层 done / 生产接线 done-partial）

**交付（不委派）**：M5-1…M5-8 八类安全判据收敛为单一纯模块 `security-boundaries.js`：per-boot 随机 token + 空 Origin 全方法校验 + 废弃常量 Bearer 拒绝 / MCP stdio command 白名单 / drag 登记根 + realpath + basename + 长度上限 / 帧导航 allowlist（含 userinfo）+ 权限 session 全覆盖 / tar 条目与 zip 失败清理 / 假成功治理（`ok:false + code` 信封、静默 DDL 判红、拒绝全 0 统计）/ git grep 错误 fail-closed + 日志脱敏 / limit·offset 断言 + 原子写 tmp+rename。HK-01 15/15；门自身 7 项篡改必红全绿；`gate:m5-security` PASS 0 issues；lint 0；`quality:secret` / `quality:arch` / W5a / docs:check 576 / ui:audit 全绿。

**门禁实况（不写全绿）**：`test:changed` 1488 tests / 2 fail（UI-629 与 P6 两红均 W 类在制 WIP）；`closeout` **exit 1**（第 5 门拦停，前 4 门 PASS、后续 13 门 fail-fast 未执行）。

**范围守住**：`workspace_exec` 默认放行裁决零改动（git diff 0 行，仅补补偿控制与风险声明）；`MAX_AGENT_ITERS=Infinity` / ADMISSION / FK / MCP 计量 / 主题 / 中栏既有裁决全部保持；零新增依赖 / 零放宽基线 / 零触碰在制 WIP / 零 stage 零提交 / 零 G1+ 外推。

**done-partial + 补腿**：八项均为**判据层已交付、生产接线未做**。接线涉及 `bootstrap.js` / `mcp-client.js` / `file-dialog.js` / `main.js` / `secret-scan.mjs` / `ai-memory.js` 等跨模块安全改造，会触碰既有调用方与 12 环，须带 BLOCK-92 拆前拆后同套绿基线，按蓝图归 **M6-A / M6-C** 统一落地（不提前实现后续阶段）。逐件补腿条件见 `m5-evidence.json:deliverables[].closureCondition`，M7 gap-ledger 终态化。

**六维度评审**：无 P1；P2 一条（生产接线归 M6，不垫第五层兼容 shim）。ocr 本轮未做（可选外部工具、未装/未配置），按 skill 降级如实声明。

**证据**：`acceptance/m-blueprint-2026-11-11/m5/`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
