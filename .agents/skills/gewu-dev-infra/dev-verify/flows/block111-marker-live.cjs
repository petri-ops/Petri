#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block111-marker-live — BLOCK-111 P2 实机腿
 * （marker→细胞类型判别二跳，真实 Jev 轮次；plan §5 P2）。
 *
 * 前置：dev 后端以 BIOF3_JEV_MARKER_GUARD=1 + TYPESAFE_API_KEY 启动
 * （export BIOF3_JEV_MARKER_GUARD=1 && bash scripts/restart-dev-stack.sh）。
 * 本 flow 验证显式开启形态；默认关/缺 key/超时等降级五态由契约测试
 * test/block111-marker-classification.test.mjs 覆盖（单后端进程无法运行中翻 env）。
 *
 * 断言（一次 /api/ai/interpret 请求携带四个 cluster）：
 *   M1 canonical T 簇：adopted=true + confidence≥0.55 + type 正确（校准 canonical conf≈1.0）；
 *   M2 双细胞簇（T+B）：detailed 条目在位 + confidence∈[0,1]（采纳与否为模型行为，如实记录）；
 *   M3 零候选簇（看家基因）：{type:null, adopted:false} + cellTypeHints 不出现该簇（零出站边界）；
 *   M4 老契约零变化：cellTypeHints 深等于规则表预期（canonical/双细胞簇=首个最高分命中）；
 *   M5 canonical B 簇：adopted=true（第二类型交叉验证）。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'block-111');

const TOP_MARKERS = {
  c1_t_canon: ['CD3E', 'CD3D', 'CD3G', 'CD2'],
  c2_doublet: ['CD3E', 'CD3D', 'MS4A1', 'CD79A'],
  c3_empty: ['ACTB', 'GAPDH'],
  c4_b_canon: ['MS4A1', 'CD79A', 'CD79B', 'CD19'],
};

// 规则表预期（lookupCellType 语义：首个最高分 matches≥2 命中；零命中不出现在 cellTypeHints）
const EXPECTED_LEGACY = {
  c1_t_canon: 'T 细胞 (T cell)',
  c2_doublet: 'T 细胞 (T cell)',
  c4_b_canon: 'B 细胞',
};

module.exports = {
  id: 'block111-marker-live',
  description: 'BLOCK-111 P2 实机腿：marker 判别二跳（真实 Jev adopted + 零候选边界 + 老契约零变化）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    const resp = await fetch(API + '/ai/interpret', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        analysisType: 'scrna_standard',
        summary: { nCells: 2700, nGenes: 13714, nClusters: 4, species: 'human', resolution: 0.5, nPcsUsed: 10 },
        topMarkers: TOP_MARKERS,
      }),
    });
    const data = await resp.json().catch(() => null);
    assert('M0_interpret_200_ok', resp.ok && data?.status === 'ok',
      `http=${resp.status} body=${JSON.stringify(data).slice(0, 150)}`);

    const detailed = data?.cellTypeHintsDetailed;
    assert('M1_detailed_present_array', Array.isArray(detailed) && detailed.length === 4,
      `detailed=${JSON.stringify(detailed).slice(0, 200)}`);
    const byCluster = Object.fromEntries((detailed || []).map((d) => [d.cluster, d]));

    const t1 = byCluster.c1_t_canon;
    assert('M2_canonical_t_adopted', !!t1 && t1.adopted === true && t1.type === 'T 细胞 (T cell)'
      && typeof t1.confidence === 'number' && t1.confidence >= 0.55,
      `c1=${JSON.stringify(t1)}`);

    const t2 = byCluster.c2_doublet;
    assert('M3_doublet_entry_with_confidence', !!t2 && typeof t2.confidence === 'number'
      && t2.confidence >= 0 && t2.confidence <= 1,
      `c2=${JSON.stringify(t2)}`);
    lib.log(`M3 informational: doublet adopted=${t2 && t2.adopted} confidence=${t2 && t2.confidence}（模型行为，如实记录）`);

    const t3 = byCluster.c3_empty;
    assert('M4_empty_cluster_no_candidates', !!t3 && t3.type === null && t3.adopted === false,
      `c3=${JSON.stringify(t3)}`);

    assert('M5_legacy_hints_unchanged', JSON.stringify(data?.cellTypeHints) === JSON.stringify(EXPECTED_LEGACY),
      `cellTypeHints=${JSON.stringify(data?.cellTypeHints)} expected=${JSON.stringify(EXPECTED_LEGACY)}`);

    const t4 = byCluster.c4_b_canon;
    assert('M6_canonical_b_adopted', !!t4 && t4.adopted === true && t4.type === 'B 细胞'
      && typeof t4.confidence === 'number' && t4.confidence >= 0.55,
      `c4=${JSON.stringify(t4)}`);

    fs.writeFileSync(path.join(EVIDENCE_DIR, 'marker-live-flow.json'),
      JSON.stringify({ request: TOP_MARKERS, response: { cellTypeHints: data?.cellTypeHints, cellTypeHintsDetailed: detailed, source: data?.source } }, null, 2));
  },
};
