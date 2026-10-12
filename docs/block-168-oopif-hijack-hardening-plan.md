---
capability: gen-ui
goal: 关闭 BLOCK-166 knownGap 🟡——沙箱卡片被 fragment 内 location.href 劫持的 DoS 向量
acceptance:
  - Electron 44 升级复测事件矩阵有实证结论（可达/不可达二选一留痕）
  - 可达→事件守卫红绿；不可达→自愈守护红绿（劫持后自动恢复+telemetry）
  - 升级批回归=契约+gen-ui+pentest+test:changed+dev 冒烟全绿才保留升级，否则回退 41 只落守护
reopen: Electron 后续版本若原生修复可简化守护；劫持复现即返工
status: active
---

# BLOCK-168 — Gen UI OOPIF 导航劫持加固（Electron 44 复测 + 自愈守护）

## 0. 来源与裁决

- BLOCK-166 P3 knownGap 登记 🟡（AUDIT-LOG 2026-10-11）：fragment 内 `location.href` 赋值可把沙箱页劫为外域错误页（DoS 向量；安全边界未破=内容零逃逸）；will-navigate/will-frame-navigate/webRequest 三路 Electron 41 实测不可达；beforeunload 方案被 sandboxed-modals 抑制无效。
- 用户裁决链：「可以排期修」（2026-10-11）→「下一个工作包开整」（2026-10-12，本包=队列头唯一 planned）。

## 1. 范围

- **P0 升级复测**：electron 41.10.7 → 44.7.0（npm latest），实机跑 p3-pentest 路由 C location.href payload + 事件探针，记录 44 下 OOPIF 事件可达性矩阵（宿主 webContents / WebFrameMain / webRequest 三路）。
- **P1 守卫落地**（按 P0 结论二选一）：
  - A（可达）：宿主 webContents `will-frame-navigate` 对 petri-genui:// 帧的非本协议导航 `preventDefault()`+telemetry。
  - B（不可达）：**自愈守护**——GenUiCard 对卡片 iframe 加 load 守卫：`currentSrc`/URL 偏离 petri-genui:// 即重置 src 恢复 fragment（DoS 从「永久丢失」降为「瞬闪+自动恢复」），并上报计数。
- **P2 升级去留**：升级后回归（契约+gen-ui 33+pentest+test:changed+build+dev 冒烟）全绿→保留 44 并如实登记（audit/行为面差异扫描）；任一红→回退 41.10.7，仅落 P1-B（与 Electron 版本解耦）。

## 2. 非范围（exclusions）

- macOS 侧行为验证（G0 不外推；Windows 实机为准）
- 升级引入的无关行为面整修（发现即登记，不扩scope）
- 沙箱架构重设计（OOPIF→同进程方案另裁）

## 3. 证据与门禁

- 证据：`acceptance/block-168/`（事件矩阵探针输出/守护红绿/回归清单/升级 diff 摘要）
- 门禁：theme-token-contract + gen-ui 定向 + pentest（含新守护用例）+ test:changed + vite build + docs/ui 台账同提交
- 依赖变更：electron ^41→^44 按 DEPENDENCY-CHANGE-CHECKLIST 登记（用户裁决链在 §0；P2 回退条款为安全阀）

## 4. 完成语义

- knownGap 🟡 关闭或降级为「瞬闪自愈」形态并留证；两态均视为本包完成（以 P0 实证结论为准）
