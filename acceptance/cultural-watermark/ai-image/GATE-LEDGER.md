# 国风水印 · AI 专业出图原封不动落地 · 门禁账（2026-11-20）

## 用户诉求
「手绘 SVG 不好看没质感，有没有专业设计工具，设计好图案你原封不动拿来。」

## 工具盘点（诚实）
- Figma MCP / Penpot MCP：**未连接**（需 server+插件 或 use_figma 工具），本机不可用。
- image_gen（AI 图像生成）：**可用** → 采用。
- Miora 品牌资产：存在但为 logo 概念图，无现成水印纹样。
结论：用 image_gen 生成专业钢笔白描图案，原封不动落地。

## 实现（原封不动）
- 原图：`acceptance/cultural-watermark/design-concepts/A_single_minimalist_Chinese_in_2026-11-20T12-57-16.png`（1536×1024，保留为 provenance）。
- 工程处理仅一步：白底→alpha（`cultural-watermark.png`，图案笔锋像素不动）。
- 落地：`GlobalWatermarkAI.tsx`（单 div）+ `watermark-ai.css`（background-image 引用该图，opacity 0.10，dark 反相 0.08）；`main.tsx` 挂载。
- 无二次加工图案、无手绘 SVG、零新依赖。

## 实机（9223 离屏，12/12）
welcome/settings/extensions 三路由逐页：global 层在场、背景图加载（URL 命中 cultural-watermark.png）、`position:fixed`、`pointer-events:none`、截图各一。
人工过目 settings.png：月洞门大弧有提按笔锋、开环/方印/卵石四角到位、10% 淡度正文不干扰——**质感明显优于手绘 SVG 版**，达成用户诉求。

## HK-01
6/6 绿（AI 资源在场/原图 provenance/单 div 组件/CSS 引用图+淡度有界/非交互零裸 z/零代签）。
注意：本轮**实现先于测试**（先生成图并接线，后补测试），红证据未单独留存——如实标注，不伪造 red。

## 并发冲突（如实记录，环境问题）
本会话中另一进程持续把 `watermark.css`、`GlobalWatermark.tsx`、`cultural-watermark.cjs` 覆盖为「极简几何单线（候选1）」版本（read_file 与时间戳确认）。为避免互相破坏，AI 方案改用独立新文件（`watermark-ai.css` / `GlobalWatermarkAI.tsx` / `cultural-watermark-ai.cjs`），**不触碰对方文件**。两方案并存于工作区，最终以 `main.tsx` 的 import 为准（当前指向 AI 版）。这是工作区并发写入问题，需用户知悉；本包不替对方收口、不删对方文件。

## 边界
观感"是否足够高级"由上面的实机截图 + 用户目测认定；静态只证结构。UI-717 四档 verified 不外推。G0 开发期常态 · 不外推 packaged/Provider/GA。
