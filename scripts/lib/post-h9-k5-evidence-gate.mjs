#!/usr/bin/env node
/**
 * K5 / K-32 新证据元数据门（只管本程序新产出，历史证据不回填）。
 *
 * 契约：acceptance/post-h9-2026-11-10/** 下每份 JSON 必须带
 * sourceCommit / platform / command / generatedAt，另有
 * evidenceClass / verdict / humanEyeEquivalent / stack。
 * 四类边界：决策材料不得写 PASS/verified/completed；非人眼证据不得声明
 * humanEyeEquivalent=true；行为/机械/CDP/人眼/真实任务不得互相冒充。
 *
 * 历史证据（acceptance/post-s7-** 等）明确排除：改写历史 = 伪造（既有裁决）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_META, EVIDENCE_CLASSES } from './post-h9-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROGRAM_DIR = 'acceptance/post-h9-2026-11-10';

/** 枚举：只扫本程序目录的 JSON（含 k0..k7 子目录与程序级台账）。 */
export function listProgramEvidence(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json')) out.push(path.relative(root, p));
    }
  };
  const base = path.join(root, PROGRAM_DIR);
  if (fs.existsSync(base)) walk(base);
  return out.sort();
}

/** 纯函数裁决，负测可直接注入坏证据对象。 */
export function validateEvidenceFile(rel, evidence) {
  const issues = [];
  for (const k of REQUIRED_META) {
    if (evidence[k] === undefined || evidence[k] === null || evidence[k] === '') issues.push(`${rel}: 缺 ${k}`);
  }
  if (!/^[0-9a-f]{40}$/.test(String(evidence.sourceCommit || ''))) issues.push(`${rel}: sourceCommit 非 40 位 sha`);
  if (!EVIDENCE_CLASSES.includes(evidence.evidenceClass)) issues.push(`${rel}: evidenceClass 非法`);
  if (evidence.evidenceClass !== 'human-eye' && evidence.humanEyeEquivalent === true) issues.push(`${rel}: 非人眼证据冒充人眼`);
  if (evidence.evidenceClass === 'decision-material' && /PASS|verified|completed/i.test(String(evidence.verdict))) {
    issues.push(`${rel}: 决策材料冒充通过`);
  }
  return { ok: issues.length === 0, issues };
}

export function adjudicateEvidenceSet(files, readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))) {
  const issues = [];
  const classes = {};
  if (files.length === 0) return { ok: false, issues: ['本程序证据目录为空（不得空转）'], fileCount: 0, classes };
  for (const rel of files) {
    let e;
    try { e = readJson(rel); } catch (err) { issues.push(`${rel}: JSON 不可解析 (${err.message})`); continue; }
    const v = validateEvidenceFile(rel, e);
    for (const i of v.issues) issues.push(i);
    classes[e.evidenceClass] = (classes[e.evidenceClass] || 0) + 1;
  }
  return {
    ok: issues.length === 0, issues, fileCount: files.length, classes,
    verdict: issues.length === 0 ? 'program-evidence-metadata-complete' : 'evidence-metadata-incomplete',
    scope: '只校验 acceptance/post-h9-2026-11-10/** 新产出；历史 post-s7/* 不回填',
  };
}

function main() {
  // 严格无例外：本程序目录内每份 JSON（含台账/基线）都必须带元数据，
  // 排除文件会形成假绿；历史 post-s7/* 由目录边界天然隔离，不回填。
  const verdict = adjudicateEvidenceSet(listProgramEvidence());
  console.log(JSON.stringify(verdict, null, 2));
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`[post-h9:k5-gate] fail-closed: ${e.message}`); process.exitCode = 1; }
}
