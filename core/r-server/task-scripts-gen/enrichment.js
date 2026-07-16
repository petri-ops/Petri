/**
 * task-scripts-gen/enrichment.js — R script generator for enrichment analysis
 */
const {sanitizeRString} = require('../sanitizer');

function generateEnrichmentScript(task, progressHelper) {
  const {params, ossInputUrl, containerWorkDir} = task;
  const {
    organism = 'human',
    geneListType = 'symbol',  // symbol | entrez
    enrichType = 'GO',        // GO | KEGG | both
    pvalueCutoff = 0.05,
    topTerms = 15,
  } = params;

  const orgDb = organism === 'human' ? 'org.Hs.eg.db' : 'org.Mm.eg.db';
  const keggOrg = organism === 'human' ? 'hsa' : 'mmu';

  // M1-3 (H2)：插值进 R "..." 的用户输入转义
  const safeOssInputUrl = sanitizeRString(ossInputUrl);
  const safeContainerWorkDir = sanitizeRString(containerWorkDir);
  const safeOrganism = sanitizeRString(organism);
  const safeGeneListType = sanitizeRString(geneListType);
  const safeEnrichType = sanitizeRString(enrichType);
  const safeOrgDb = sanitizeRString(orgDb);
  const safeKeggOrg = sanitizeRString(keggOrg);
  if (!safeOssInputUrl || !safeContainerWorkDir || !safeOrganism || !safeGeneListType || !safeEnrichType || !safeOrgDb || !safeKeggOrg) {
    throw new Error('非法参数：含危险字符');
  }

  return `
suppressMessages({
  library(clusterProfiler)
  library(${safeOrgDb})
  library(ggplot2)
  library(jsonlite)
  library(enrichplot)
})

${progressHelper}

setwd("${safeContainerWorkDir}")

# --- 1. Load gene list ---
report_progress(10, "加载基因列表...")
input_url <- "${safeOssInputUrl}"
download.file(input_url, "input.csv", mode = "wb", quiet = TRUE)

df <- read.csv("input.csv", stringsAsFactors = FALSE)
# Expect: first column = gene, optional second column = log2FC
genes <- df[[1]]
has_fc <- ncol(df) >= 2
if (has_fc) {
  fc_vec <- setNames(as.numeric(df[[2]]), genes)
  fc_vec <- sort(fc_vec, decreasing = TRUE)
}

report_progress(20, paste0("加载 ", length(genes), " 个基因"))

# Convert to ENTREZID if needed
if ("${safeGeneListType}" == "symbol") {
  gene_map <- bitr(genes, fromType = "SYMBOL", toType = "ENTREZID", OrgDb = ${safeOrgDb})
  entrez_ids <- gene_map$ENTREZID
} else {
  entrez_ids <- genes
}

report_progress(30, "开始富集分析...")

results_list <- list()

# --- GO enrichment ---
if ("${safeEnrichType}" %in% c("GO", "both")) {
  report_progress(40, "GO 富集分析...")
  ego <- enrichGO(gene = entrez_ids, OrgDb = ${safeOrgDb}, ont = "BP",
                  pAdjustMethod = "BH", pvalueCutoff = ${pvalueCutoff}, readable = TRUE)
  if (nrow(as.data.frame(ego)) > 0) {
    p_go_dot <- dotplot(ego, showCategory = ${topTerms}) + ggtitle("GO Biological Process")
    ggsave("plot_001_go_dotplot.png", p_go_dot, width = 9, height = 7, dpi = 150)

    p_go_bar <- barplot(ego, showCategory = ${topTerms}) + ggtitle("GO BP - Top Terms")
    ggsave("plot_002_go_barplot.png", p_go_bar, width = 9, height = 6, dpi = 150)

    write.csv(as.data.frame(ego), "go_results.csv", row.names = FALSE)
    results_list$go_terms <- nrow(as.data.frame(ego))
  }
}

# --- KEGG enrichment ---
if ("${safeEnrichType}" %in% c("KEGG", "both")) {
  report_progress(60, "KEGG 富集分析...")
  ekegg <- enrichKEGG(gene = entrez_ids, organism = "${safeKeggOrg}", pvalueCutoff = ${pvalueCutoff})
  if (nrow(as.data.frame(ekegg)) > 0) {
    p_kegg <- dotplot(ekegg, showCategory = ${topTerms}) + ggtitle("KEGG Pathways")
    ggsave("plot_003_kegg_dotplot.png", p_kegg, width = 9, height = 7, dpi = 150)

    write.csv(as.data.frame(ekegg), "kegg_results.csv", row.names = FALSE)
    results_list$kegg_terms <- nrow(as.data.frame(ekegg))
  }
}

# --- GSEA if fold change available ---
if (has_fc && "${safeGeneListType}" == "symbol") {
  report_progress(75, "GSEA 分析...")
  gene_map_fc <- bitr(names(fc_vec), fromType = "SYMBOL", toType = "ENTREZID", OrgDb = ${safeOrgDb})
  gsea_list <- fc_vec[gene_map_fc$SYMBOL]
  names(gsea_list) <- gene_map_fc$ENTREZID
  gsea_list <- sort(gsea_list, decreasing = TRUE)

  tryCatch({
    gsea_res <- gseGO(geneList = gsea_list, OrgDb = ${safeOrgDb}, ont = "BP", pvalueCutoff = ${pvalueCutoff})
    if (nrow(as.data.frame(gsea_res)) > 0) {
      p_gsea <- dotplot(gsea_res, showCategory = ${topTerms}) + ggtitle("GSEA - GO BP")
      ggsave("plot_004_gsea.png", p_gsea, width = 9, height = 7, dpi = 150)
      write.csv(as.data.frame(gsea_res), "gsea_results.csv", row.names = FALSE)
      results_list$gsea_terms <- nrow(as.data.frame(gsea_res))
    }
  }, error = function(e) { cat("GSEA skipped:", e$message, "\\n") })
}

# --- Summary ---
report_progress(90, "保存结果...")
summary_data <- list(
  n_genes = length(genes),
  organism = "${safeOrganism}",
  enrich_type = "${safeEnrichType}",
  p_cutoff = ${pvalueCutoff},
  go_terms = results_list$go_terms %||% 0,
  kegg_terms = results_list$kegg_terms %||% 0,
  gsea_terms = results_list$gsea_terms %||% 0
)
write_json(summary_data, "summary.json", auto_unbox = TRUE)

report_progress(100, "分析完成!")
cat("TASK_COMPLETE\\n")
`;
}

/**
 * Generate Cell Annotation R script (SingleR-based).
 */

module.exports = { generateEnrichmentScript };
