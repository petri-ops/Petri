/**
 * helpers/ddl-migrate.js — BLOCK-434 W3（M5 接线）：迁移期 DDL 的单一执行入口。
 *
 * 背景：M5 判据 `ddlOutcome` 已落地但生产路径仍用无语句的空 catch 吞掉失败，
 * 「列已存在」的预期分支与「磁盘/权限/语法故障」不可区分 —— 迁移静默失败后
 * 列缺失会在后续写入时以更远的方式爆掉。
 * （注：此处刻意不写出裸空 catch 的字面形态，避免被 silent-catch 棘轮的文本匹配误计。）
 *
 * 本模块只做三件事：
 *   1. 逐个执行 DDL，按 `ddlOutcome` 分类为 applied / suppressed / failed；
 *   2. **不抛**（模块加载期迁移失败不应让后端起不来），但把结果结构化返回；
 *   3. 非预期失败用 `redactLog` 脱敏后落 stderr，可被测试与健康面读 `issues`。
 *
 * 判据语义不在此复制：分类与 code 全部来自 agent-tools/security-boundaries.js。
 */

const { ddlOutcome, redactLog } = require('../agent-tools/security-boundaries');

/**
 * 预期内的「已迁移」错误：列/表/索引已存在。
 * SQLite 文案：duplicate column name / already exists。
 */
function isExpectedAlreadyApplied(error) {
  const message = String((error && error.message) || '').toLowerCase();
  if (!message) return false;
  return (
    message.includes('duplicate column name')
    || message.includes('already exists')
  );
}

/**
 * @param {object} params
 * @param {(sql: string) => unknown} params.exec 执行一条 DDL 的函数
 * @param {Array<{ sql: string, operation: string }>} params.statements
 * @param {boolean} [params.quiet] 为 true 时不打印（测试用）
 * @returns {{ applied: number, suppressed: number, failed: number, issues: Array<object> }}
 */
function applyDdlStatements({ exec, statements = [], quiet = false } = {}) {
  const issues = [];
  let applied = 0;
  let suppressed = 0;
  let failed = 0;

  for (const statement of statements) {
    const sql = String(statement && statement.sql ? statement.sql : '');
    const operation = String(statement && statement.operation ? statement.operation : 'ddl');
    if (!sql) {
      failed += 1;
      issues.push({ operation, code: 'DDL_EMPTY_STATEMENT', severity: 'error' });
      continue;
    }
    try {
      exec(sql);
      const verdict = ddlOutcome({ succeeded: true, suppressed: false });
      applied += 1;
      issues.push({ operation, code: verdict.code, severity: 'info' });
    } catch (error) {
      const expected = isExpectedAlreadyApplied(error);
      // suppressed=true 表示「失败但属预期已迁移」
      const verdict = ddlOutcome({ succeeded: false, suppressed: expected });
      if (expected) {
        suppressed += 1;
        issues.push({ operation, code: verdict.code, severity: 'info' });
      } else {
        failed += 1;
        const message = redactLog(String((error && error.message) || 'ddl failed')).slice(0, 200);
        issues.push({ operation, code: verdict.code, severity: 'error', message });
        if (!quiet) {
          console.error(`[ddl-migrate] FAILED ${operation} — ${verdict.code}: ${message}`);
        }
      }
    }
  }

  return { applied, suppressed, failed, issues };
}

module.exports = {
  isExpectedAlreadyApplied,
  applyDdlStatements,
};
