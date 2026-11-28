#!/usr/bin/env node
// Schema 验证门禁：确保 migration 最终 schema 与代码使用的表/列一致
//
// 执行：npm run schema:verify
// 返回：0 = 一致，1 = 发现漂移

const fs = require('fs');
const path = require('path');

// 加载 migration-runner（复用 better-sqlite3 加载逻辑）
const { loadDatabaseConstructor } = require('../src/migration-runner.js');
const Database = loadDatabaseConstructor();

// 临时数据库路径
const tmpDb = path.join(__dirname, '../.tmp-schema-check.db');

/**
 * 在临时库跑完所有 migration，返回最终 schema
 */
async function buildMigrationSchema() {
  // 清理旧临时库
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);

  // 手动跑 migration（复用 migration-runner 逻辑）
  const migrationsDir = path.join(__dirname, '../src/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const db = new Database(tmpDb);
  
  try {
    // 创建 schema_migrations 表
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )`);

    // 按顺序执行所有 migration
    for (const file of files) {
      const version = parseInt(file.match(/^(\d+)_/)?.[1] || '0', 10);
      if (version === 0) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      
      const transaction = db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
      });
      
      transaction();
      console.log(`  ✓ Applied ${file}`);
    }

    // 读取最终 schema
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY name"
    ).all();

    const schema = {};
    for (const { name } of tables) {
      const cols = db.prepare(`PRAGMA table_info(${name})`).all();
      schema[name] = cols.map(c => ({
        name: c.name,
        type: c.type,
        notnull: c.notnull,
        dflt_value: c.dflt_value,
        pk: c.pk
      }));
    }

    return schema;
  } finally {
    db.close();
    // 清理临时库
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  }
}

/**
 * 定义代码中实际使用的 schema（预期）
 * 
 * 这里列出 core/petri-server/db.js 和前端 bridges 中使用的表与关键列。
 * 不需要列出所有列，只需列出代码中 SELECT/INSERT 明确依赖的列。
 */
const expectedSchema = {
  // migration 005 + 008
  projects: ['id', 'name', 'description', 'created_at', 'updated_at'],
  
  // migration 005
  branches: ['id', 'project_id', 'name', 'parent_branch_id', 'created_at', 'updated_at', 'is_active'],
  messages: ['id', 'branch_id', 'role', 'content', 'metadata', 'created_at'],

  // migration 004
  git_repository_consents: ['project_id', 'contract_version', 'allow_existing_repository', 'decision_source', 'created_at', 'updated_at'],

  // migration 015 + 018 + 019 + 020（共享批注表；item 90 阶段二显式保留，028 已 DROP 其余 10 张 RS 专属表）
  result_annotations: ['annotation_id', 'project_id', 'surface', 'kind', 'rect_json', 'comment', 'color', 'author', 'created_at', 'updated_at', 'anchor_json', 'entry_id', 'path_json'],
};

/**
 * 验证 migration schema 是否包含预期的表和列
 */
function verifySchema(actualSchema) {
  let ok = true;
  const errors = [];

  // 检查每个预期表
  for (const [table, expectedCols] of Object.entries(expectedSchema)) {
    if (!actualSchema[table]) {
      errors.push(`❌ 表 \`${table}\` 缺失（代码使用但 migration 未定义）`);
      ok = false;
      continue;
    }

    const actualCols = actualSchema[table].map(c => c.name);
    
    // 检查每个预期列
    for (const col of expectedCols) {
      if (!actualCols.includes(col)) {
        errors.push(`❌ 表 \`${table}\` 缺少列 \`${col}\`（代码使用但 migration 未定义）`);
        ok = false;
      }
    }
  }

  return { ok, errors };
}

/**
 * 主入口
 */
async function main() {
  console.log('Schema 验证门禁');
  console.log('================\n');
  
  console.log('步骤 1：在临时库跑所有 migration...');
  const schema = await buildMigrationSchema();
  console.log(`  ✓ 构建完成，共 ${Object.keys(schema).length} 张表\n`);
  
  console.log('步骤 2：验证代码依赖的表/列是否存在...');
  const { ok, errors } = verifySchema(schema);
  
  if (ok) {
    console.log('  ✅ Schema 验证通过\n');
    console.log('Migration 定义与代码使用一致，未发现漂移。');
    process.exit(0);
  } else {
    console.log('  ❌ Schema 漂移检测到不一致\n');
    errors.forEach(err => console.error(err));
    console.log('\n修复方法：');
    console.log('  1. 创建新 migration 补齐缺失的表/列');
    console.log('  2. 或者修改代码，不使用 migration 未定义的表/列');
    console.log('  3. 参考 src/migrations/README.md 了解 migration 规则');
    process.exit(1);
  }
}

// 执行
main().catch(err => {
  console.error('Schema 验证失败:', err);
  // 清理临时库
  if (fs.existsSync(tmpDb)) {
    try {
      fs.unlinkSync(tmpDb);
    } catch {}
  }
  process.exit(1);
});
