# BioF3 分析工具开发规范 v4.0

> 以 DESeq2 + GO/KEGG ORA 为标准模板，后续所有工具按此模式开发。
> 更新于 2026-05-21
>
> DESeq2 已迁移为 builtin-canonical 插件，唯一源码位于
> `resources/built-in-plugins/deseq2/`。`core/r-server/tool-scripts/` 不再保留
> DESeq2 执行脚本；普通 installed 副本不得覆盖它，只有显式 development
> 插件来源可以临时覆盖。

## 一、完整文件清单

```
本地仓库 (r-server/):
├── tool-scripts/{tool}.R                       # R 分析脚本
├── tool-scripts/{tool}-report-template.html    # HTML 报告模板
├── tool-scripts/_report-template-boilerplate.html  # 通用报告脚手架（新工具从此复制）
├── tool-demo-data/{tool}/                      # Demo 输入数据（真实公开数据集）
├── tool-demo-results/{tool}/                   # 静态 Demo 结果（fallback）
├── routes/tools.js                             # 后端路由（通用，新工具只需注册）
├── TOOL_DEV_STANDARD.md                        # 本文档
└── ARCHITECTURE.md                             # 项目架构说明

本地仓库 (src/):
├── src/pages/tools/_data.ts                    # 工具定义（inputs/outputs/metadata）
├── src/pages/tools/index.tsx                   # 工具页面主组件
│   ├── TOOL_COLORS                             #   工具主题色映射
│   ├── REPORT_URLS                             #   静态报告 URL 映射
│   ├── FIGCODE_MAP                             #   图片→FigCode 卡片映射
│   └── generateFigcodeWithData()               #   在线绘图代码模板（通用函数）
├── src/pages/tools/_FloatingToolPalette.tsx    # 浮动工具栏组件（_ 前缀避免 SSG）
├── src/pages/tools/tools.module.css            # 样式
└── src/components/RunModal.tsx                 # 在线绘图弹窗（全站共用）

服务器 /opt/biof3-r-server/:
├── tool-scripts/{tool}.R                       # 分析执行脚本
├── tool-scripts/{tool}-report-template.html    # 报告模板
├── tool-demo-data/{tool}/                      # Demo 输入数据
├── routes/tools.js                             # 后端路由
└── /mnt/storage_16tb/omichub/biof3-tool-jobs/  # 用户分析结果（持久化）
```

## 二、工具 ID 命名规范

| 规则 | 说明 |
|------|------|
| 格式 | 小写 + 连字符，如 `go-kegg`、`km-survival`、`lasso-cox` |
| 唯一性 | ID 一旦确定不可轻易修改（DB、文件目录、前端路由均绑定） |
| 显示名 | 在 `_data.ts` 的 `title` 字段和 `routes/tools.js` 的 `toolNames` 中定义 |
| 向后兼容 | 如必须改 ID，需在 `getToolConfig` 加别名映射 + 迁移 DB |

**已有工具 ID 映射：**
| ID | 显示名 | R 脚本 |
|----|--------|--------|
| `deseq2` | DESeq2 | `resources/built-in-plugins/deseq2/scripts/deseq2.R` |
| `go-kegg` | GO/KEGG ORA | `go-kegg.R` |
| `gsea` | GSEA | `gsea.R` |
| `km-survival` | KM 生存分析 | `km-survival.R` |

## 三、R 脚本标准结构（参考 `resources/built-in-plugins/deseq2/scripts/deseq2.R` / `go-kegg.R`）

```r
#!/usr/bin/env Rscript
# 1. 加载包
suppressMessages({ library(DESeq2); library(ggplot2); ... })

# 2. 读取 params.json + 输入文件
args <- commandArgs(trailingOnly = TRUE)
job_dir <- args[1]
output_dir <- file.path(job_dir, "output")

# 3. ★ 加载 BioF3 共享样式 (theme_biof3, ggsave_biof3 等)
source(file.path(job_dir, "_biof3-theme.R"))

# 4. 数据预处理 + 核心分析

# 5. 生成所有图（7+ 张，与 demo 一致）
#    - ggplot2: 用 theme_biof3() + biof3_palette() + ggsave_biof3()
#    - grid 系 (ComplexHeatmap/pheatmap/base R): 用 save_grid_biof3() 双格式输出

# 6. 生成数据表（CSV）

# 7. ★ 保存中间数据（确保在线绘图可复现）

# 8. 写 manifest.json（files + summary）
#    - 包含 report.html 条目

# 9. 从模板生成 report.html（图片 base64 内嵌）
#    - 读取模板 → gsub 替换占位符为 base64 → 移除未生成的可选图 → 写入 output
```

## 三-A、SCI 视觉风格强制约束（2026-05-24 加）

> 目标：BioF3 在线工具的默认输出 = 直接发表到论文 figure 的水平。每张图 PNG + PDF 双格式。

### 共享样式包：`tool-scripts/_biof3-theme.R`

`tools.js` 在创建 jobDir 时自动复制 `_biof3-theme.R` 到 jobDir 旁边。R 脚本顶部 source：

```r
source(file.path(job_dir, "_biof3-theme.R"))
```

### 提供的 helper

| Helper | 用途 |
|--------|------|
| `theme_biof3(base_size=11)` | ggplot2 标准主题（替换 `theme_classic`） |
| `biof3_palette(n)` | 离散分类调色板（NPG 10 色，n>10 自动 ramp） |
| `biof3_palette_div(n=100)` | 二极配色（蓝-白-红，热图 / 火山用） |
| `biof3_palette_seq(n=100)` | 渐变配色（viridis，连续值用） |
| `ggsave_biof3(plot, "name_no_ext", width, height)` | 同时输出 PNG + PDF（300dpi） |
| `save_grid_biof3("name_no_ext", w, h, expr={...})` | grid 系绘图双格式输出 |
| `biof3_heat_colors(mat, kind="div")` | 给 ComplexHeatmap 用的 colorRamp2 |

### 4 条死规则

1. ❌ 禁止 `theme_classic()` / `theme_minimal()` → 必须 `theme_biof3()`
2. ❌ 禁止 `ggsave(..., dpi=150)` → 必须 `ggsave_biof3()`（双格式 300dpi）
3. ❌ 禁止硬编码颜色 → 用 `biof3_palette()` 或 `biof3_palette_div()`
4. ❌ 禁止图例字体 < 9 / 标题字体 < 11 — `theme_biof3()` 已强制最低字号

### 默认输出尺寸（论文级标准）

| 用途 | 推荐尺寸 (inch) | 备注 |
|------|---------|------|
| 单栏图（火山、PCA、UMAP）| 6 × 4.5 | Nature single column 88mm = 3.46in，留余量 |
| 单栏正方形（散点）| 5 × 5 | |
| 双栏图（热图 / 多变量）| 11 × 7 | Nature double column 180mm = 7.09in |
| 多面板（grid 拼图）| ≥ 11 × 8 | |

### ComplexHeatmap 范式（grid 系工具首选）

```r
library(ComplexHeatmap); library(circlize)
mat_z <- t(scale(t(mat)))
col_fun <- biof3_heat_colors(mat_z, kind="div")

ht <- Heatmap(mat_z,
              col = col_fun,
              show_row_names = FALSE,
              row_title = "Genes",
              column_title = "Samples",
              heatmap_legend_param = list(title = "Z-score"))

save_grid_biof3("output/heatmap", width = 8, height = 6, expr = {
  draw(ht)
})
```

### 回填策略

- ✅ **新工具（从 ComplexHeatmap 起）必须用**
- ⏳ **现存 8 个工具**：ε-test 启动后按用户反馈优先级渐进回填（不立即全做）

## 四、中间数据保存规范（关键！）

每张图必须有对应的中间数据文件，确保在线绘图能完全复现：

**硬性原则：任何一张输出图，用户都必须能通过"在线绘图"功能修改参数后重新生成。**

| 数据类型 | 保存格式 | 适用场景 |
|----------|----------|----------|
| 表格数据（可用 ggplot 重绘） | CSV | dotplot, barplot, volcano, PCA, boxplot 等 |
| 复杂 R 对象（需要原始对象方法） | RDS | enrichResult (cnetplot/treeplot/emapplot), Seurat 对象, DESeqDataSet 等 |
| 矩阵数据 | CSV | 表达矩阵, 距离矩阵, 热图数据 |

**⚠️ 开发时必须自检：对每张输出图问自己"用户能否只用保存的中间数据重新画出这张图？"如果不能，就需要额外保存数据。**

## 五、前端代码模板规范

每张图的在线绘图代码必须：
1. 使用缓存加载（`if (!exists("var"))` 模式）
2. 引用正确的中间数据文件（带 token）
3. 使用和 R 脚本完全一致的绑图逻辑
4. 在 `FIGCODE_MAP` 中注册映射关系

## 六、报告系统

### 6.1 报告类型
- **动态报告**：R 脚本生成 `report.html`（分析结果用，图片 base64 内嵌）
- **静态报告**：`static/exports/tools/{tool}/index.html`（Demo 展示用）

### 6.2 报告模板开发规范

**通用模板（脚手架）：** `tool-scripts/_report-template-boilerplate.html`

所有新工具的报告模板从此文件复制开发，保证样式与交互行为一致。

**布局规则：**
- `.report` 始终 `max-width: 860px; margin: 0 auto` **居中显示**
- `.nav-wrap` 为 overlay 浮层（`z-index: 50`），不影响内容布局
- 导航栏默认显示，点击 ☰ 可收起
- 打印时自动隐藏导航和水印

**图片占位符约定：**
- `{{filename.png}}` — R 脚本运行时用 `gsub` 替换为 base64 data URI
- `{{variable}}` — 统计数值占位符（如 `{{input_genes}}`、`{{n_bp}}`）

**微信二维码：** 直接在模板 HTML 中硬编码 base64（从 DESeq2 模板复制），不依赖外部文件。

**可选图片处理：** R 脚本中用正则移除未替换的图片块：
```r
report_html <- gsub('<div class="fig">\\s*<img src="\\{\\{[^}]+\\}\\}" [^>]*>\\s*<div class="fig-caption">[^<]*</div>\\s*</div>',
                    '', report_html, perl = TRUE)
```

#### ⚠️ DOM-CSS 一致性硬约束（2026-05-24 加，踩坑后沉淀）

每张报告 HTML 模板有 4 条死规则，违反任何一条都会让报告渲染异常。这次 LASSO Cox 报告二维码炸成 200+ 像素大块占据 header 就是踩了这个坑（详见 `.kiro/steering/lessons-learned.md` "2026-05-24 晚 — 报告 HTML 微信公众号二维码 CSS 缺失"）。

1. **`.wechat-float` 的 DOM 和 CSS 必须成对**

   `<style>` 块里必须有完整的 5 条规则：
   ```css
   .wechat-float { position: absolute; top: 0; right: 0; display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #dfe8e3; border-radius: 8px; padding: 8px 12px; }
   .wechat-float img { width: 56px; height: 56px; border-radius: 4px; }
   .wechat-float .info { font-size: 11px; color: #5c6b64; line-height: 1.4; }
   .wechat-float .info strong { display: block; font-size: 12px; color: #17201d; margin-bottom: 2px; }
   @media print { .wechat-float, .nav-wrap, .nav-toggle { display: none; } }
   ```

   `<body>` 里必须有对应 DOM：
   ```html
   <div class="wechat-float">
     <img src="data:image/jpeg;base64,..." alt="微信公众号">
     <div class="info"><strong>生信F3</strong>AI 陪伴的全组学<br>学习与实战平台</div>
   </div>
   ```

   只抄 DOM 不抄 CSS → 二维码渲染成原图尺寸（200+ 像素大块）+ 无 `position: absolute` → 推开正文，是这次 LASSO 报告的根因。

2. **`.report-header` 必须保留 `position: relative`**

   `.wechat-float { position: absolute; }` 会找最近的 `position` 非 static 的祖先作为锚点。如果 `.report-header` 没声明 `position: relative`，会找到 body，二维码就飞到页面顶部了。这次 bindea-immune 模板就缺这条。

3. **任何 `<div class="X">` 都必须在 `<style>` 里有对应的 `.X { ... }` 定义**

   boilerplate 里的样式和 DOM 是配套的，复制时不能漏抄。这条是上面两条的一般化原则。

4. **复制 boilerplate 后必须跑机器自检 + 浏览器肉眼检查两道**（见下）

#### 复制 boilerplate 后的强制自检（机器层）

新写完 `{toolId}-report-template.html` 必须先跑这段 grep 自检，输出有 ❌ 就改到全 ✅：

```bash
# 在 r-server/tool-scripts/ 目录下跑
f={toolId}-report-template.html
dom_qr=$(grep -c '<div class="wechat-float"' "$f")
css_qr=$(grep -c '\.wechat-float' "$f")
relative=$(grep -c 'report-header.*position:\s*relative' "$f")
navmargin=$(grep -c 'margin-left:\s*max(200px' "$f")
full=$(grep -c '\.report\.full' "$f")
[ "$dom_qr" -ge 1 ] && [ "$css_qr" -lt 4 ] && echo "❌ $f: 二维码 DOM 有但 CSS 不全 (CSS-refs=$css_qr, 应 ≥ 4)"
[ "$dom_qr" -ge 1 ] && [ "$relative" -lt 1 ] && echo "❌ $f: 缺 .report-header position: relative"
[ "$dom_qr" -ge 1 ] && [ "$navmargin" -lt 1 ] && echo "❌ $f: 缺 .report margin-left:max(200px,...) (导航打开会遮正文)"
[ "$dom_qr" -ge 1 ] && [ "$full" -lt 1 ] && echo "❌ $f: 缺 .report.full 规则 (导航收起后无法居中)"
[ "$dom_qr" -ge 1 ] && [ "$css_qr" -ge 4 ] && [ "$relative" -ge 1 ] && [ "$navmargin" -ge 1 ] && [ "$full" -ge 1 ] && echo "✅ $f: 所有硬约束通过"
```

或者直接用工程内置脚本一次性查全部模板:

```bash
bash scripts/_dev/verify-template-defense.sh
```

#### 浏览器肉眼检查（视觉层）

机器层检查只能查"DOM 和 CSS 的对应关系"，但**渲染效果必须人眼看一遍**——base64 图片实际尺寸、字号叠加、布局推挤都是 grep 看不到的。跑完 demo 任务后，打开 `output/report.html`，逐项确认：

- [ ] 微信公众号二维码在**右上角**，56×56 像素的**小方块**（不是大块占据 header）
- [ ] 二维码旁边 "生信F3 / AI 陪伴的全组学 / 学习与实战平台" 三行文字字号合适不堆叠
- [ ] 报告主体 `.report` 居中，没有被推挤
- [ ] 侧边目录是浮层，点击 ☰ 能收起
- [ ] 所有 `{{filename.png}}` 占位符已被替换成 `data:image/png;base64,...`（不能有残留的 `{{...}}` 字符串）
- [ ] 所有图都加载出来，没有 broken image 图标

参考正确的渲染效果：DESeq2 / GO-KEGG / GSEA 这 3 份报告都是 reference 状态。

### 6.3 已完成的报告模板

| 工具 | 模板文件 |
|------|----------|
| DESeq2 | `deseq2-report-template.html` |
| GO/KEGG ORA | `go-kegg-report-template.html` |

## 七、后端 API 端点

| 端点 | 方法 | 作用 |
|------|------|------|
| `/api/tools/run` | POST | 提交分析任务 |
| `/api/tools/status/:id` | GET | 查询任务状态 |
| `/api/tools/file/:jobId/:filename` | GET | 获取结果文件 |
| `/api/tools/file/:jobId/:filename` | PUT | 替换结果文件（+重新生成报告） |
| `/api/tools/history` | GET | 获取用户历史 |
| `/api/tools/job/:id` | DELETE | 删除任务（公开 Demo 需 ?force=true） |
| `/api/tools/job/:id/name` | PUT | 重命名任务 |
| `/api/tools/job/:id/public` | PUT | 设为公开 Demo（管理员） |
| `/api/tools/public-demo/:toolId` | GET | 获取公开 Demo（fallback 到静态目录） |
| `/api/tools/public-file/:jobId/:filename` | GET | 获取公开文件（无需认证） |
| `/api/tools/demo/:toolId` | GET | 静态 Demo 列表 |
| `/api/tools/demo/:toolId/:filename` | GET | 静态 Demo 文件 |
| `/api/tools/demo-data/:toolId/:filename` | GET | Demo 输入数据 |

## 八、Demo 系统

### 8.1 两层 Demo 机制
1. **动态 Demo**（DB `is_public=1` 的 job）— 管理员标记，优先使用
2. **静态 Demo**（`tool-demo-results/{toolId}/`）— 预置文件，作为 fallback

`public-demo` 端点逻辑：先查 DB → 无则 fallback 到静态目录。

### 8.2 Demo 保护
- 删除公开 Demo job 时会被拦截，返回错误提示
- 必须传 `?force=true` 才能强制删除
- 确保每个工具始终有可用的 Demo 展示

### 8.3 Demo 数据要求
- **必须使用真实公开数据集**（如 airway、TCGA 子集等），不能用随机模拟数据
- 原因：模拟数据的"差异基因"之间没有生物学关联，下游分析会得到空结果
- Demo 数据应能在 5 分钟内跑完（必要时预过滤低表达基因）

## 九、前端交互规范

### 9.1 提交按钮
- 点击"开始分析"后立即 `disabled` + 文字变为"提交中..."
- 防止用户重复点击（网络延迟 1-2s 期间）
- 提交成功后弹窗关闭，进入轮询状态

### 9.2 页面组件命名
- `src/pages/` 下的非页面组件必须加 `_` 前缀（如 `_FloatingToolPalette.tsx`）
- 否则 Docusaurus 会将其当作路由，导致 SSG 构建失败

### 9.3 工具注册清单
新增工具时，前端需要在以下位置注册：
1. `_data.ts` — 工具定义（id, title, inputs, outputs）
2. `index.tsx` → `TOOL_COLORS` — 工具主题色
3. `index.tsx` → `REPORT_URLS` — 静态报告 URL
4. `index.tsx` → `FIGCODE_MAP` — 图片→FigCode 映射
5. `index.tsx` → `generateFigcodeWithData()` — 在线绘图代码模板
6. `index.tsx` → demo 加载逻辑（`loadDemoForForm` 分支）

## 十、开发新工具的步骤（14 步）

> **步骤 0（前置必做）**: 先按 `.kiro/steering/tool-dev.md` 的"步骤 0：工具范围与官方文档"读完官方 canonical tutorial、锁定 out-of-scope、锁定默认参数、写工具范围卡（R 脚本顶部注释）。**不读官方文档不能动手写代码**。

1. 确定工具 ID（小写连字符格式，如 `bindea-immune`）
2. 在 `_data.ts` 中添加工具定义（inputs/outputs/metadata）
3. 在 `routes/tools.js` → `getToolConfig` 中注册 + `toolNames` 添加显示名
4. 在 `index.tsx` 中注册 `TOOL_COLORS` + `REPORT_URLS`
5. 编写 R 分析脚本（插件参考 `resources/built-in-plugins/deseq2/scripts/deseq2.R` 结构）
6. ★ 确保保存所有中间数据（CSV + RDS）
7. 从 `_report-template-boilerplate.html` 复制，编写报告模板
8. **★ 跑 §6.2 的 grep 自检**，确认 DOM-CSS 一致性 + `position: relative` 都对（机器层）
9. 准备 demo 输入数据（`tool-demo-data/{tool}/`）
10. 跑一次分析，确认输出完整（7+ 图 + 中间数据 + manifest.json）
11. **★ 浏览器实际打开 `output/report.html` 肉眼过 §6.2 视觉检查清单**（视觉层）
12. 在 `FIGCODE_MAP` 中注册图片→FigCode 卡片映射 + 在 `generateFigcodeWithData` 中添加代码模板
13. 在 `test/smoke-tools.mjs` 与 `scripts/promote-demo.js` 的 fixtures 中加入该工具的 fixture（params + expectedOutputs）
14. **★ 服务器上跑 `bash /opt/biof3-r-server/scripts/promote-demo.sh <toolId>` 一键上线公开 demo**（幂等：admin token 跑 demo + 标 `is_public=1` + 验证可访问）。这取代了原来的"管理员后台手动点 设为 Demo"步骤

## 十一、关键约束

- R 镜像源：西湖大学（容器 Rprofile.site 已配置）
- 并发限制：同一用户最多 2 个同时运行
- 任务命名：自动 "{工具名} #N"，可双击修改
- 数据隔离：job 目录随机 ID，DB 按 user_id 过滤
- 认证：job 文件 URL 需带 token（query string）
- 报告图片：base64 内嵌（离线可用）
- 报告布局：居中显示，导航栏为 overlay 浮层
- 代码保存：图片和代码配对保存（{filename}.R）
- 持久化存储：`/mnt/storage_16tb/omichub/biof3-tool-jobs/`（重启不丢失）
- JSON body limit：100MB（nginx + express 均已配置）

## 十二、工具间数据联动

- GO/KEGG ORA 可直接导入 DESeq2 的 `deg_table.csv`（前端下拉框选择已完成的 DESeq2 job）
- GSEA 可直接导入 DESeq2 的 `deg_table.csv`（自动提取 log2FC 排序）
- R 脚本需自动检测输入格式（DESeq2 结果表 vs 简单基因列表/排序列表）
- 联动逻辑在前端 `index.tsx` 的文件输入区域，用 `<select>` 下拉框实现
- **新工具开发时必须检查**：该工具的输入是否可以从已有工具的输出导入？如果可以，必须加联动

### 联动代码模式
```tsx
{selectedTool.id === '{新工具ID}' && inp.id === '{输入字段ID}' &&
 jobs.filter(j => j.tool_id === '{上游工具ID}' && j.status === 'completed').length > 0 && (
  <select onChange={async (e) => {
    // fetch 上游工具的输出文件 -> setFiles -> setFileNames -> setFilePreviews
  }}>
    <option value="">从已有 {上游工具名} 结果导入...</option>
    {jobs.filter(...).map(j => <option>...</option>)}
  </select>
)}
```

### 已实现的联动关系
| 下游工具 | 上游工具 | 导入文件 |
|----------|----------|----------|
| GO/KEGG ORA | DESeq2 | deg_table.csv |
| GSEA | DESeq2 | deg_table.csv |

## 十三、桌面集成与发布验证

工具脚本、报告模板和 Node 路由都随 Desktop 仓库与应用包发布，不再单独推送到
远程服务器。修改后从仓库根执行：

```bash
npm run check
npm --prefix frontend run check
npm run build:spa
node --test test/*.test.mjs
```

随后用 `npm run dev` 验证 R/Python 本地服务、工具执行、`tool_job` 状态与 artifact
结果预览。需要发布安装包时走仓库根的 Electron build/release 流程；不得恢复
scp、pm2、ECS 或容器部署步骤。
