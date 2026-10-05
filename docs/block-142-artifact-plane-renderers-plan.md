---
capability: artifact-plane-renderers
goal: 成果面切片 E——renderer 补课：md/xlsx/pdf 三 viewer 注册（viewerRegistry 规则表+Shell renderPreview 接线），兼作切片 A 扩展性判据验收（加 viewer 容器近零改动）
acceptance:
  - 注册表契约先红后绿（.md/.markdown→markdown、.xlsx/.xlsm→spreadsheet、.pdf→pdf 三条新规则+优先级位正确：pdf 先于 image、md 先于 text、xlsx 先于 binary）
  - 三 viewer 组件契约（markdown：GFM 表格渲染+默认禁 raw HTML；spreadsheet：exceljs 解析+行数有界如实标注；pdf：复用 pdfjs 渲染）+ RS 面回归 + tsc 0
  - 实机走查（fixture 产物三件套渲染三截图）落 acceptance/block-142/
  - 门禁五门（bundle 基线新依赖增量按已裁决 --write 重锚）+ closeout（集成提交后）
reopen: 后续 md 安全策略细化（rehype 插件白名单）独立裁决；xlsx 写回不在本包
status: active
---

# BLOCK-142 — 成果面切片 E：renderer 补课（md/xlsx/pdf）

> 立项：2026-10-05。用户裁决「开启新的工作继续 搞完」+ 依赖 AskUserQuestion 裁决「全批 md+xlsx+pdf（推荐）」。方向父文档：[`artifact-plane-direction.md`](./artifact-plane-direction.md) §3 切片 E。
> 阶段：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 范围

1. **md viewer**：新 adapter `markdown`（.md/.markdown）——react-markdown ^9 + remark-gfm ^4 渲染（GFM 表格/删除线/任务列表），**默认禁 raw HTML**（无 rehype-raw，XSS 安全默认）；viewer 组件 MarkdownResultViewer。
2. **xlsx viewer**：新 adapter `spreadsheet`（.xlsx/.xlsm）——exceljs ^4 读工作簿→首工作表网格渲染（行/列有界如实标注，超限截断提示）；viewer 组件 SpreadsheetResultViewer。
3. **pdf viewer**：新 adapter `pdf`——**复用已有 WorkspacePdfPreview**（pdfjs-dist 4.10.38 已在依赖，pages/project-workspace/ 现成组件；必要时抽提参数化）。
4. 注册表接线：viewerRegistry ADAPTER_RULES 三条新规则插正确优先级位（pdf 先于现 .pdf→binary 规则位、md 先于 isTextFile、xlsx 替换 .xlsx→binary 位）；能力声明位按 viewer 实情定值（pdf/md: canExport=true；spreadsheet: canSelect=true 接选择总线——selection 接线留后续，本包占位）。

## 2. 依赖裁决（DEPENDENCY-CHANGE-CHECKLIST 四问 · 用户裁决「全批（推荐）」2026-10-05）

| 依赖 | 版本 | 四问摘要 |
| --- | --- | --- |
| react-markdown | ^9 | 替代=自研解析（拒：半成品）/marked+dompurify（innerHTML 面，拒）；MIT、React 生态标准、无 innerHTML 天然防 XSS；bundle ~30KB |
| remark-gfm | ^4 | md 实际标准（表格/删除线）；官方插件、MIT；~10KB |
| exceljs | ^4 | 替代=SheetJS npm 版（0.18 停更+CVE，拒）/xlsx-populate（写为主，拒）；MIT、活跃；~300KB（xlsx 解析固有体量，bundle 基线重锚登记） |
| pdfjs-dist | 已在（4.10.38） | 零新增 |

退出成本：三 viewer 各自单组件封装，注册表规则行删除即回退。

## 3. 非范围（红线）

xlsx 写回/编辑（只读预览）；md raw HTML 渲染（安全默认禁用）；rehype 插件白名单细化（后续独立裁决）；selection 接线（spreadsheet canSelect 占位）；容器重构（renderPreview 仅加分支）。

## 4. 验收与节奏

契约测试红绿（注册表规则+三 viewer 组件）+ RS 面回归 + tsc 0 + 实机走查（fixture 产物三件套）+ 五门（bundle 基线按已裁决增量 --write 重锚）+ closeout（集成提交后）。实现=dynamic workflow（红绿+实机走查+换眼复核），工作流内不提交。
