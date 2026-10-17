#!/usr/bin/env node
/**
 * BLOCK-199 P3 — `npm run config:doctor`：配置诊断出口（本地可审计，零上报）。
 *
 * 为什么要有它：P0 测绘证明本仓配置面**没有任何"你写的键不存在/你的值不生效"的可见通道**——
 * 未知键静默存活、非法值静默丢键、env 静默盖住设置页的值（BLOCK-199 §0.2 三个缺陷都是最后这一类）。
 * 只加校验而不给出口，用户仍然看不见。本 CLI 把三件事一次说清：
 *  ① 落点文件里有哪些**未注册键**（报告，不删不改——旧文件兼容是本包红线）；
 *  ② 已存的值里有哪些**不合形状**（下次写入会被拒绝，先给出预警）；
 *  ③ 哪些键正被**环境变量遮蔽**（=设置页改了看不到效果的根因），并标出"遮蔽后值是否真的不同"。
 *
 * 退出码：默认 0（诊断工具不当门禁）；`--strict` 时②或③中"确实改动了生效值"者存在 → 1。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const schema = require('../core/packages/shared-config/config-schema.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 三族的落点文件与其在文件内的"键袋"位置（形状照现状读，不假设统一）。 */
function storeTargets(env = process.env) {
  const localData = env.PETRI_LOCAL_DATA_DIR || path.join(os.homedir(), 'Documents', 'Petri-Local');
  return [
    { family: 'feature-flags', file: path.join(localData, 'feature-flags.json'), bag: 'flags' },
    { family: 'decision-points', file: env.PETRI_DECISION_CONFIG_PATH || path.join(localData, 'decision-config.json'), bag: 'points', perPoint: true },
    { family: 'generation', file: path.join(localData, 'ai-settings.json'), bag: 'generation' },
    { family: 'cost-cap', file: path.join(localData, 'ai-settings.json'), bag: null, scalarKeys: ['costCapCny'] },
  ];
}

const lookup = (family, p) => schema.findEntryByPath(family, p);

/**
 * 生成诊断报告（纯逻辑，读文件由注入的 readJson 提供，便于离线测）。
 * @param {{readJson:(file:string)=>any, env?:NodeJS.ProcessEnv}} deps
 */
export function buildReport({ readJson, env = process.env }) {
  const report = { stores: [], unknownKeys: [], invalidStoredValues: [], envShadowed: [], unreadable: [] };
  for (const target of storeTargets(env)) {
    let doc;
    try {
      doc = readJson(target.file);
    } catch (e) {
      report.unreadable.push({ family: target.family, file: target.file, reason: e.code || e.message });
      continue;
    }
    report.stores.push({ family: target.family, file: target.file, present: !!doc });
    if (!doc || typeof doc !== 'object') continue;
    const groups = [];
    if (target.scalarKeys) {
      const bag = {};
      for (const k of target.scalarKeys) if (k in doc) bag[k] = doc[k];
      groups.push({ bagName: '(file root)', obj: bag });
    }
    if (target.perPoint) {
      const points = doc[target.bag] || {};
      for (const [point, cfg] of Object.entries(points)) {
        if (!cfg || typeof cfg !== 'object') continue;
        groups.push({ bagName: `points.${point}`, obj: { [`${point}.enabled`]: cfg.enabled, [`${point}.threshold`]: cfg.threshold } });
      }
    } else if (doc[target.bag] && typeof doc[target.bag] === 'object') {
      groups.push({ bagName: target.bag, obj: doc[target.bag] });
    }
    for (const group of groups) {
      const present = Object.fromEntries(Object.entries(group.obj).filter(([, v]) => v !== undefined));
      const diags = schema.diagnoseObject(target.family, present, lookup);
      for (const d of diags) {
        const item = { family: target.family, file: target.file, where: group.bagName, ...d };
        if (d.code === schema.DIAGNOSTIC_CODES.UNKNOWN_KEY) report.unknownKeys.push(item);
        else report.invalidStoredValues.push(item);
      }
      for (const s of schema.envShadowedKeys(target.family, present, env, lookup)) {
        report.envShadowed.push({ family: target.family, file: target.file, where: group.bagName, ...s });
      }
    }
  }
  report.summary = {
    storesScanned: report.stores.length,
    unknownKeys: report.unknownKeys.length,
    invalidStoredValues: report.invalidStoredValues.length,
    envShadowed: report.envShadowed.length,
    envShadowedChangingResult: report.envShadowed.filter((s) => s.overrides).length,
    unreadable: report.unreadable.length,
  };
  return report;
}

const fmtRel = (p) => path.relative(ROOT, p) || p;

function printHuman(report) {
  console.log('=== 配置诊断（config:doctor · 本地生成，零上报）===');
  for (const s of report.stores) console.log(`  落点 ${s.family.padEnd(16)} ${s.present ? '在场' : '缺失'}  ${fmtRel(s.file)}`);
  for (const u of report.unreadable) console.log(`  ⚠ 读不到 ${u.family}: ${fmtRel(u.file)}（${u.reason}）`);
  if (!report.unknownKeys.length) console.log('  未知键：无');
  for (const d of report.unknownKeys) console.log(`  · 未注册键 ${d.family} ${d.where}.${d.path} —— 报告不删（旧文件兼容），下次写入会被拒绝`);
  if (!report.invalidStoredValues.length) console.log('  非法已存值：无');
  for (const d of report.invalidStoredValues) console.log(`  ✖ 非法值 ${d.family} ${d.where}.${d.path} —— ${d.message}`);
  if (!report.envShadowed.length) console.log('  env 遮蔽：无（设置页的值就是生效值）');
  for (const s of report.envShadowed) {
    console.log(`  ⚠ ${s.family} ${s.where} 被 ${s.envKey}=${JSON.stringify(s.envValue)} 遮蔽 → 生效 ${JSON.stringify(s.envValue === '1' || s.envValue === 'true' ? true : s.envValue === '0' || s.envValue === 'false' ? false : Number(s.envValue))}${s.overrides ? '（与设置页不同，改了看不到效果）' : '（与设置页一致）'}`);
  }
  console.log(`  汇总：落点 ${report.summary.storesScanned} · 未知键 ${report.summary.unknownKeys} · 非法值 ${report.summary.invalidStoredValues} · env 遮蔽 ${report.summary.envShadowed}（其中改动生效值 ${report.summary.envShadowedChangingResult}）`);
}

// 直接执行才跑诊断（被 import 时只导出 buildReport，供测试注入假读盘函数）。
const selfPath = fileURLToPath(import.meta.url);
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === selfPath;
if (!invokedDirectly) process.exitCode = 0;
else {
const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  console.log('用法：npm run config:doctor -- [--json] [--strict]');
  console.log('  --json    机器可读输出（供脚本/门禁消费）');
  console.log('  --strict  存在非法已存值或"env 遮蔽且改动了生效值"时退出码 1');
  process.exit(0);
}
const report = buildReport({
  readJson: (file) => JSON.parse(fs.readFileSync(file, 'utf8')),
  env: process.env,
});
if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else printHuman(report);

if (argv.includes('--strict') && (report.invalidStoredValues.length > 0 || report.summary.envShadowedChangingResult > 0)) {
  console.error('[config:doctor] --strict：存在非法已存值或改变生效结果的 env 遮蔽');
  process.exitCode = 1;
}
}
