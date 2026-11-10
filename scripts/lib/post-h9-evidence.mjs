#!/usr/bin/env node
/**
 * post-H9 程序证据写入器（单一实现，八阶段复用）。
 *
 * 契约：所有新产出证据 JSON 必须带 sourceCommit / platform / command / generatedAt，
 * 另有 evidenceClass / verdict / humanEyeEquivalent / stack 五类互不冒充声明。
 * 历史证据不回填（改写历史 = 伪造，AUDIT-LOG 2026-11-09 既有裁决）。
 *
 * 用法（CLI）：
 *   node scripts/lib/post-h9-evidence.mjs --out <rel> --kind <kind> \
 *     --command "<复跑命令>" --verdict <verdict> --evidence-class <class> \
 *     --payload <json-file> [--human-eye-equivalent false] [--stack <stack>]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const REQUIRED_META = Object.freeze([
  'sourceCommit', 'platform', 'command', 'generatedAt',
  'evidenceClass', 'verdict', 'humanEyeEquivalent', 'stack',
]);

export const EVIDENCE_CLASSES = Object.freeze([
  'behavior-test',       // ① 行为/契约测试
  'mechanical-gate',     // ② 机械门禁
  'cdp-live',            // ③ DOM 与 CDP 实机
  'human-eye',           // ④ 人眼观感（只由人产出）
  'real-task',           // ⑤ 真实任务成功
  'decision-material',   // 决策材料（不是上列五类证据，不计通过）
]);

export function evidenceMeta(root = ROOT) {
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return {
    sourceCommit,
    platform: `${os.platform()}-${os.arch()}`,
    generatedAt: new Date().toISOString(),
  };
}

/** 校验证据对象元数据齐备；返回 {ok, missing, violations} 而不是抛错，供负测直接消费。 */
export function validateEvidence(evidence) {
  const missing = REQUIRED_META.filter((k) => evidence === null || evidence === undefined || evidence[k] === undefined || evidence[k] === null || evidence[k] === '');
  const violations = [];
  if (evidence && typeof evidence === 'object') {
    if (!/^[0-9a-f]{40}$/.test(String(evidence.sourceCommit || ''))) violations.push('sourceCommit 必须是 40 位完整 sha');
    if (!EVIDENCE_CLASSES.includes(evidence.evidenceClass)) violations.push('evidenceClass 不在封闭词表内');
    if (evidence.evidenceClass !== 'human-eye' && evidence.humanEyeEquivalent === true) violations.push('非人眼证据不得声明 humanEyeEquivalent=true');
    if (evidence.evidenceClass === 'decision-material' && /PASS|verified|completed/i.test(String(evidence.verdict))) violations.push('决策材料不得冒充通过/验证/完成');
  }
  return { ok: missing.length === 0 && violations.length === 0, missing, violations };
}

/** 组装并写盘；校验不过即 fail-closed，不写文件。 */
export function writeEvidence({ out, kind, command, verdict, evidenceClass, payload = {}, humanEyeEquivalent = false, stack = 'none', root = ROOT }) {
  const meta = evidenceMeta(root);
  const evidence = {
    schemaVersion: 1,
    kind,
    ...meta,
    command,
    verdict,
    evidenceClass,
    humanEyeEquivalent,
    stack,
    ...payload,
  };
  const check = validateEvidence(evidence);
  if (!check.ok) throw new Error(`[post-h9:evidence] 元数据不合格，拒绝写盘: ${JSON.stringify(check)}`);
  const abs = path.resolve(root, out);
  if (!abs.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('[post-h9:evidence] 输出路径越出仓库根');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function main(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const out = arg('--out');
  const kind = arg('--kind', 'post-h9-evidence');
  const command = arg('--command', '');
  const verdict = arg('--verdict', 'measured');
  const evidenceClass = arg('--evidence-class', 'mechanical-gate');
  const payloadFile = arg('--payload');
  const payload = payloadFile ? JSON.parse(fs.readFileSync(path.resolve(ROOT, payloadFile), 'utf8')) : {};
  const humanEyeEquivalent = arg('--human-eye-equivalent', 'false') === 'true';
  const stack = arg('--stack', 'none');
  if (!out || !command) throw new Error('[post-h9:evidence] 需要 --out 与 --command');
  const evidence = writeEvidence({ out, kind, command, verdict, evidenceClass, payload, humanEyeEquivalent, stack });
  console.log(JSON.stringify({ written: out, sourceCommit: evidence.sourceCommit, verdict: evidence.verdict }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
