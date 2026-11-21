#!/usr/bin/env node
'use strict';

/**
 * E-03 SUS / UMUX-Lite 机械核算器（BLOCK-503 甲3 口径）。
 *
 * 口径真源 = acceptance/block503-outputs/jia3-sus-questionnaire.md：
 *   SUS：奇数题得分=选项−1，偶数题=5−选项；总分×2.5 → 0–100；>68 高于平均。
 *   UMUX-Lite：主分 = ((Q1−1)+(Q2−1))/12×100（只取前两题）；第 3 题持续意愿单独报告不并入。
 *   采样：首轮 12 人 / 最低 8；<8 人只报个案读数不出总体分（population 置 null）。
 *
 * 输入 CSV（模板=acceptance/block503-outputs/e03-kit/results-template.csv）：
 *   pid,veteran,tasks,sus1..sus10,umux1,umux2,umux3,date
 * 用法：node scripts/e03-score.mjs <csvPath> [--out <outputDir>]
 * 输出：<out>/score-report.json + score-report.md。Agent 只做机械核算并留痕来源；签字归人。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUS_ITEMS = 10;
const MIN_N = 8;

/** 单人 SUS 标准分（0–100）；非法选项抛错（fail-closed）。 */
export function scoreSus(answers) {
  if (!Array.isArray(answers) || answers.length !== SUS_ITEMS) {
    throw new Error(`SUS 需要恰好 ${SUS_ITEMS} 个选项，收到 ${Array.isArray(answers) ? answers.length : typeof answers}`);
  }
  let sum = 0;
  for (let i = 0; i < SUS_ITEMS; i += 1) {
// eslint-disable-next-line security/detect-object-injection -- 可信内部 JSON 读数面（canonical 契约/测试夹具，键为封闭词表或本地常量），启发式误报；R2 清偿批 S8 依 BLOCK-493 先例行级豁免留痕
    const v = Number(answers[i]);
// eslint-disable-next-line security/detect-object-injection -- 可信内部 JSON 读数面（canonical 契约/测试夹具，键为封闭词表或本地常量），启发式误报；R2 清偿批 S8 依 BLOCK-493 先例行级豁免留痕
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error(`SUS 第 ${i + 1} 题选项非法: ${answers[i]}`);
    sum += (i % 2 === 0) ? v - 1 : 5 - v;
  }
  return sum * 2.5;
}

/** UMUX-Lite 主分（前两题）与第三题持续意愿读数；非法抛错。 */
export function scoreUmuxLite(q1, q2, q3) {
  const vals = [q1, q2, q3].map((x) => Number(x));
  for (let i = 0; i < 3; i += 1) {
// eslint-disable-next-line security/detect-object-injection -- 可信内部 JSON 读数面（canonical 契约/测试夹具，键为封闭词表或本地常量），启发式误报；R2 清偿批 S8 依 BLOCK-493 先例行级豁免留痕
    if (!Number.isInteger(vals[i]) || vals[i] < 1 || vals[i] > 7) throw new Error(`UMUX 第 ${i + 1} 题选项非法: ${[q1, q2, q3][i]}`);
  }
  return {
    main: ((vals[0] - 1) + (vals[1] - 1)) / 12 * 100,
    continueIntent: vals[2],
  };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (x) => (typeof x === 'number' ? Math.round(x * 10) / 10 : x);

/** 解析 CSV → 参与者读数数组；表头/行格式不合抛错。 */
export function parseParticipants(csvText) {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) throw new Error('CSV 至少需要表头 + 1 行数据');
  const header = lines[0].split(',').map((h) => h.trim());
  const required = ['pid', 'veteran', 'tasks', ...Array.from({ length: SUS_ITEMS }, (_, i) => `sus${i + 1}`), 'umux1', 'umux2', 'umux3', 'date'];
  for (const col of required) {
    if (!header.includes(col)) throw new Error(`CSV 缺列: ${col}`);
  }
  return lines.slice(1).map((line, idx) => {
    const cells = line.split(',').map((c) => c.trim());
    if (cells.length !== header.length) throw new Error(`第 ${idx + 2} 行列数 ${cells.length} ≠ 表头 ${header.length}`);
// eslint-disable-next-line security/detect-object-injection -- 可信内部 JSON 读数面（canonical 契约/测试夹具，键为封闭词表或本地常量），启发式误报；R2 清偿批 S8 依 BLOCK-493 先例行级豁免留痕
    const row = Object.fromEntries(header.map((h, i) => [h, cells[i]]));
    return {
      pid: row.pid || `P${idx + 1}`,
      veteran: row.veteran === 'old' ? 'old' : row.veteran === 'new' ? 'new' : (() => { throw new Error(`第 ${idx + 2} 行 veteran 非法（old|new）: ${row.veteran}`); })(),
      tasks: row.tasks,
      date: row.date,
      sus: Array.from({ length: SUS_ITEMS }, (_, i) => row[`sus${i + 1}`]),
      umux: [row.umux1, row.umux2, row.umux3],
    };
  });
}

/** 汇总报告；<MIN_N 人时 population 均值置 null（只报个案）。 */
export function buildReport(participants, { source = 'csv' } = {}) {
  if (!Array.isArray(participants) || participants.length === 0) throw new Error('无参与者读数');
  const rows = participants.map((p) => ({
    pid: p.pid,
    veteran: p.veteran,
    tasks: p.tasks,
    date: p.date,
    sus: scoreSus(p.sus),
    umuxMain: scoreUmuxLite(...p.umux).main,
    umuxContinueIntent: scoreUmuxLite(...p.umux).continueIntent,
  }));
  const belowMinimum = rows.length < MIN_N;
  const split = (v) => rows.filter((r) => r.veteran === v);
  const olds = split('old');
  const news = split('new');
  const taskTypes = [...new Set(rows.map((r) => r.tasks))];
  return {
    schema: 'petri.e03.score-report.v1',
    generatedAt: new Date().toISOString(),
    source,
    caliber: 'SUS ×2.5（>68 参考线）；UMUX-Lite 主分 ((Q1-1)+(Q2-1))/12×100；第 3 题持续意愿单独报告',
    n: rows.length,
    minimumRequired: MIN_N,
    belowMinimum,
    population: belowMinimum ? null : {
      susMean: round1(mean(rows.map((r) => r.sus))),
      susMedian: round1([...rows.map((r) => r.sus)].sort((a, b) => a - b)[Math.floor(rows.length / 2)]),
      umuxMean: round1(mean(rows.map((r) => r.umuxMain))),
      aboveSus68: rows.filter((r) => r.sus > 68).length,
    },
    veterans: {
      old: { n: olds.length, susPerCase: olds.map((r) => r.sus), umuxPerCase: olds.map((r) => round1(r.umuxMain)) },
      new: { n: news.length, susPerCase: news.map((r) => r.sus), umuxPerCase: news.map((r) => round1(r.umuxMain)) },
    },
    taskTypes,
    continueIntentMean: round1(mean(rows.map((r) => r.umuxContinueIntent))),
    perParticipant: rows.map((r) => ({ pid: r.pid, veteran: r.veteran, tasks: r.tasks, date: r.date, sus: r.sus, umuxMain: round1(r.umuxMain), continueIntent: r.umuxContinueIntent })),
    note: belowMinimum ? `样本 ${rows.length} < ${MIN_N}：按口径只报个案读数，不出总体分。` : '样本达标，总体读数在案。',
  };
}

function toMd(report) {
  const lines = [
    '# E-03 · SUS / UMUX-Lite 机械核算报告',
    '',
    `- 生成：${report.generatedAt}｜来源：${report.source}｜n=${report.n}（最低 ${report.minimumRequired}）`,
    `- 口径：${report.caliber}`,
    `- 总体读数：${report.population ? `SUS 均值 ${report.population.susMean}（中位 ${report.population.susMedian}，>68 人数 ${report.population.aboveSus68}）/ UMUX-Lite 均值 ${report.population.umuxMean}` : '未出（样本不足，只报个案）'}`,
    `- 持续意愿（第 3 题，不并入主分）均值：${report.continueIntentMean}`,
    `- 老/新分布：old=${report.veterans.old.n}｜new=${report.veterans.new.n}｜任务类型：${report.taskTypes.join('/')}`,
    `- 说明：${report.note}`,
    '',
    '| pid | 老/新 | 任务 | 日期 | SUS | UMUX-Lite 主分 | 持续意愿 |',
    '|---|---|---|---|---|---|---|',
    ...report.perParticipant.map((r) => `| ${r.pid} | ${r.veteran} | ${r.tasks} | ${r.date || ''} | ${r.sus} | ${r.umuxMain} | ${r.continueIntent} |`),
    '',
    '签字：样本量 + 分值 + 日期 + 结论由人在 docs/ui-design-ia-decision-material.md §8 E-03 行填写；Agent 零代签。',
    '',
    'G0 开发期常态 · 不外推 packaged/Provider/GA。',
  ];
  return lines.join('\n');
}

function main(argv) {
  const csvPath = argv.find((a) => !a.startsWith('--'));
  if (!csvPath) { console.error('用法: node scripts/e03-score.mjs <csvPath> [--out <dir>]'); process.exitCode = 2; return; }
  const outIdx = argv.indexOf('--out');
  const outDir = outIdx >= 0 ? argv[outIdx + 1] : path.dirname(csvPath);
  const report = buildReport(parseParticipants(fs.readFileSync(csvPath, 'utf8')), { source: csvPath });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'score-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'score-report.md'), toMd(report));
  console.log(`[e03-score] n=${report.n} belowMinimum=${report.belowMinimum} → ${outDir}/score-report.{json,md}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`[e03-score] ${e.message}`); process.exitCode = 1; }
}
