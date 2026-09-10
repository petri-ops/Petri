# BLOCK-75 — OS 级验收自动化：原生对话框链路进 dev-verify（无人化阶梯第 3 级做实）

> 状态：`planned`（2026-09-10 用户裁决先立项，后续合适的时候再启动；启动按单工作包串行纪律排队）
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
- dev 栈：fnm Node 24 + dev Electron `BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222"`；Windows 实机。
- P0 先确认目标入口功能（当前产品哪个链路会弹原生保存对话框；若暂无入口，与用户裁决目标链路或先落测试钩子）。
- 已知边界沿用 BLOCK-63 登记：UAC 提权窗口不可自动化、锁屏不可达、Chromium/Electron UIA 懒启用、键盘注入两态（SendInput 主路径 + 被拦走消息级回退）；原生文件对话框是标准 Win32 控件树，预期覆盖良好（P0 实测确认）。

## 5. 验收门

- 新 flow 注册进 `npm run verify -- --list` 且实机跑绿；断言链 ≥3（保存/取消/覆盖确认）。
- 证据 JSON/PNG 落 `acceptance/`，断言不可编造；docs:check + hygiene:check 绿。
- 涉及 UI-### 时台账实现同提交登记；G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 完成语义

- 三条断言链实机全绿 + flow 进 verify 注册表 + canonical 回写（plan/registry/roadmap/handoff/AUDIT-LOG）→ `completed`。
- 若实测发现 sidecar 驱动目标对话框不可行（如对话框处于提权上下文），以 postmortem 落结论：阶梯第 ④ 级（自动测试路线 + 人测确认）继续兜底，本包 `completed` 或 `deferred` 由用户裁决。
