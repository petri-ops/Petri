/**
 * item 87 第一阶段 HK-01 — 引用纪律钉 + bio 三件套资产自洽。
 * ③引用纪律钉：领域断言无来源=红（含资产面：playbook「依据:」与品味样本「来源」
 *   必须解析回 sources.yaml 已登记真理源）。
 * sources.yaml schema：结构非法/权威等级未知/缺字段=红。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const requireFrom = (rel) => require(path.join(ROOT, rel));
const {
  parseSourcesYaml,
  validateSourcesFile,
  buildSourceIndex,
} = requireFrom('core/shared-backend/do-sources.js');
const {
  checkCitationDiscipline,
  extractPlaybookSourceRefs,
} = requireFrom('core/shared-backend/citation-discipline.js');

const BIO_DIR = path.join(ROOT, 'resources', 'domain-onboarding', 'petri-pack-bio');
const SOURCES_PATH = path.join(BIO_DIR, 'sources.yaml');
const PLAYBOOK_PATH = path.join(BIO_DIR, 'playbooks', 'deseq2-differential-analysis.md');
const TASTE_PATH = path.join(BIO_DIR, 'taste-samples.md');

test('HK-87-12：sources.yaml 解析与 schema 校验——缺字段/未知权威等级=红', () => {
  const ok = validateSourcesFile(`meta:
  domain: bioinformatics
  status: draft
sources:
  - id: ncbi-bookshelf
    name: NCBI Bookshelf
    url: https://www.ncbi.nlm.nih.gov/books/
    authority_level: official
    freshness: stable
    verified_date: 2026-11-27
    notes: 官方教材库
`);
  assert.ok(ok.ok, `合法清单应通过：${JSON.stringify(ok)}`);
  assert.equal(ok.sources.length, 1);

  // 缺 url
  assert.equal(validateSourcesFile(`meta:
  domain: bioinformatics
  status: draft
sources:
  - id: x
    name: X
    authority_level: official
    freshness: stable
    verified_date: 2026-11-27
`).ok, false, '缺 url 必须拒绝');

  // 未知权威等级
  assert.equal(validateSourcesFile(`meta:
  domain: bioinformatics
  status: draft
sources:
  - id: x
    name: X
    url: https://example.com
    authority_level: vibes
    freshness: stable
    verified_date: 2026-11-27
`).ok, false, '未知权威等级必须拒绝');

  // 解析层面：tab / 未知语法 fail-closed
  assert.throws(() => parseSourcesYaml('sources:\n\t- id: x\n'), /YAML|解析|tab/i);
});

test('HK-87-13（钉③）：领域断言无来源=红，来源不在清单=红', () => {
  const index = buildSourceIndex(validateSourcesFile(fs.readFileSync(SOURCES_PATH, 'utf8')).sources);
  const bad = checkCitationDiscipline([
    { statement: 'DESeq2 默认使用 Wald 检验' },
  ], index);
  assert.equal(bad.ok, false, '无来源的领域断言必须红');
  assert.ok(bad.violations[0].statement.includes('DESeq2'));

  const unknown = checkCitationDiscipline([
    { statement: 'STAR 默认输出 BAM', sourceId: 'not-in-list' },
  ], index);
  assert.equal(unknown.ok, false, '不在真理源清单的 sourceId 必须红');

  const good = checkCitationDiscipline([
    { statement: 'DESeq2 默认使用 Wald 检验', sourceId: 'bioconductor-deseq2' },
    { statement: 'STAR 是比对剪接读段的工具', sourceId: 'star-manual' },
  ], index);
  assert.ok(good.ok, `带有效来源的断言应通过：${JSON.stringify(good)}`);
});

test('HK-87-14：bio 三件套资产自洽——playbook/品味样本的来源全部解析回真理源清单', () => {
  assert.ok(fs.existsSync(SOURCES_PATH), 'sources.yaml 草案应存在');
  assert.ok(fs.existsSync(PLAYBOOK_PATH), 'DESeq2 playbook 草案应存在');
  assert.ok(fs.existsSync(TASTE_PATH), '品味样本草案应存在');

  const parsed = validateSourcesFile(fs.readFileSync(SOURCES_PATH, 'utf8'));
  assert.ok(parsed.ok, `真理源清单必须合法：${JSON.stringify(parsed)}`);
  // item 87 确认令（2026-11-27）——owner 已审阅确认，三件套翻 confirmed（回滚=owner 改判）
  assert.equal(parsed.meta.status, 'confirmed', 'owner 确认后 status 应为 confirmed');
  assert.ok(/owner 已审阅确认|已确认/.test(fs.readFileSync(SOURCES_PATH, 'utf8')), '清单文件需保留 owner 确认标记');

  const index = buildSourceIndex(parsed.sources);
  assert.ok(parsed.sources.length >= 4, '至少覆盖 NCBI/Ensembl/STAR/DESeq2 四类权威源');

  const playbookRefs = extractPlaybookSourceRefs(fs.readFileSync(PLAYBOOK_PATH, 'utf8'));
  assert.ok(playbookRefs.length > 0, 'playbook 应带「依据:」来源引用');
  const playbookCheck = checkCitationDiscipline(
    playbookRefs.map((sourceId) => ({ statement: `playbook 依据 ${sourceId}`, sourceId })),
    index
  );
  assert.ok(playbookCheck.ok, `playbook 引用必须全部可解析：${JSON.stringify(playbookCheck)}`);

  // 品味样本的「来源」行同样钉
  const tasteText = fs.readFileSync(TASTE_PATH, 'utf8');
  const tasteRefs = [...tasteText.matchAll(/^来源:\s*(\S+)\s*$/gm)].map((match) => match[1]);
  assert.ok(tasteRefs.length > 0, '品味样本应带来源标注');
  const tasteCheck = checkCitationDiscipline(
    tasteRefs.map((sourceId) => ({ statement: `品味样本来源 ${sourceId}`, sourceId })),
    index
  );
  assert.ok(tasteCheck.ok, `品味样本来源必须全部可解析：${JSON.stringify(tasteCheck)}`);
  assert.ok(/confirmed/.test(tasteText), '品味样本已确认（owner 确认令 2026-11-27）');
});
