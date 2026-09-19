# BLOCK-100-CDP-TEST-INSTANCE — CDP 实机验收测试实例隔离基建

状态：completed / P6-CLOSEOUT（2026-09-18 立项即启动当日整包收口；用户裁决原话「我希望是一个比较全面稳定的基建包」——选定测试实例窗口路线并要求全面稳定）

## 1. 背景与问题（双因实证）

CDP 实机验收（dev-verify flow / 探针）与用户日常使用共用同一个 Electron 主窗口，双向干扰：

1. **人扰测试**：用户点击正在测试中的界面 → 断言失败/时序错乱。
2. **测试扰人**（2026-09-18 UI-406 实探抓真）：探针 `Page.navigate` 把用户开着的窗口导航到投影页未还原 → 用户「项目列表没了」。教训已登记 AUDIT-LOG/记忆。

## 2. 方案定案（用户裁决）

用户否决「输入屏蔽/流程纪律」轻量路线，选定**测试专用实例窗口**：独立 Electron 实例（独立 userData 绕单实例锁 + 离屏可见窗口 + 独立 CDP 端口 9223），与用户窗口双向完全隔离。不引入 Playwright（`_electron.launch` 为生态解但新依赖+重写 dev-verify 体系，不合算）。

**关键实测反例（设计红线）**：隐藏/最小化窗口不可用于验收——`visibilityState=hidden` 冻结视口、懒渲染跳过（restart-dev-stack.sh 注释留档）；最小化 rAF 恒暂停。→ **离屏可见**（摆到屏幕外坐标，渲染管线全速）。

## 3. 摸底结论（P0）

- 单实例锁：`src/main.js:165` `app.requestSingleInstanceLock()` 无参版本，按 userData 路径锁——测试实例设独立 `BIOF3_ELECTRON_USER_DATA_DIR`（main.js:83 在锁之前生效）即天然共存。
- 后端：`--dev` 模式主实例 fork biof3-server（:3001，`R_SERVER_PORT` 贯通 preload `backendConfig.rApiBase`）。**测试实例禁止再 fork**（端口冲突）→ 跳过 migration + 跳过 `startRServer`，`R_SERVER_PORT` 指向既有后端，启动时轮询 health 就绪、缺席 fail-fast 诚实报错。
- 启动器：`restart-dev-stack.sh` 用 `Start-Process` 分离存活家法；`BIOF3_DEV_ELECTRON_ARGS` 机制已在 `dev-electron.js:440` 消费。
- flow 清单：11 个 dev-verify flow（`app-health` / `ui341-welcome-chat` / `workspace-file-ops` / `block94-knowledge` 等），渐进迁移不强制一次全迁。
- dev-verify lib：`pollTargets({port})` 已支持自定义端口——测试实例 CDP 9223 直接可用。

## 4. 工作面

- **P1 主进程测试实例分支**：`BIOF3_TEST_INSTANCE=1` → 跳过 db migration 与 `startRServer`（轮询 `/api/health` 就绪，缺席 fail-fast）+ 离屏可见窗口 + `[TEST]` 标题前缀。userData 由启动器经 `BIOF3_ELECTRON_USER_DATA_DIR=.biof3-test-user-data` 提供。
- **P2 启动器** `scripts/start-test-instance.sh`：独立脚本（不动 restart-dev-stack.sh）；spawn Electron `--dev` + `BIOF3_DEV_ELECTRON_ARGS=--remote-debugging-port=9223`；Windows `Start-Process` 分离存活家法；就绪断言（9223 targets + backend health）。
- **P3 dev-verify lib 扩面**：`connectTestTarget()`（默认 poll 9223、`?test=1`/`[TEST]` 双标记过滤兜底）+ `withInputShield()`（`Input.setIgnoreInputEvents` 包裹 + finally 恢复——仅只读断言 flow 适用，会连合成输入一起屏蔽）+ 流程纪律 helper（记录/还原原页面，向后兼容仍连主窗口的旧 flow）。
- **P4 flow 试点迁移**：`app-health` + `ui341-welcome-chat` 迁测试实例（代表性覆盖基础健康 + UI 交互两型）；其余 flow 渐进迁移。
- **P5 实机验收**：①双实例并存——测试运行中用户窗口正常可用零扰动；②人因干扰负例——测试运行中点击测试窗口不致断言失败；③迁移 flow 断言全过；④探针崩溃兜底（input shield finally 恢复）。
- **P6 收口**：门禁 + 台账 + 本 plan 回写。

## 5. 预置裁决项（D1-D6，全按推荐先行留痕）

| # | 裁决点 | 推荐 |
| --- | --- | --- |
| D1 | 测试 userData 位置 | 仓库根 `.biof3-test-user-data`（与 dev 数据根并列，gitignore） |
| D2 | 测试实例 CDP 端口 | 9223（9222 留主实例） |
| D3 | 离屏坐标 | 主屏左缘外（x=-(宽+100)，y=40），visibilityState=visible |
| D4 | 首批迁移 flow | `app-health` + `ui341-welcome-chat` |
| D5 | 启动器形态 | 独立 `start-test-instance.sh`，restart-dev-stack.sh 不动 |
| D6 | input shield 范围 | 仅只读断言 flow；交互型（合成点击）flow 不用 |

## 6. 红线与非范围

**红线**：测试实例零 fork 后端、零 migration（主实例拥有 DB 生命周期）；数据同源 :3001（验收语义不变，临时项目+清理还原家法保持）；测试实例崩溃不影响用户实例；**探针永久禁导航用户窗口**（今日教训成文）。
**非范围**：Playwright/新测试框架；单实例锁语义变更；全量 flow 一次迁移；打包态（`BIOF3_TEST_INSTANCE` 仅 dev 消费）；手机投影不受影响。

## 7. 验收门禁

- 主进程分支：契约测试（测试实例标记消费/跳过逻辑纯函数化可测）
- lib 扩面：connectTestTarget/withInputShield 单测
- 实机 P5 四断言全过 + 截图/JSON 证据 `acceptance/block-100/`
- `npm run docs:check` + `npm run ui:audit:check` + 迁移 flow 全绿
- dev-verify flow 注册 `block100-test-instance`

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 8. 收口笔（2026-09-18，P0–P6 一次会话整包 completed）

**交付**：P1 主进程 `BIOF3_TEST_INSTANCE=1` 分支（attach 后端〔markBackendAttached 桩→backend:status 走真实 health 探测，防误报「服务未运行」〕+ 跳过 migration/contentSync + 端口直读 R_SERVER_PORT 防 reserveAvailablePort 误选 3002 + 离屏可见窗口 x=主屏左缘外 1700px + `[TEST]` 标题 + `?test=1` URL 标记）；P2 `scripts/start-test-instance.sh`（后端缺席 fail-fast/幂等杀 9223 监听者绝不碰主实例/Start-Process 分离存活/就绪断言）；P3 lib 扩面 `connectTestTarget`（9223+?test=1 双重防误连用户窗口）+ `withInputShield`（`Input.setIgnoreInputEvents {ignore}` + finally 恢复，D6：仅只读 flow）；P4 flow 试点迁移 app-health + ui341-welcome-chat（poll 端口切 9223）；P5 flow `block100-test-instance` 注册。

**实机总账**：start-test-instance.sh 3s READY；双实例并存（9222 用户页原样 + 9223 ?test=1）；app-health **4/4**、ui341-welcome-chat **11/11**（真轮次 SSE 对话+自清理）、block100-test-instance **5/5**（离屏 visible/屏蔽吞输入/恢复放行/崩溃兜底/用户零扰动）；证据 `acceptance/block-100/` + `acceptance/ui-341/`。

**实机抓真 1 件（P1 关键修复）**：`main.js:616` dev 分支无条件 `appendSwitch("remote-debugging-port","9222")` 会压过 argv 的 9223 → 测试实例去抢主实例 9222 → DevTools HTTP bind 0x2740 失败（两次复现）；修=`hasSwitch` 守卫不覆盖显式 argv。**另修并行会话拉回提交自带存量红**：ui404 探针脚本 impact-map 漏注册（分类冲突）+ ui-403/404 evidence.json 未映射（test-affected:94 自带断言要求全映射）→ 按 acceptance-script-owned 先例补注册。

**门禁**：hygiene ✅ / docs:check ✅ 254 / ui:audit ✅ / dev-debug-scripts 4/4 / test:changed 提交后复验（P6 两段红语义：未提交 tree_not_exact；若提交后仍红=触碰绑定文件归 D8 族 G0-RS 重采，如实登记）。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 9. 增量收尾（2026-09-19）：其余 dev-verify flow 全量迁移测试实例

非范围登记「全量 flow 一次迁移」兑现（渐进模式，一次会话收尾）。9 个剩余 flow 处置：

- **迁绿 7**（`pollTargets` 加 `port: lib.TEST_INSTANCE_PORT`，交互/断言零改动全过）：workspace-panel-motion **6/6** / app-rail-persistent **7/7** / ui342-endpoint-grid **6/6** / block83-tool-catalog **8/8** / workspace-file-ops **14/14** / os-save-dialog **18/18**（sidecar hwnd 直投原生对话框对测试实例照常工作）/ pack-lifecycle **24/24**（真实 deseq2 R 作业 + A9 重装恢复现场）。
- **无需迁移 1**：block96-ssh-channel（flow 自述不依赖 dev Electron 栈，纯真节点通道测试，实例无关）。
- **迁移完成但本机环境缺凭据 1**：block94-knowledge——UI 操作/上传/摄取触发全链正常，嵌入步诚实 `knowledge_embed_unavailable`：**本 Windows 机 ai-credentials.json 从未配置 DashScope key**（Mac 侧 09-18 18/18 的环境前提）。flow 已补前置注记；本机跑绿需用户配置 key，或以 Mac 侧证据为准。**非迁移回归**。
- 迁移期抓真 1 件（存量漂移，非本批引入）：ui342 flow 仍导航 `/project/:id/settings`——该路由已随 UI-366 独立页化裁撤，修为直航 `/settings` 并解除项目依赖。

**结论**：除实例无关与环境缺凭据两例外，全部 dev-verify flow 均已测试实例化——实机验收与用户主窗口（9222）永久隔离的红线自此全量生效。G0 开发期常态 · 不外推 packaged/Provider/GA。
