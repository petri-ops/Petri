# item 90 阶段一 Result Studio 可逆下架 — 验收证据（2026-11-27）

## 范围声明

阶段一=可逆下架（flag 门控），阶段二=物理删除（owner 二次确认后另派，不在本批）。
Acceptance 只证明其契约声明的范围：flag off 后 RS 入口不可达 + 双表面映射钉 + 数据只读保留。

## HK-01 红绿证据

红（实现前）：`test/item90-result-studio-flag.test.mjs` 全红（result-studio 决策点不存在）。

绿（实现后）：
- 后端 4/4（HK-90-1 默认 off 注册+schema 双登记 / HK-90-2 六入口 404 result_studio_disabled /
  HK-90-3 env 种子恢复可逆 / HK-90-4 影响面清单五节+映射表逐行判定）
- 前端 3/3（ResultsSurface.flag.test.tsx：off 零 RS 拉取 / on 可逆 / 证据面同语义）
- 既有 ResultsSurface/EvidenceSurface 13 测补 flag-on mock 全绿（off 态测试独立成文件）

## 门禁（CI 等价，2026-11-27 本地）

- 11 静态门全绿 + platform 33 绿 2 skip + harness 106 + 前端 tsc/build:spa ✅
- `test:changed`：635 测 631 绿 / 3 红 / 1 skip——3 红全部 base 回退核真存量：
  P6 源绑定、W5a 棘轮、block160（缺 DB 自举族）。

## 本批修复的顺带项（如实登记）

1. **三例同类上游错位**：acceptance 目录 pattern 误入 impact-map tests 数组
   （item89 / item83-mock-real-gap / item88-workbench-wave2）→ 全部移回 patterns；
   建议提醒各 seat：tests 数组只放测试文件。
2. **block201 配置冻结重锚 117→125**：117→124 为上游存量漂移（base 核真），
   124→125 为本批 +point.result-studio.enabled（与 point.workbench.enabled 同形态）。
3. **item86 遗留补登记**：acceptance/item86-verify-clean-cycles/** pattern（彼批漏，test-affected 红暴露）。

## 待 owner / coordinator

- 4 缺口裁决（阶段二物理删除前置）：编辑链退役确认、血缘承接、跨会话产物级浏览、交互表格查看器。
- 恢复方式（如需）：设置 → 决策接点 → result-studio 开，或 env `PETRI_RESULT_STUDIO=1`。
