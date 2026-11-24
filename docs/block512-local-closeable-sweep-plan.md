---
capability: block512-local-closeable-sweep
status: active
kind: work-package
canonical: true
truthDomain: block512-local-closeable-sweep
entrypoint: docs/README.md
registeredAt: 2026-11-24
owner: main-agent
---

# BLOCK-512 · 本地可闭环清扫包（plan）

> 发令：owner 经 Orca 转达主人原话「那你系统性梳理一下吧 能干的都干完」（2026-11-24）——覆盖本计划范围内各项的开工授权。前置批=C-32 核码归位（`9ec0b172c`，已 push）。
> 教训输入：C-32（登记滞后第 7 例）——**每项先核码/核台账真值再信登记**。

## 1. 范围（三项，串行执行，每项独立提交）

### P1 web_fetch pin-IP（M · HK-01 红绿先行）

BLOCK-511 唯一遗留（§2 第 8 项 / §五.1）：`guardedFetch` 先解析校验全部地址、再交 `fetchImpl` 建连——undici 自行重解析，校验与建连之间存在 DNS rebinding TOCTOU 窗口。S3 时按「零新依赖不破注入契约」登记遗留。

本包修法（零新依赖）：
- `guardedFetch` 增 `transportImpl` 注入点，**默认通道**改为 Node 内建 `http/https` + 自定义 `lookup`（只返回已校验地址，建连层不再查 DNS）+ `servername=host`（SNI/证书身份不变）+ 流式有界读体（超限即断流，语义同 `readBodyBounded`）+ 手动超时（错误名映射保持 `web_fetch_timeout`）。
- 逐跳重校验/私网拒绝/黑白名单/内容类型白名单全部保留，不削弱防护。
- `fetchImpl` 注入契约保留（16 项既有测试不动）——文档明示该通道为测试/兜底、不 pin-IP；生产路径零注入故默认走 pinned 通道。
- HK-01：`test/block512-web-fetch-pin-ip.test.mjs` 先红（现码无 transportImpl/pin）后绿；覆盖=pinned lookup 单次解析、servername、超时映射、有界截断、重定向第二跳重新 pin、fetchImpl 兼容；另有可跳过的 live smoke（离线 skip 显式原因）。

### P2 bash/tar 测试健壮化（S）

AUDIT-LOG 🟡（2026-10-20）：Windows 机 `bash`→WSL launcher、`tar`→bsdtar 致 block67/89 与 capability-bundles 整类**假红**。修法=测试显式路径化：共享 helper 解析 `bash`/`tar`，识别 WSL launcher / 非 GNU tar 时**显式 skip 带原因**（假红→诚实 skip），检测逻辑可注入单测；macOS/正常 Git Bash 环境行为不变（本机全绿为证据，Windows 实机验证属外部环境、如实登记不可达）。

### P3 台账残留机械归位（S · 纯文档）

核码/核台账后确认的过期登记（不改历史叙述，按 D-CLASS 先例翻正+注记）：
- backlog `C-53` 行（:300）与 `C-55` 行（:297）仍 planned/queued，header(:3) 与 AUDIT-LOG 已 completed（C-53 八期全交付 / C-55 P0–P4 全链交付）。
- remaining-work-plan B 类表 `G0 qualified 视觉证据`（:32）与 `UI-706/707/709/710`（:34）两行未随 11-24 执行结果标记（note ① ② 已载明）。
- AUDIT-LOG 活跃表 `UI-713 / ACTIVE` 行（:98）——台账 UI-713 已于 2026-11-19 用户口令 verified。

## 2. 非范围（exclusions）

- 等用户裁决：C-56 英文面判据；G0 distinctStates 实机红维持「诚实红不补拍」。
- 等外部真值：D-01/D-03/D-05、UI 实机缺腿组（UI-693/663/595/593/475/482/522）、UI-650/468、C-EXT-2、C-01 观察态、Windows 实机 PATH 修复本身。
- 工作树 19 项未跟踪 WIP 与 frogfish 分支：零触碰。
- AUDIT-LOG 活跃表中带处置说明的历史 COMPLETED 行：不动（D-CLASS 既定口径，audit:compact 自稳管辖）。
- G1+ 一律不碰。

## 3. 依赖与红线

- 零新依赖；HK-01 红绿先行（P1）；台账追加式写/显式路径提交；定向测试优先；观感零代签。
- dev 栈不涉及（P1 无需实机 Electron；live smoke 用独立端口 HTTP 服务）。

## 4. 验收门禁（收口逐项对账）

- P1：block512 红绿证据 + block247 双文件（web-policy/web-tools）+ qoder-l1l2 定向全绿。
- P2：新增 helper 单测绿 + block67/capability-bundles 本机绿。
- P3：docs:check + ui:audit:check 绿。
- 收口：`npm run closeout` 全门（存量红如实归属）。

## 5. 完成语义

三项各有独立提交；本 plan + registry + AUDIT-LOG 同批收口翻 completed；证据=acceptance/block512-local-sweep-2026-11-24/。G0 开发期常态 · 不外推 packaged/Provider/GA。
