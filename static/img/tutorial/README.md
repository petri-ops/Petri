# 教程图片目录

本目录存放 BioF3 教程里用到的所有真实数据图。**文档作者引用的就是这里的图，本 README 是维护说明。**

## 目录结构

一级目录对应组学专栏（和 `docs/` 下的目录一一对应），二级目录对应具体模块：

```
tutorial/
├── single-cell/             # 单细胞（docs/single-cell/）
│   ├── module01/ ... module11/
├── bulk-rnaseq/         # bulk RNA-seq（docs/bulk-rnaseq/）
│   ├── bulk02/ ... bulk07/
├── basics/              # 预留：基础入门
├── genomics/            # 预留：基因组
├── epigenomics/         # 预留：表观组
├── proteomics/          # 预留：蛋白质组
├── integration/         # 预留：多组学整合
└── README.md
```

**命名规范**

- 一级目录名 = `docs/` 下对应的专栏目录名
- 二级目录名 = 脚本名前缀（例如 `scripts/module06_trajectory_sci.R` → `single-cell/module06/`）
- 脚本编号和文档编号之间可能有错位（基础入门里 r-ggplot2 占用了 module02 的槽位），遵循"脚本输出目录 = 脚本名编号"即可

## 图片命名

- 小写字母 + 连字符
- 数字前缀标顺序
- 避免空格和特殊字符

```text
01-umap-celltype.png
02-slingshot-curves-pca.png
03-umap-pseudotime.png
```

## 添加新图

1. 放到对应的二级目录：
   ```bash
   cp your-image.png static/img/tutorial/single-cell/module06/
   ```
2. Markdown 里引用：
   ```markdown
   ![figure caption](/img/tutorial/single-cell/module06/your-image.png)
   ```
3. 配一条图注。

## 文件大小

- `ggsave(..., dpi = 300)` 产出的 PNG 基本都在 1 MB 以内，不需要压
- 空间转录组切片类图可能到几 MB，也可接受
- 超过 5 MB 的可以用 `pngquant` 或 `tinypng.com` 压一下

## 注意事项

- 不要在文件名里出现中文
- 图里的 title / label 都用英文（见各 `scripts/*.R` 里的 `theme_biof3()` 习惯）
- 每张图都应该有对应的 `**Figure N**：...` 图注
