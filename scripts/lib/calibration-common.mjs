/**
 * scripts/lib/calibration-common.mjs — BLOCK-116 W2 校准工具化共享库。
 *
 * 弧线 §W2「新接点接入成本从『手搓』降为『填样本』」的 v1 形态：把五个校准 harness
 * 的机械共性（语料加载校验/并发映射/round/证据落盘）收拢到此；题型网格（noul 双阈值、
 * 单阈值采纳、choice 采纳精度）语义各异，保留在各 harness 内。
 * 迁移纪律=touch-and-migrate：新校准 harness 必须用本库；存量 harness 触改时迁移。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function round4(n) {
  return Math.round(n * 10000) / 10000;
}

export function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/** 加载并校验语料 JSON（kind/samples 形状与最小条数）。 */
export function loadCorpus(evidenceDir, file, { minSamples = 100, sampleWidth = 4 } = {}) {
  const corpusPath = path.join(evidenceDir, file);
  const doc = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  if (!Array.isArray(doc.samples) || doc.samples.length < minSamples) {
    throw new Error(`语料不足 ${minSamples} 条（现 ${doc.samples ? doc.samples.length : 0}）`);
  }
  for (const s of doc.samples) {
    if (!Array.isArray(s) || s.length !== sampleWidth) throw new Error(`样本形状非法：${JSON.stringify(s[0])}`);
  }
  return { doc, samples: doc.samples, sha256: sha256File(corpusPath) };
}

/** 落盘校准证据 JSON（kind/capturedAt/sourceCommit/model/wrapper/gate 标准信封）。 */
export function writeEvidence(evidenceDir, outPath, evidence) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const abs = path.join(evidenceDir, outPath);
  fs.writeFileSync(abs, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  return abs;
}
