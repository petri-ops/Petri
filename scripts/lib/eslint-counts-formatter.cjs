/**
 * scripts/lib/eslint-counts-formatter.cjs — L0-6 专用 eslint 自定义 formatter。
 *
 * 内建 `json` formatter 会带每个文件的完整 source（实测 11MB+，execFileSync 直接爆）；
 * 本 formatter 只输出逐文件计数，供 scripts/lint-ledger-verify.mjs 机械比对抑制台账：
 *   { "<abs file>": { "errors": n, "warnings": n, "rules": { "<ruleId>": n } } }
 * （ruleId=null 的 fatal 解析错误计入 "fatal"——出现即非零计数，天然 fail-closed。）
 */
'use strict';
module.exports = (results) => {
  const out = {};
  for (const r of results || []) {
    let errors = 0;
    let warnings = 0;
    const rules = {};
    for (const m of r.messages || []) {
      if (m.severity === 2) {
        errors += 1;
        const key = m.ruleId || 'fatal';
        rules[key] = (rules[key] || 0) + 1;
      } else if (m.severity === 1) {
        warnings += 1;
      }
    }
    if (errors > 0 || warnings > 0) out[r.filePath] = { errors, warnings, rules };
  }
  return JSON.stringify(out);
};
