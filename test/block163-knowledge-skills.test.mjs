/**
 * BLOCK-163 W3 P11（KNW-6）— 检索→技能建议纯函数契约。
 *
 * 钉住：suggestSkillsForQuery 词面交集映射（id/name/description/category/tags；
 * 命中 ≥1 词面即候选；按命中数排序 TOP 3；零模型零 I/O——技能清单可注入）；
 * knowledge_search 成功路径 additive suggestedSkills 字段（有命中才带）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

// 临时 DB 自举（knowledge-tools → knowledge-space → db.js）
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b163-knw6-'));
{
  const Database = require(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const boot = new Database(path.join(dbDir, 'petri.db'));
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path.join(dbDir, 'petri.db');
}

const { suggestSkillsForQuery } = require(path.join(ROOT, 'core/petri-server/agent-tools/knowledge-tools.js'));

const SKILLS = [
  { id: 'deg-analysis-standard', name: '标准差异分析', description: '从计数矩阵到火山图的 DEG 流程', category: 'bioinformatics/ngs', tags: ['deg', 'deseq2'] },
  { id: 'go-enrichment-analysis', name: 'GO 富集分析', description: '基因功能富集', category: 'bioinformatics/ngs', tags: ['go', 'enrichment'] },
  { id: 'coding-playbook', name: '编码手册', description: '编码守则', category: 'coding/playbook', tags: ['coding'] },
];

test('BLOCK-163 KNW-6 词面映射：查询词命中技能词面即候选，按命中数排序', () => {
  const r = suggestSkillsForQuery('帮我做 deg 差异分析', SKILLS);
  assert.equal(r[0].id, 'deg-analysis-standard');
  // '差异' 命中 description；deg 命中 id+tags
});

test('BLOCK-163 KNW-6 TOP 3 截断与零命中', () => {
  const many = Array.from({ length: 6 }, (_, i) => ({
    id: `s${i}`, name: `s${i}`, description: `common thing ${i}`, category: 'x', tags: [],
  }));
  const r = suggestSkillsForQuery('common', many);
  assert.equal(r.length, 3, 'TOP 3 截断');
  const none = suggestSkillsForQuery('完全无关词', SKILLS);
  assert.equal(none.length, 0);
  const empty = suggestSkillsForQuery('', SKILLS);
  assert.equal(empty.length, 0, '空查询=零建议');
});

test('BLOCK-160 KNW-6 接线钉：knowledge_search 成功路径带 suggestedSkills（源码扫描）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/knowledge-tools.js'), 'utf8');
  assert.match(src, /suggestedSkills/, '命中结果应可携带 suggestedSkills');
  assert.match(src, /suggestSkillsForQuery\(query\)/, '成功路径应调用映射器');
});
