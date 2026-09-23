#!/usr/bin/env node
/**
 * BLOCK-118 P1 — doc-suggest 语料构建（git 历史挖掘，零用户数据出站）。
 *
 * 用法：node scripts/block118-build-doc-corpus.mjs [--max 150]
 *
 * 样本=一个含代码文件的提交：输入=该提交的代码文件清单（剔除 docs/**、acceptance/**
 * ——防 gold 泄漏进 state），gold=该提交实际回写过的 canonical 文档集合
 * （roadmap/handoff/uiAudit/auditLog/planDoc 五位标签）。
 * 标注代理假设：历史提交「同提交回写了该文档」≈「该改动需要回写该文档」；
 * 噪声（历史漏回写/多余回写）由校准精度门兜底，dry 模式先验分布。
 * 输出：acceptance/block-118/corpus-doc-suggest.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const OUT = path.join(root, 'acceptance', 'block-118', 'corpus-doc-suggest.json');

const DOC_GOLDS = {
  roadmap: ['docs/next-steps-roadmap.md'],
  handoff: ['docs/project-workspace-handoff.md'],
  uiAudit: ['docs/ui-productization-audit.md'],
  auditLog: ['docs/AUDIT-LOG.md'],
};
const PLAN_DOC_RE = /^docs\/.+plan\.md$/i;
const isDocsOrEvidence = (f) => f.startsWith('docs/') || f.startsWith('acceptance/');

function gitLines(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
}

function main() {
  const maxIdx = process.argv.indexOf('--max');
  const max = maxIdx !== -1 ? Number(process.argv[maxIdx + 1]) || 150 : 150;

  const shas = gitLines(['rev-list', '--no-merges', '--format=%s', 'HEAD']);
  // rev-list --format 输出「commit <sha>\n<subject>」交替行
  const commits = [];
  for (let i = 0; i < shas.length; i += 2) {
    if (shas[i].startsWith('commit ')) commits.push({ sha: shas[i].slice(7), subject: shas[i + 1] || '' });
  }

  const samples = [];
  for (let ci = 0; ci < commits.length && samples.length < max; ci++) {
    const { sha, subject } = commits[ci];
    const files = gitLines(['show', '--name-only', '--format=', sha]).map((f) => f.split('\\').join('/'));
    const codeFiles = files.filter((f) => !isDocsOrEvidence(f));
    if (codeFiles.length === 0) continue;
    // D-修订二（2026-09-23 校准抓真）：本仓库实际工作流=「代码提交 + 独立 docs 台账伴随提交」
    //（如 UI-437 feat 与 docs 成对），「该提交自身未碰文档」≠「无需回写」。gold 吸收紧随其后的
    // 纯 docs/acceptance 伴随提交（rev-list 新者在前=列表后续项），否则正例系统性漏标
    //（首轮+次轮校准最优精度≈基础正例率=排序随机，证据=calibration-doc-suggest-cloud-v1/v2）。
    const goldFiles = [...files];
    for (let cj = ci + 1; cj < commits.length; cj++) {
      const companion = gitLines(['show', '--name-only', '--format=', commits[cj].sha]).map((f) => f.split('\\').join('/'));
      if (companion.some((f) => !isDocsOrEvidence(f))) break;
      goldFiles.push(...companion);
    }
    const gold = {};
    for (const [key, paths] of Object.entries(DOC_GOLDS)) {
      gold[key] = goldFiles.some((f) => paths.includes(f)) ? 1 : 0;
    }
    gold.planDoc = goldFiles.some((f) => PLAN_DOC_RE.test(f)) ? 1 : 0;
    const group = (subject.match(/^([a-z]+)[(:]/i) || [])[1] || 'other';
    // D-修订一：state 含意图信号 context（校准=提交 subject；运行时=agent 提供的改动说明）。
    samples.push({
      id: sha.slice(0, 10),
      group,
      subject,
      files: codeFiles.slice(0, 40),
      gold,
    });
  }

  const byGroup = {};
  const positives = { roadmap: 0, handoff: 0, uiAudit: 0, auditLog: 0, planDoc: 0 };
  for (const s of samples) {
    byGroup[s.group] = (byGroup[s.group] ?? 0) + 1;
    for (const k of Object.keys(positives)) positives[k] += s.gold[k];
  }
  const doc = {
    kind: 'block118-doc-suggest-corpus',
    version: '1.0.0',
    capturedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    labeling: '样本=含代码文件的提交；gold=该提交及其紧随纯 docs/acceptance 伴随提交实际回写的 canonical 文档（伴随吸收代理假设）；state 输入=改动说明（提交 subject）+ 代码文件清单（剔除 docs/** 与 acceptance/**，防 gold 泄漏）',
    canonicalDocs: {
      roadmap: 'docs/next-steps-roadmap.md',
      handoff: 'docs/project-workspace-handoff.md',
      uiAudit: 'docs/ui-productization-audit.md',
      auditLog: 'docs/AUDIT-LOG.md',
      planDoc: 'docs/*plan*.md（任意工作包计划文档）',
    },
    distribution: { count: samples.length, byGroup, positives },
    samples,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log(`语料 ${samples.length} 条 → ${path.relative(root, OUT)}`);
  console.log(`group 分布：${JSON.stringify(byGroup)}`);
  console.log(`正例分布：${JSON.stringify(positives)}`);
}

main();
