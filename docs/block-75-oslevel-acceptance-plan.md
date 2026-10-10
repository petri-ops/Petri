# BLOCK-75 — OS 级验收自动化：原生对话框链路进 dev-verify（无人化阶梯第 3 级做实）

> 状态：`completed`（2026-09-10 立项即启动、同日收口——用户裁决「按顺序走下去」）
> 立项日期：2026-09-10
> truthDomain: `block-75-oslevel-acceptance`
> 来源：dev-infra SKILL.md「无人化验收阶梯」（用户裁决 2026-09-10）第 3 级的落地面工作包

## 1. 用户裁决

- 「后续如果想把第 3 级做实（比如给原生保存对话框写一个 OS 级自动化 flow），那是工作包体量的活，可以先立项 后续合适的时候再启动」（2026-09-10）。
- 同日配套裁决：无人化验收阶梯写入 dev-infra SKILL.md——① CDP 够得着 → dev-verify flow（无人）；② 够不着 + 低风险 → 诚实分级不凑证据；③ 够不着 + 高风险 → OS 级自动化优先；④ 人测兜底 = 自动产出测试路线 + 人体感确认「没问题」即通过。本包是第 ③ 级的做实载体。

## 2. 范围

- 首个目标链路：原生保存对话框（导出/另存为）三条断言链——保存到选定路径（文件落盘且内容正确）、取消（不落盘）、覆盖确认（替换语义正确）。
- 驱动层**复用 BLOCK-63 已收口的 Windows computer-use sidecar**（FlaUI 5.0 UIA3 语义层 + 八动词 + hwnd 直投 + 截图，P4 实机 allPass：真实驱动 Win11 记事本含 type/click/press/screenshot/WM_CLOSE 全链），不重建 OS 自动化层。
- 本包新增量 = 把 sidecar 接进 dev-verify flow 形态（注册 `npm run verify -- --list`，断言/证据 JSON/PNG 落 `acceptance/`，与 CDP flow 同一证据纪律）+ 目标对话框的控件面适配。
- 候选外溢（不在承诺内，首链跑通后评估）：dev-verify lib.cjs 增 OS 驱动原语（第五原语）。

## 3. 非范围（exclusions）

- packaged Electron 公证/签名/GA（G1+，G0 开发期常态不外推）
- macOS / Linux OS 级驱动（dev 栈为 Windows 实机；BLOCK-63 host 平台门 darwin|win32 之外的分支不在本包）
- 产品功能行为变更：导出/另存为本身只做验收自动化，不改产品代码语义
- CDP 够得着的 UI 断言（归阶梯第 ① 级既有 flow，不迁移）

## 4. 依赖与环境

- 启动前置：BLOCK-74 收口；队列在前的 planned 包（BLOCK-68/69/70 等）启动顺序由用户裁决（单工作包串行）。
- dev 栈：fnm Node 24 + dev Electron `PETRI_DEV_ELECTRON_ARGS="--remote-debugging-port=9222"`；Windows 实机。
- P0 先确认目标入口功能（当前产品哪个链路会弹原生保存对话框；若暂无入口，与用户裁决目标链路或先落测试钩子）。
- 已知边界沿用 BLOCK-63 登记：UAC 提权窗口不可自动化、锁屏不可达、Chromium/Electron UIA 懒启用、键盘注入两态（SendInput 主路径 + 被拦走消息级回退）；原生文件对话框是标准 Win32 控件树，预期覆盖良好（P0 实测确认）。

## 5. 验收门

- 新 flow 注册进 `npm run verify -- --list` 且实机跑绿；断言链 ≥3（保存/取消/覆盖确认）。
- 证据 JSON/PNG 落 `acceptance/`，断言不可编造；docs:check + hygiene:check 绿。
- 涉及 UI-### 时台账实现同提交登记；G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 完成语义

- 三条断言链实机全绿 + flow 进 verify 注册表 + canonical 回写（plan/registry/roadmap/handoff/AUDIT-LOG）→ `completed`。
- 若实测发现 sidecar 驱动目标对话框不可行（如对话框处于提权上下文），以 postmortem 落结论：阶梯第 ④ 级（自动测试路线 + 人测确认）继续兜底，本包 `completed` 或 `deferred` 由用户裁决。

## 7. 进度记录

- 2026-09-10 **启动（planned → active，P0-LAUNCH）**：用户裁决「按顺序走下去」（队列首位，前置 BLOCK-74 收口已满足，2026-09-10）。**P0 目标链路确认（代码事实）**：`diagnostic:export`（`src/ipc/diagnostic.js`——设置页「导出诊断日志」真实按钮 `ExportDiagnostic.tsx` → 原生保存框 title「导出诊断日志」/ defaultPath `petri-diagnostic-<ts>.zip` / ZIP filter → 落盘 zip 可校验；取消返回 `{ok:false,error:'cancelled'}`；Windows 原生覆盖确认由系统对话框自带）；`file:save-dialog` 虽有 IPC 通道但前端零消费方，不选。驱动面确认：sidecar exe 已构建（`bin/publish/petri-computer-use-windows.exe`），flow 经 `computer-use-host` 单例直调八动词（host 层 screenshot `out` 可直落 acceptance/），触发方式=CDP 调 `window.petriDesktop.diagnostic.export()`（与按钮同链路，不 await，弹窗期间 evalJs 返回）。下一步：P0 实测探测（sidecar snapshot 能否读到对话框控件面）→ P1 flow 三断言链。
- 2026-09-10 **P0 实测探测 9/9 allPass + 抓真修一**（`scripts/block75-p0-probe.cjs`，`acceptance/block-75/`）：**P0 首跑即抓到真产品缺陷**——`diagnostic:export` 链路在 HEAD 上完全坏死：`src/ipc/diagnostic.js` require `./diagnostic-redaction`，而模块本体在 `src/diagnostic-redaction.js`（BLOCK-9.1 抽取后相对路径未跟改；require 位于 handler 体内，主进程正常启动、用户点「导出诊断日志」即死，dialog 都不弹）。修复一行 + 新增 `test/ipc-relative-requires.test.mjs` 机械门禁锁死「抽取搬文件、相对 require 未跟」缺陷类（全 src/ipc/ 扫描仅此一处漂移）。**探测另得三条 OS 级事实**：① 弹窗受 Windows 前台锁影响不一定是前台窗口，sidecar frontmost 快照不可靠——改为 EnumWindows 枚举 electron 顶层窗口（class #32770 + 标题）按 hwnd 直投（`scripts/block75-enum-windows.ps1` + `scripts/lib-block75-os.cjs`；ps1 标题走 base64 输出规避控制台编码不可控，ps1 必须 ASCII-only——PowerShell 5.1 对无 BOM 文件按 ANSI 解析，UTF-8 中文注释会炸 here-string）；② Electron 在 Windows 忽略自定义 title，对话框固定标题「另存为」（确认弹窗「确认另存为」）；③ 控件面完整可读可驱：文件名 Edit「文件名:」ValuePattern 写入、保存(S)/取消/是(Y)/否(N) 均 UIA Invoke（后台窗口可用）。探测 9/9：对话框定位/文件名框可读/保存取消按钮可读/对话框截图/取消点击/IPC 诚实 cancelled。
- 2026-09-10 **P1 flow 三断言链 18/18 allPass（整包收口）**：`flows/os-save-dialog.cjs` 注册进 `npm run verify -- --list`（契约同 CDP flow：lib.createRun 证据落 `acceptance/block-75/os-save-dialog-live.json` + 截图）。**A 保存落盘**（对话框出现/ValuePattern 键入完整路径/zip 落盘 14868 bytes PK 魔数/IPC ok:true path 对账）；**B 取消不落盘**（对话框复现/IPC 诚实 cancelled/磁盘无文件）；**C 覆盖确认替换语义正反两面**（对已存在文件保存→「确认另存为」弹窗出现→是(Y)=内容替换为新 zip + IPC ok；再保存→否(N)=IPC cancelled + 文件字节与 mtime 原样，否分支后对话框留在屏上需补取消——flow 已处理）。flow 首跑 17/18：C4 失败为 flow 自身时序缺陷（覆盖目标文件预先存在，存在性等待瞬间读到替换前旧字节）——改等待内容变化后全绿。impact-map 新增 block75 规则（diagnostic 链 + block75 脚本 + flow + 证据目录 → ipc-relative-requires/diagnostic-redaction/dev-verify 测试）。
- 2026-09-10 **收口**：验收门对账——flow 已注册 `npm run verify -- --list` 且实机 18/18 全绿（断言链 3+1：保存/取消/覆盖确认是+否）；证据 JSON/PNG 落 `acceptance/block-75/`；`test/ipc-relative-requires.test.mjs` + `test/diagnostic-redaction.test.mjs` + `test/dev-verify.test.mjs` 5+3+5 全绿。**门禁**：hygiene ✅ / docs:check ✅ / ui:audit:check ✅；test:changed 4 处 node 存量失败（g0-rs-p6×2=2026-08-30 已登记存量漂移；terminal-multisession-ipc / migration-runner 本包 stash 复验同败实证存量）——与本包文件面无关，如实归属不表述为本包通过。**canonical 回写**：plan/DOC-REGISTRY（completed）/AUDIT-LOG；roadmap/handoff 不追加重型章节（近期收口惯例：可恢复真相由 plan+registry+AUDIT-LOG 承载，治理纪律「仅在可恢复状态实际变化时更新」）。**当前无 active 工作包**，队列下一项待用户裁决。G0 开发期常态 · 不外推 packaged/Provider/GA。
