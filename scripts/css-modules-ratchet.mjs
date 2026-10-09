#!/usr/bin/env node
'use strict';

/**
 * scripts/css-modules-ratchet.mjs — CSS Modules 约定棘轮（BLOCK-154 P2-2）
 *
 * 纪律：新代码必须使用 CSS Modules（*.module.css），plain CSS 只出不进。
 *   - 现状：~60 个 *.module.css（新代码主流）+ 13 个 plain CSS（全局/遗留）。
 *   - 棘轮：冻结 13 个 plain CSS 路径为白名单 baseline；新增 plain CSS 即红
 *     （「新代码必须使用 *.module.css」）；白名单条目随迁移为 module 后从 baseline
 *     移除（出），不得追加新 plain CSS 路径（不进）。
 *
 * 用法：
 *   node scripts/css-modules-ratchet.mjs           # 打印当前 plain CSS 清单
 *   node scripts/css-modules-ratchet.mjs --check   # 门禁：新增 plain CSS 即红
 *   node scripts/css-modules-ratchet.mjs --write   # 重锚 baseline（迁移 plain→module 后）
 *   --baseline <path> --src <path>                  # 自测注入
 *
 * 可复现契约：同 HEAD 两次 --check 输出逐字节一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'acceptance', 'block-92', 'css-plain-baseline.json');
const SRC_DIR = path.join(ROOT, 'frontend', 'src');
const SCHEMA_V1 = 'biof3/block154-css-plain-ratchet.v1';

function walkCss(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkCss(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.css') && !entry.name.endsWith('.module.css')) {
      acc.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  }
  return acc;
}

function scanPlainCss(srcDir = SRC_DIR) {
  return walkCss(srcDir).sort();
}

/**
 * 门禁核心（纯函数，供 CLI 与自测共用）。
 * @returns {{ ok: boolean, violations: string[], warnings: string[] }}
 */
export function evaluateGate({ current, baseline }) {
  const violations = [];
  const warnings = [];
  const baseSet = new Set(baseline.plainCssPaths || []);
  const currentSet = new Set(current);

  // 新增 plain CSS（不在白名单）→ 红
  for (const p of current) {
    if (!baseSet.has(p)) {
      violations.push(`${p}: 新增 plain CSS——新代码必须使用 CSS Modules (*.module.css)，plain CSS 只出不进`);
    }
  }
  // 白名单内已不存在的 plain CSS（已迁移/删除）→ 提示可收缩基线
  for (const p of baseline.plainCssPaths || []) {
    if (!currentSet.has(p)) {
      warnings.push(`${p}: plain CSS 已移除——可 --write 收缩 baseline`);
    }
  }
  return { ok: violations.length === 0, violations, warnings };
}

function isDirectInvocation() {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] || '').href;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const argValue = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const baselinePath = argValue('--baseline') || BASELINE;
  const srcDir = argValue('--src') || SRC_DIR;
  const current = scanPlainCss(srcDir);

  if (args.includes('--check')) {
    let baseline;
    try {
      baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    } catch {
      console.error(`[css-modules-ratchet] FAIL 基线文件不可读: ${baselinePath}`);
      process.exit(1);
    }
    if (baseline.schema !== SCHEMA_V1) {
      console.error(`[css-modules-ratchet] FAIL 基线 schema 不符（需要 ${SCHEMA_V1}）`);
      process.exit(1);
    }
    const result = evaluateGate({ current, baseline });
    for (const w of result.warnings) console.warn(`[css-modules-ratchet] WARN ${w}`);
    if (!result.ok) {
      console.error('[css-modules-ratchet] FAIL 新增 plain CSS：');
      for (const v of result.violations) console.error(`  - ${v}`);
      process.exit(1);
    }
    console.log(`[css-modules-ratchet] PASS（plain CSS ${current.length} 个，全在白名单内；白名单 ${baseline.plainCssPaths.length} 个）`);
    process.exit(0);
  }

  const payload = JSON.stringify({ schema: SCHEMA_V1, plainCssPaths: current }, null, 2);
  if (args.includes('--write')) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, `${payload}\n`);
    console.log(`[css-modules-ratchet] baseline 已写入 ${path.relative(ROOT, baselinePath) || baselinePath}（${current.length} 个 plain CSS）`);
  } else {
    console.log(payload);
  }
}

if (isDirectInvocation()) {
  await main();
}
