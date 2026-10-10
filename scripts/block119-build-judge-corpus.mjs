#!/usr/bin/env node
/**
 * BLOCK-119 P0 — fit 校准语料挖掘（llm-transcripts 配对设计；BLOCK-110 话题漂移同款先例）。
 *
 * 用法：node scripts/block119-build-judge-corpus.mjs [--max 160]
 *
 * 标注策略（2026-09-24 抓真两轮迭代留痕）：
 *  - 首版「下条用户消息纠错词=弱负例」在 327 配对中命中 0（可用语料以验收探针会话为主，
 *    用户不表达不满）——数据形态不支持结果信号挖掘，弃用；
 *  - 「finishReason=length 截断=负例」全库仅 1 条，弃用；
 *  - 定稿配对设计（定义性 gold，机械正确）：
 *    · outcome_positive：真实请求-回复配对（gold=1）
 *    · turn_mismatch：同会话下一轮请求 × 本轮回复（同域话题、定义性不契合，难度中等，gold=0）
 *    · mismatch：跨会话请求 × 回复（硬负例，难度下界，gold=0）
 *
 * 隐私红线（plan §1）：语料文件只存指针（conv 文件名 + 记录序号）+ gold + 类型，
 * transcript 原文不离开 gitignored .petri-dev-user-data/（校准 harness 运行时按指针回读）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const SRC_DIR = path.join(root, '.petri-dev-user-data', 'data', 'llm-transcripts');
const OUT = path.join(root, 'acceptance', 'block-119', 'corpus-judge-fit.json');

/** 按会话分组的 (request指针, response指针)。 */
function loadConvUnits() {
  const units = [];
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.jsonl')).sort();
  for (const file of files) {
    let records;
    try {
      records = fs.readFileSync(path.join(SRC_DIR, file), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
    } catch { continue; }
    const turns = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r.kind !== 'agent_iter' || !r.response || typeof r.response.content !== 'string') continue;
      if (r.response.content.trim().length < 20 || (r.response.toolCalls || []).length) continue;
      const lastUser = [...(r.request.messages || [])].reverse().find((m) => m.role === 'user');
      if (!lastUser || String(lastUser.content || '').trim().length < 10) continue;
      turns.push({ conv: file, recordIdx: i });
    }
    if (turns.length >= 1) units.push(turns);
  }
  return units;
}

function main() {
  const maxIdx = process.argv.indexOf('--max');
  const max = maxIdx !== -1 ? Number(process.argv[maxIdx + 1]) || 160 : 160;

  const units = loadConvUnits();
  const flat = units.flat();

  const pick = (arr, n) => arr.filter((_, i) => i % Math.max(1, Math.floor(arr.length / n)) === 0).slice(0, n);
  const positives = pick(flat, Math.floor(max / 2));
  const samples = positives.map((t, i) => ({ id: `p${i + 1}`, kind: 'outcome_positive', ...t, gold: 1 }));

  // turn_mismatch：同会话存在下一轮的配对（请求=下一轮，回复=本轮）
  const turnPairs = [];
  for (const turns of units) for (let i = 0; i < turns.length - 1; i++) turnPairs.push({ req: turns[i + 1], out: turns[i] });
  for (const t of pick(turnPairs, Math.floor(max / 4))) {
    samples.push({ id: `t${samples.length + 1}`, kind: 'turn_mismatch', requestFrom: t.req.conv, requestIdx: t.req.recordIdx, outputFrom: t.out.conv, outputIdx: t.out.recordIdx, gold: 0 });
  }

  // mismatch：跨会话错配（硬负例）
  const cross = [];
  for (let i = 0; i < positives.length; i++) {
    const other = flat[(flat.indexOf(positives[i]) + Math.floor(flat.length / 2)) % flat.length];
    if (!other || other.conv === positives[i].conv) continue;
    cross.push({ req: positives[i], out: other });
  }
  for (const c of pick(cross, Math.floor(max / 4))) {
    samples.push({ id: `m${samples.length + 1}`, kind: 'mismatch', requestFrom: c.req.conv, requestIdx: c.req.recordIdx, outputFrom: c.out.conv, outputIdx: c.out.recordIdx, gold: 0 });
  }

  const doc = {
    kind: 'block119-judge-fit-corpus',
    version: '1.1.0',
    capturedAt: new Date().toISOString(),
    sourceDir: '.petri-dev-user-data/data/llm-transcripts（gitignored；语料只存指针，原文不入仓）',
    labeling: '配对设计（BLOCK-110 先例）：outcome_positive=真实请求-回复配对；turn_mismatch=同会话下一轮请求×本轮回复（同域话题定义性不契合）；mismatch=跨会话错配（硬负例）。迭代留痕：纠错词结果信号在 327 配对命中 0（语料以验收探针为主）、finishReason=length 全库 1 条，均弃用——本语料难度为 fit 任务下界，采纳门控按保守解读。',
    distribution: {
      convUnits: units.length, turnsTotal: flat.length, count: samples.length,
      byKind: samples.reduce((a, s) => ({ ...a, [s.kind]: (a[s.kind] || 0) + 1 }), {}),
    },
    samples,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
  console.log(`语料 ${samples.length} 条 → ${path.relative(root, OUT)}`);
  console.log(`分布：${JSON.stringify(doc.distribution.byKind)}`);
}

main();
