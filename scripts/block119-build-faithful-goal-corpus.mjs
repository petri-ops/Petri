#!/usr/bin/env node
/**
 * BLOCK-119 加映 2 — faithful/goal 校准语料构建器（仓内文档锚定，纯确定性零网络）。
 *
 * 用法：
 *   node scripts/block119-build-faithful-goal-corpus.mjs [--dry]
 *
 * 构造（全部仓内来源，无用户数据=无隐私面；零网络=完全可复现）：
 *   faithful（noul，gold=1 全部内容可由参考材料支持 / gold=0 含编造）：
 *     正例（gold=1，三种抽取式轮转——抽取不改写，构造上必然忠实）：
 *       verbatim=材料切片；shuffled=句子乱序重排；head3=前三句摘录；
 *     负例（gold=0）=对正例的机械扰动轮转：op0 数字改写/op1 极性翻转/
 *       op2 编造插入/op3 绝对化伪结论——扰动后必含参考材料不支持的声明。
 *     注：2026-09-23 曾尝试产品 chat 模型作生成式正例作者，实测 SSE 上游中途掐断
 *     （ERR terminated）不可靠，且作者=评判者有同源偏置——改定抽取式（gold 更硬）。
 *   goal（逐目标 noul，gold 由构造可核对）：
 *     每文档 2-3 条内容要求目标（主题词提及/含具体数字/列举要点提及）× 3 种覆盖变体
 *     （verbatim/截断 40%/去数字），逐目标 gold 在构造时由包含性检查落定。
 * 隐私：全部文本派生自仓内文档，语料随仓存储；记录 provenance 可复现。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { round4 } from './lib/calibration-common.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'acceptance', 'block-119', 'corpus-judge-faithful-goal.json');

const DOCS_MIN_CHARS = 600;
const DOC_TARGET = 56;
const REF_CHUNK_CHARS = 1000;

const POLARITY = [['必须', '不必'], ['不能', '能'], ['支持', '不支持'], ['增加', '减少'], ['需要', '无需'], ['可以', '不可']];
const FAB_APPEND = '。此外，据 2027 年官方统计，相关比例已达到 38.6%，并将在下一季度全面翻倍。';
const ABS_APPEND = '。综上所述，该材料明确表示所有功能均已在生产环境全面上线，无需任何后续工作。';

function walkMd(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) {
      if (f.name === 'archive' || f.name === 'node_modules') continue;
      walkMd(p, out);
    } else if (f.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function norm(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

function pickDocs() {
  const candidates = walkMd(path.join(root, 'docs'));
  for (const extra of ['README.md', 'AGENTS.md']) {
    const p = path.join(root, extra);
    if (fs.existsSync(p)) candidates.push(p);
  }
  const ok = candidates
    .map((p) => {
      const raw = fs.readFileSync(p, 'utf8');
      return { rel: path.relative(root, p).split('\\').join('/'), raw, text: norm(raw) };
    })
    .filter((d) => d.text.length >= DOCS_MIN_CHARS)
    .sort((a, b) => a.rel.localeCompare(b.rel));
  return ok.slice(0, DOC_TARGET);
}

function perturb(text, op) {
  if (op === 0) {
    return text.replace(/\d+/, (m) => String(Number(m) * 2 + 7));
  }
  if (op === 1) {
    for (const [a, b] of POLARITY) {
      if (text.includes(a)) return text.replace(a, b);
    }
    return text + ABS_APPEND;
  }
  if (op === 2) return text + FAB_APPEND;
  return text + ABS_APPEND;
}

function firstListKeyword(docText) {
  for (const line of docText.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*+]|\d+[.、)])\s*(.{4,24})/);
    if (m) return norm(m[1]).slice(0, 10);
  }
  return null;
}

function topicTerm(doc) {
  const h = doc.raw.match(/^#\s+(.+)$/m);
  if (h) return norm(h[1]).slice(0, 10);
  const base = path.basename(doc.rel, '.md');
  return base.slice(0, 10);
}

/** 抽取式正例（轮转三种风格）——抽取不改写，构造上必然忠实。 */
function extractivePositive(doc, i) {
  const sentences = doc.text.slice(0, REF_CHUNK_CHARS).split(/(?<=[。！？；.!?;])/).filter((s) => s.trim().length >= 6);
  const style = i % 3;
  if (style === 0) return { style: 'verbatim', output: doc.text.slice(Math.min(320, Math.max(0, doc.text.length - 500)), Math.min(820, doc.text.length)) };
  if (style === 1) {
    return { style: 'head3', output: sentences.slice(0, 3).join('') };
  }
  const reordered = [sentences[1], sentences[0], sentences[3], sentences[2], sentences[4]].filter(Boolean).join('');
  return { style: 'shuffled', output: reordered.length >= 40 ? reordered : sentences.slice(0, 3).join('') };
}

async function main() {
  const dry = process.argv.slice(2).includes('--dry');
  const docs = pickDocs();
  if (docs.length < 20) throw new Error(`合格文档不足 20（现 ${docs.length}），放宽 DOCS_MIN_CHARS`);

  // ── faithful 语料 ──
  const faithful = [];
  docs.forEach((doc, i) => {
    const reference = doc.text.slice(0, REF_CHUNK_CHARS);
    const request = '请根据参考材料写一段要点摘要，只使用材料中出现的信息。';
    const pos = extractivePositive(doc, i);
    faithful.push({
      id: `f-pos-${i}`, dim: 'faithful', kind: `positive_${pos.style}`, gold: 1,
      doc: doc.rel, request, reference, output: pos.output,
    });
    faithful.push({
      id: `f-neg-${i}`, dim: 'faithful', kind: `negative_op${i % 4}`, gold: 0,
      doc: doc.rel, request, reference, output: perturb(pos.output, i % 4), op: i % 4,
    });
  });

  // ── goal 语料（每文档 3 覆盖变体 × 2-3 目标，gold 构造期落定） ──
  const goal = [];
  docs.forEach((doc, i) => {
    const reference = doc.text.slice(0, REF_CHUNK_CHARS);
    const term = topicTerm(doc);
    const listKw = firstListKeyword(doc.raw);
    const mkGoals = (output) => {
      const goals = [
        { text: `摘要包含关于「${term}」的内容`, gold: norm(output).toLowerCase().includes(term.toLowerCase()) ? 1 : 0 },
        { text: '包含至少一个具体数字', gold: /\d/.test(output) ? 1 : 0 },
      ];
      if (listKw) goals.push({ text: `提及材料中的列举要点「${listKw}」`, gold: norm(output).includes(listKw) ? 1 : 0 });
      return goals;
    };
    const variants = [
      { tag: 'full', output: doc.text.slice(Math.min(320, Math.max(0, doc.text.length - 500)), Math.min(820, doc.text.length)) },
      { tag: 'truncated', output: doc.text.slice(0, Math.max(120, Math.floor(doc.text.slice(0, REF_CHUNK_CHARS).length * 0.4))) },
      { tag: 'digitless', output: doc.text.slice(0, 500).replace(/\d+[.、]?\s*/g, '') },
    ];
    for (const v of variants) {
      goal.push({
        id: `g-${i}-${v.tag}`, dim: 'goal', kind: `coverage_${v.tag}`,
        doc: doc.rel, request: '请根据参考材料完成摘要任务。', reference,
        output: v.output, goals: mkGoals(v.output).map((g) => g.text),
        goalGold: mkGoals(v.output).map((g) => g.gold),
      });
    }
  });

  const total = { faithful: faithful.length, goalOutputs: goal.length, goalJudgments: goal.reduce((n, g) => n + g.goals.length, 0) };

  if (dry) {
    console.log(`合格文档 ${docs.length}；faithful 样本 ${total.faithful}（正例 ${faithful.filter((s) => s.gold === 1).length}）；goal 输出变体 ${total.goalOutputs} × 目标判定 ≈ ${total.goalJudgments}`);
    console.log('--dry 通过（零网络，构造完全确定）');
    return;
  }

  const corpus = {
    kind: 'block119-corpus-faithful-goal',
    version: '1.0.0',
    capturedAt: new Date().toISOString(),
    labeling: '仓内文档锚定（纯确定性构造，零网络零模型）：faithful 正例=抽取式轮转（verbatim 切片/head3 前三句/shuffled 句序重排，抽取不改写=构造上必然忠实）、负例=机械扰动（op0 数字改写/op1 极性翻转/op2 编造插入/op3 绝对化伪结论，扰动后必含参考材料不支持声明）；goal=内容要求逐目标 noul（主题词提及/含具体数字/列举要点提及），gold 由构造期包含性检查落定。全部文本派生自仓内文档，无用户数据。caveat=正例为抽取式（非生成式摘要），语料难度为 faithful 任务下界，门控采纳按保守解读。',
    docs: docs.length,
    distribution: { faithfulPositives: faithful.filter((s) => s.gold === 1).length, faithfulNegatives: faithful.filter((s) => s.gold === 0).length, goalOutputs: goal.length },
    samples: { faithful, goal },
    meta: { totals: total, avgRefLen: round4(docs.reduce((n, d) => n + d.text.slice(0, REF_CHUNK_CHARS).length, 0) / docs.length) },
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(corpus, null, 2) + '\n');
  console.log(`语料已写入 ${path.relative(root, OUT)}：faithful ${total.faithful}（正 ${faithful.filter((s) => s.gold === 1).length}/负 ${faithful.filter((s) => s.gold === 0).length}）；goal 变体 ${total.goalOutputs} × 判定 ≈ ${total.goalJudgments}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
