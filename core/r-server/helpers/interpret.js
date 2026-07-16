/**
 * helpers/interpret.js — /api/ai/interpret support
 *
 * Extracted from server.js. Pure module: depends on https + DEEPSEEK_API_KEY.
 *
 * Public API:
 *   lookupCellType(markers) → string|null
 *   callDeepSeekSimple(prompt, maxTokens) → Promise<string|null>
 *   buildInterpretPrompt(analysisType, summary, extra) → string|null
 *   CELL_MARKERS — exported for external usage
 *
 * Note: renamed from `callDeepSeek` to `callDeepSeekSimple` to avoid clashing
 * with the agent's callDeepSeek(apiKey, body, telemetry) signature in server.js.
 * (Old name was being shadowed by hoisting and producing JSON.stringify(undefined) errors.)
 */

const https = require('https');

// === 本地知识库：常见 marker 基因 → 细胞类型映射 ===
// 数据来源：CellMarker 2.0 + PanglaoDB 高频条目精选
const CELL_MARKERS = {
  // T cells
  'CD3E,CD3D,CD3G,CD2': 'T 细胞 (T cell)',
  'CD4,IL7R,CCR7': 'CD4+ Naive T 细胞',
  'CD8A,CD8B': 'CD8+ T 细胞',
  'GZMB,PRF1,GNLY': '细胞毒性 T/NK 细胞',
  'FOXP3,IL2RA,CTLA4': '调节性 T 细胞 (Treg)',
  // B cells
  'MS4A1,CD79A,CD79B,CD19': 'B 细胞',
  'IGHG1,JCHAIN,XBP1': '浆细胞 (Plasma cell)',
  // Myeloid
  'CD14,LYZ,CSF1R': '单核细胞 (Monocyte)',
  'FCGR3A,MS4A7': '非经典单核细胞 (CD16+ Monocyte)',
  'CD68,CD163': '巨噬细胞 (Macrophage)',
  'FCER1A,CST3,CLEC10A': '树突状细胞 (DC)',
  // NK / Innate
  'NKG7,KLRD1,KLRF1': 'NK 细胞',
  'GATA2,KIT,TPSAB1': '肥大细胞 (Mast cell)',
  // Erythroid / platelet
  'HBA1,HBA2,HBB': '红细胞 (Erythrocyte)',
  'PPBP,PF4,GP9': '血小板 (Platelet)',
  // Neuronal (mouse brain)
  'SNAP25,STMN2,SYT1': '神经元 (Neuron)',
  'GFAP,AQP4,SLC1A3': '星形胶质细胞 (Astrocyte)',
  'MBP,PLP1,MOG': '少突胶质细胞 (Oligodendrocyte)',
  // Stromal
  'COL1A1,COL3A1,DCN': '成纤维细胞 (Fibroblast)',
  'PECAM1,CDH5,VWF': '内皮细胞 (Endothelial)',
  'ACTA2,MYH11,TAGLN': '平滑肌细胞 (Smooth muscle)',
  // Epithelial
  'EPCAM,KRT8,KRT18': '上皮细胞 (Epithelial)',
};

function lookupCellType(markers) {
  if (!Array.isArray(markers) || markers.length === 0) return null;
  const upper = markers.map((m) => m.toUpperCase());
  let bestMatch = null;
  let bestScore = 0;
  for (const [key, type] of Object.entries(CELL_MARKERS)) {
    const refMarkers = key.split(',');
    const matches = refMarkers.filter((m) => upper.includes(m)).length;
    if (matches >= 2 && matches > bestScore) {
      bestMatch = type;
      bestScore = matches;
    }
  }
  return bestMatch;
}

/** Simple DeepSeek caller for interpret use. Returns text or null. */
async function callDeepSeekSimple(prompt, maxTokens = 800) {
  const { getApiKey } = require('./ai-settings');
  const apiKey = getApiKey('deepseek');
  if (!apiKey) return null;

  const body = JSON.stringify({
    model: 'deepseek-chat',
    messages: [
      {
        role: 'system',
        content:
          '你是一位资深生物信息学专家，擅长单细胞 RNA-seq 数据分析。请用简洁、准确、专业的中文回答，避免冗余。',
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: maxTokens,
    temperature: 0.3,
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.deepseek.com',
        path: '/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.choices?.[0]?.message?.content || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

/** Build interpret prompt by analysis type. Returns null if type not supported. */
function buildInterpretPrompt(analysisType, summary, extra = {}) {
  if (analysisType === 'scrna_standard' || analysisType === 'recluster') {
    const { nCells, nGenes, nClusters, species, resolution, nPcsUsed } = summary || {};
    let prompt = '我刚完成一次单细胞 RNA-seq 标准分析，请用 200-300 字给出简明解读。\n\n';
    prompt += '基本信息：\n';
    prompt += '- 物种：' + (species || '未知') + '\n';
    prompt += '- 细胞数：' + (nCells || '?') + '\n';
    prompt += '- 基因数：' + (nGenes || '?') + '\n';
    prompt += '- Cluster 数：' + (nClusters || '?') + '\n';
    prompt += '- 使用 PC：' + (nPcsUsed || '?') + '\n';
    prompt += '- 分辨率：' + (resolution || '?') + '\n';
    if (extra.topMarkers) {
      prompt += '\n各 cluster 的 top markers：\n';
      for (const [cluster, markers] of Object.entries(extra.topMarkers)) {
        prompt += '- Cluster ' + cluster + ': ' + markers.join(', ') + '\n';
      }
    }
    prompt += '\n请用简洁中文输出三部分：\n';
    prompt += '1. 数据质量评估（1-2 句）\n';
    prompt += '2. 主要细胞类型推断（基于 markers）\n';
    prompt += '3. 推荐的下一步分析（1-2 个具体建议）';
    return prompt;
  }
  if (analysisType === 'deg') {
    const { nUp, nDown, nTotal, group1, group2 } = summary || {};
    return (
      '差异表达分析结果：' +
      group1 +
      ' vs ' +
      group2 +
      '，上调 ' +
      nUp +
      '，下调 ' +
      nDown +
      '，共 ' +
      nTotal +
      ' 个差异基因。请用 100 字给出生物学意义解读和下一步建议（如富集分析方向）。'
    );
  }
  if (analysisType === 'enrichment') {
    const { nGOTerms, nKEGGPathways, _organism } = summary || {};
    return (
      '富集分析结果：GO 富集到 ' +
      nGOTerms +
      ' 条目，KEGG ' +
      nKEGGPathways +
      ' 通路。请用 100 字解读这些数字的意义，以及如何挖掘最相关的生物学过程。'
    );
  }
  if (analysisType === 'cell_annotation') {
    const { nCellTypes, reference } = summary || {};
    return (
      '细胞注释完成（参考库：' +
      reference +
      '）：识别出 ' +
      nCellTypes +
      ' 种细胞类型。请用 100 字简评注释结果，并建议是否需要人工修正。'
    );
  }
  if (analysisType === 'trajectory') {
    const { nBranchPoints, method } = summary || {};
    return (
      '轨迹分析（' +
      method +
      '）：检测到 ' +
      nBranchPoints +
      ' 个分支点。请用 100 字解读分支的生物学含义和下一步分析方向。'
    );
  }
  if (analysisType === 'communication') {
    const { nInteractions, nPathways } = summary || {};
    return (
      '细胞通讯分析：' +
      nInteractions +
      ' 个互作对，' +
      nPathways +
      ' 个信号通路。请用 100 字解读关键发现和如何深入挖掘。'
    );
  }
  // ============================================================
  // W1-7 (2026-05-28): 空间组学解读分支
  // ============================================================
  if (analysisType === 'spatial_standard') {
    const { nSpots, nGenes, nClusters, nSVGs, platform, resolution } = summary || {};
    let prompt = '我刚完成一次空间转录组标准分析，请用 200-300 字给出简明解读。\n\n';
    prompt += '基本信息：\n';
    prompt += '- 平台：' + (platform || 'Visium / 未知') + '\n';
    prompt += '- spot 数：' + (nSpots || '?') + '\n';
    prompt += '- 基因数：' + (nGenes || '?') + '\n';
    prompt += '- 空间 cluster 数：' + (nClusters || '?') + '\n';
    prompt += "- 显著空间高变基因数（Moran's I p<0.05）：" + (nSVGs || '?') + '\n';
    prompt += '- 聚类分辨率：' + (resolution || '?') + '\n';
    if (extra.topSVGs) {
      prompt += '\nTop 10 SVGs：' + extra.topSVGs.slice(0, 10).join(', ') + '\n';
    }
    prompt += '\n请用简洁中文输出三部分：\n';
    prompt += '1. 空间结构特征（聚类是否对应已知解剖区域）\n';
    prompt += '2. Top SVGs 暗示的生物学过程（必要时联想已知 marker）\n';
    prompt += '3. 推荐的下一步分析（解卷积？LR 邻域？SVG 富集？）';
    return prompt;
  }
  if (analysisType === 'spatial_recluster') {
    const { nSpots, nClusters, parentCluster } = summary || {};
    return (
      '空间重聚类完成（基于 parent cluster ' +
      (parentCluster || '?') +
      '）：' +
      (nSpots || '?') +
      ' spots 拆分为 ' +
      (nClusters || '?') +
      ' 个亚群。' +
      '请用 100 字解读这种异质性的可能成因（细胞混合？空间梯度？组织亚区？）和下一步建议。'
    );
  }
  if (analysisType === 'spatial_svg') {
    const { nSVGs, topMethod, nMoranSig, nGearySig, nSepalSig } = summary || {};
    return (
      "空间高变基因（SVG）检测完成：综合 Moran's I（" +
      (nMoranSig || '?') +
      ' 显著）、' +
      "Geary's C（" +
      (nGearySig || '?') +
      '）和 Sepal（' +
      (nSepalSig || '?') +
      '）三种方法，' +
      '共找到 ' +
      (nSVGs || '?') +
      ' 个空间显著基因，主导方法：' +
      (topMethod || "Moran's I") +
      '。' +
      '请用 150 字解读：(1) 这些 SVG 的空间模式类型（梯度/区域性/边界）(2) 适合做什么下游（GO/KEGG 富集？空间共表达模块？）。'
    );
  }
  if (analysisType === 'spatial_deconv') {
    const { nSpots, nCellTypes, method, dominantTypes } = summary || {};
    let prompt = '空间细胞解卷积完成（方法：' + (method || 'cell2location') + '）：\n';
    prompt += '- spot 数：' + (nSpots || '?') + '\n';
    prompt += '- 参考细胞类型数：' + (nCellTypes || '?') + '\n';
    if (Array.isArray(dominantTypes)) {
      prompt += '- 主导细胞类型 top 5：' + dominantTypes.slice(0, 5).join(', ') + '\n';
    }
    prompt +=
      '\n请用 200 字解读：(1) 各细胞类型的空间分布模式 (2) 是否符合该组织已知解剖学 (3) 哪些 spot 是细胞混合 niche，建议如何挖掘。';
    return prompt;
  }
  if (analysisType === 'spatial_lr') {
    const { nLRPairs, nSignificant, topPathways, method } = summary || {};
    let prompt = '空间配体-受体（LR）分析完成（方法：' + (method || 'LIANA-py spatial') + '）：\n';
    prompt += '- 总 LR 对数：' + (nLRPairs || '?') + '\n';
    prompt += '- 空间显著 LR 对：' + (nSignificant || '?') + '\n';
    if (Array.isArray(topPathways)) {
      prompt += '- Top 通路：' + topPathways.slice(0, 5).join(', ') + '\n';
    }
    prompt +=
      '\n请用 150 字解读：(1) 显著 LR 对在空间上的共定位特征 (2) 主要信号通路的生物学意义 (3) 建议下一步（按通路绘图？时空动力学？）。';
    return prompt;
  }
  return null;
}

module.exports = {
  CELL_MARKERS,
  lookupCellType,
  callDeepSeekSimple,
  buildInterpretPrompt,
};
