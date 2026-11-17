# BLOCK-457 — dev 后端单一所有权根治（唯一 spawner + 绑定前置 + 唯一测试入口）

- 立项日期：2026-11-17
- 状态：**completed（P0-P6 当日一次会话收口 · Windows 实机 7 断言全过）**
- 用户裁决：「我希望根治  应该避免多重启动  后续测试有一个唯一入口即可」（2026-11-17，本会话）
- 形态：BLOCK（跨模块结构性修复，PATCH/REFACTOR 判定=scoped refactor：双 spawner 是脑裂家族第一结构性根因，attach/复用端口号都是叠加补丁，单一所有权吸收全族——治理 skill 三信号全命中）
- 关联：BLOCK-128 脑裂家族（dev-infra §76.1 长期条款）；BLOCK-414（2026-11-11，本包定位的直接回归引入点：探到 3001 是自己的后端后只复用端口号、仍 spawn 第二进程 → EADDRINUSE 崩溃循环）；AUDIT-LOG 🟡 MIGRATION-IDEMPOTENT（相关但非本包范围）

## 0. 根因链（诊断证据，2026-11-17 实机抓取）

1. `scripts/dev-electron.js` 用 npm 先起后端 A 占 :3001（健康），随后 Electron main 无条件再 spawn 后端 B。
2. B 的启动顺序是**先 require 全部业务模块、最后才 listen**——而 `agent-task-store.js` 模块加载即执行 `sweepInterruptedRunningTasks`：每个僵尸 boot 都把共享库里 `status='running'` 的任务改 `failed`+「服务重启，Agent 任务中断」。实机 4 条清扫记录与 4 个 `interrupted_at` 毫秒级吻合（07:57:38 / 07:58:39 / 07:59:40 / 06:09:48）。
3. B 每 30s 循环（supervisor 固定重试）：当日 749 次 boot / 734 次 EADDRINUSE，6 小时不间断。
4. 回归引入：BLOCK-414（2026-11-11）让 main.js 探到「3001 是我们的后端」后**复用端口号但仍 spawn**，把 §76.1 的「随机端口双后端脑裂」升级成「确定性端口碰撞崩溃循环」。两代同根=两个 spawner。

## 1. 范围（scope）

**单一所有权三件套 + 防线固化：**

1. **server.js 绑定前置（bind-first fail-fast）**：`core/petri-server/server.js` 拆为薄 bootstrap（端口试绑成功才放行加载业务模块；失败单行日志 + `process.exit(77)`，零 DB 副作用），现文件体迁入 `server-main.js`（entry 路径、`npm start`、packaged 布局不变）。bootstrap 生成 `PETRI_INSTANCE_ID`（crypto.randomUUID）。
2. **supervisor 不可重试退出码**：`createOwnedBackendSupervisor` 增加 `noRetryExitCodes`（默认含 77），命中则不重试、单行诚实日志——绑定类失败不再产生 30s 噪音循环。
3. **main.js 探活 attach（身份校验）**：`/api/health`（routes/index.js，活跃 handler）增加 `instanceId` / `pid` / `dataDir`；`selectBackendPorts` 的 BLOCK-414 复用路径升级为身份判定——dataDir 同源 → `attachExisting: true`（复用 BLOCK-100 attach 桩，不 spawn）；异源/不可达 → 现行为（fallback 端口或 3001）spawn。主路径 spawn 后 `waitForBackendHealthy` 兜底，未就绪诚实弹窗退出。
4. **wrapper 单一所有权**：`scripts/dev-electron.js` 删除自起后端（npm start + waitForUrl）与迁移子进程（main.js 已拥有两者，packaged 同链）；保留 env 对齐、vite 保障、3001/3000 退场清扫（孤儿安全网）、Electron 拉起与就绪等待。
5. **唯一测试入口确认**：`start-test-instance.sh`（CDP 9223、离屏、零 fork attach :3001）保持为唯一测试实例入口；本包验收含其回归。
6. **文档与条款**：dev-infra SKILL「端口与后端实例纪律」第 1 条改写（双后端既成事实 → 单一所有权已落地 + 新诊断口诀）；AUDIT-LOG BLOCK-128 家族条款收敛登记。

## 2. 非范围（exclusions）

- **sweep 实例归属判据（ownerInstanceId + 心跳表）**：bind-first 后僵尸 boot 在模块加载前即退，跨实例误扫结构性不可达；真清扫语义增强登记 backlog（BACKLOG 追加行），不在本包实现。
- 🟡 MIGRATION-IDEMPOTENT（迁移幂等共存缺口）：独立小包，处置仍待用户发令。
- mobile-gateway :3005 的绑定前置：fail-open 且单行日志，不在本包。
- server.js:330 的影子 `/api/health` 注册（被 routes/index.js 先注册者遮蔽，永不触达）：本包只给活跃 handler 加字段；影子登记 backlog，不删（删属独立清理）。
- `restart-dev-stack.sh` 行为不变（清场后直启 electron，天然单后端）；Mac 侧对称冒烟留待 Mac 会话（跨端脚本纪律 §76.8）。
- packaged/Provider/GA 一切事项（G0 开发期常态，不外推）。

## 3. 依赖与文件面

- 代码面：`core/petri-server/server.js`（拆分）、新增 `core/petri-server/server-main.js`、`src/owned-backend-supervisor.js`、`src/main/_backend-ports.js`、`src/main.js`、`scripts/dev-electron.js`、`core/petri-server/routes/index.js`、`src/main/backend-proc-manager.js`（supervisor 参数）。
- 测试面（源码扫描路径 server.js → server-main.js 机械更新）：`test/block157-pack-enabled.test.mjs`、`test/post-s7-h9-structural-gates.test.mjs`、`test/block328-early-loop-guard.test.mjs`、`test/env-coordinator-port.test.mjs`、`test/block145-tunnel-async.test.mjs`、`test/block353-artifact-check.test.mjs`（仅路径字面量）；新增 `test/block457-*.test.mjs`。
- 零新依赖（crypto.randomUUID / net / fetch 全内建）。
- **零触碰**：另一 agent 在制 4 文档（`docs/DOC-REGISTRY.json` 之 Gen-UI 条目除外的新增行、`docs/README.md`、`docs/next-work-blueprint-2026-11-16.md`、`docs/gen-ui-data-plane-evaluation-2026-11-17.md`）——本包对 DOC-REGISTRY/README 只做本包条目追加，不碰他包条目内容。

## 4. 验收门禁（收口时逐项对账）

1. HK-01 红绿先行：新契约测试先红后绿——
   - `test/block457-bind-first.test.mjs`：占口场景下真实 spawn `node server.js` → 秒级 exit 77 + 单行守卫日志 + **temp dataDir 零文件产生**（零副作用实证）；
   - `test/block457-supervisor-no-retry.test.mjs`：exit 77 → 不重试；
   - `test/block457-ownership.test.mjs`：attach 决策表四行（同源 attach / 异源 fallback / 异进程 fallback / 空闲 spawn）。
2. 既有源码扫描六测试拆分后仍绿（路径更新后全量跑）。
3. 定向 `npm run test:changed` 绿 + `docs:check` + `ui:audit:check` + `quality:secret/arch/lint/types`（closeout 十一门）。
4. **实机断言（9223 离屏测试实例 + 直启栈）**：
   - `npm run dev`（wrapper）起栈后 :3001 **恰一个** petri-server 监听者（netstat PID 归属核对）；
   - wrapper 日志零 EADDRINUSE、server 日志 session-start 单次；
   - 占口注入场景（预占 3001 假进程）→ Electron 秒级诚实失败/attach，无循环；
   - `restart-dev-stack.sh` 起栈单后端；
   - `start-test-instance.sh` attach 回归（唯一测试入口在制）；
   - dev-verify 在册 flow 一条回归绿。
5. 证据落 `acceptance/block-457/`。

## 5. 完成语义

- P0 立项 → P1 红绿先行 → P2 绑定前置+supervisor → P3 身份探活+attach → P4 wrapper 收权 → P5 实机验收 → P6 台账/skill/closeout。一次会话收口为目标，P5 实机腿如实记录（外部阻碍诚实登记）。
- 完成定义：§4 全绿 + canonical 回写（AUDIT-LOG 收口行 / registry completed / README 条目 / dev-infra §76.1 改写）；观感类不涉及。
- 本包不宣称「多实例问题绝迹」，宣称的是：**spawner 唯一 + 绑定失败结构性无害**（fail-fast 单行退出、零 DB 副作用、不重试）。

## 6. 收口笔录（2026-11-17 · P0-P6 一次会话）

**落地清单**（全部按 §1 范围交付）：
- `core/petri-server/port-guard.js`（新，零依赖可测内核）+ `server.js` 拆薄 bootstrap（绑不上 exit 77 单行、PETRI_INSTANCE_ID 每 boot 生成、handle 直移交）+ `server-main.js`（原体零逻辑搬运，`listen(portHandle)` 收编已绑 socket——Node 形态实证：`{ handle }` 包装不可用、直传 net.Server 可用）
- supervisor `noRetryExitCodes`（默认名单=空，`backend-proc-manager` 传 [77]；77 数值以注释跨 R5 边界对账，双向测试钉住）
- `/api/health` 身份三字段（routes/index.js 活跃 handler）+ `src/main/backend-ownership.js`（探活+决策表）+ `selectBackendPorts` 身份判定升级（BLOCK-414 的「复用端口号仍 spawn」→「同源 attach / 异源 fallback spawn」）+ `env-coordinator.resolveLocalDataDir` 单源 + main.js attach 接线与 20s 就绪兜底（不健康诚实弹窗退出）
- wrapper 删自起后端与迁移子进程（env/vite/退场清扫/Electron 拉起保留）；唯一测试入口 start-test-instance.sh 零改动仅回归

**验收读数**（证据=acceptance/block-457/p5-live-acceptance.json）：HK-01 红（ownership 6/6、supervisor 1/4、bind-first C2/C3）→绿（17 pass/1 honest skip/0 fail）；六源码扫描套件拆分后 26 pass/0 fail/3 既有 skip；实机七断言 A1-A7 全过（两次独立 boot 单监听者 + 身份字段 + 单 session start + 新 boot 零 EADDRINUSE + 活体双 spawn exit 77 + 测试实例入口 exit 0 + app-health 4/4）。

**test:changed 全量 1316 项 16 红逐项归因**：14 既有（BLOCK-454 工具数 115→117 基线漂移家族 ×6、canonical 人眼门、W5a、stored-acceptance（ui-421/ui-703-wide-header 未登记，属原包）、L1-6 Windows 权限位、瞬态 ×2〔block48/63 复跑绿〕）——归属原包不洗桶；2 项本包相关已处置（keychain 平台护栏诚实 skip；platform-branch-freeze 按其自留登记制将本包 test 文件入 BASELINE）。

**十一门终态**：hygiene（EOL 归一 11 文件后 PASS）/ui-audit/docs:check（仅余 post-h9 换机漂移既有红，D5 处置权在用户）/test:changed（归因如上）/code-size（基线重打：main.js +33 行本包增量 + DesktopSettingsPanel UI-708 提交时未重打的既有指纹漂移）/arch-cycles/secret/arch/lint/types/knip 全绿。**两笔跨包机械清偿留痕**：①eslint-suppressions +5 行＝DiagnosticsRelocation.test.tsx 两处 no-unnecessary-type-assertion（UI-704 加映五提交时漏跑 lint 门；tsc 证明断言必要、eslint 类型服务判不必要＝类型服务分歧行误报，按 BLOCK-105 误报豁免通道 --suppress-all 入库，本文件零触碰）；②knip 基线 +2 flow（ui704-diagnostics/ui708-wave2＝原包 dev-verify 动态入口，合法保留）-1（local-token.cjs 已不存在，随真相下调）。

**留账（backlog/后续包）**：① sweep 实例归属判据（ownerInstanceId+心跳）——bind-first 后结构性不可达，语义增强登记 backlog；② server.js:330 影子 `/api/health` 注册清理；③ Mac 侧对称冒烟（§76.8 条款，Mac 会话首次使用 dev-electron.js 前执行）；④ 🟡 MIGRATION-IDEMPOTENT 独立小包仍待用户发令。

**dev-infra §76.1 条款已随根治改写**（双后端既成事实→单一所有权三道防线+唯一测试入口+Mac 冒烟待办）；`npm run dev` 与 `restart-dev-stack.sh` 两起栈入口现均单后端等价。G0 开发期常态 · 不外推 packaged/Provider/GA。
