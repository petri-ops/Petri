import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compareScientificTables } = require('../core/shared-backend/result-scientific-compare');

function files(context, before, after) {
  const root = mkdtempSync(join(tmpdir(), 'petri-scientific-compare-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const beforePath = join(root, 'before.csv');
  const afterPath = join(root, 'after.csv');
  writeFileSync(beforePath, before);
  writeFileSync(afterPath, after);
  return { beforePath, afterPath };
}

test('P5 DEG comparison reports significant genes and threshold-bound membership changes', (context) => {
  const paths = files(context,
    'gene,log2FoldChange,padj\nTP53,2,0.01\nEGFR,1.2,0.04\nMYC,-2,0.2\n',
    'gene,log2FoldChange,padj\nTP53,2,0.01\nEGFR,1.2,0.2\nMYC,-2,0.03\n');
  const result = compareScientificTables({
    artifactId: 'deg_table', ...paths,
    beforeParameters: { padj_cutoff: 0.05, lfc_cutoff: 1 },
    afterParameters: { padj_cutoff: 0.05, lfc_cutoff: 1 },
  });
  assert.equal(result.status, 'available');
  assert.deepEqual(result.significantGenes.before, { significantCount: 2, upCount: 2, downCount: 0 });
  assert.deepEqual(result.significantGenes.after, { significantCount: 2, upCount: 1, downCount: 1 });
  assert.deepEqual(result.significantGenes.membership, {
    gainedCount: 1, lostCount: 1, retainedCount: 1, gained: ['MYC'], lost: ['EGFR'],
  });
});

test('P5 DEG comparison refuses to infer significance without exact thresholds or stable ids', (context) => {
  const paths = files(context,
    'gene,log2FoldChange,padj\nTP53,2,0.01\nTP53,1,0.02\n',
    'gene,log2FoldChange,padj\nTP53,2,0.01\nTP53,1,0.02\n');
  const missingThresholds = compareScientificTables({ artifactId: 'deg_table', ...paths });
  assert.equal(missingThresholds.status, 'unavailable');
  assert.equal(missingThresholds.reason, 'scientific_thresholds_unavailable');
  const duplicateIds = compareScientificTables({
    artifactId: 'deg_table', ...paths,
    beforeParameters: { padj_cutoff: 0.05, lfc_cutoff: 1 },
    afterParameters: { padj_cutoff: 0.05, lfc_cutoff: 1 },
  });
  assert.equal(duplicateIds.status, 'unavailable');
  assert.equal(duplicateIds.reason, 'deg_schema_or_stable_gene_id_invalid');
});

test('P5 DEG comparison mirrors strict producer cutoffs and rejects blank statistics', (context) => {
  const boundary = files(context,
    'gene,log2FoldChange,padj\nAT_LFC,1.0,0.01\nAT_PADJ,2.0,0.05\nINSIDE,1.1,0.049\n',
    'gene,log2FoldChange,padj\nAT_LFC,1.0,0.01\nAT_PADJ,2.0,0.05\nINSIDE,1.1,0.049\n');
  const compared = compareScientificTables({
    artifactId: 'deg_table', ...boundary,
    beforeParameters: { padj_cutoff: 0.05, lfc_cutoff: 1 },
    afterParameters: { padj_cutoff: 0.05, lfc_cutoff: 1 },
  });
  assert.equal(compared.status, 'available');
  assert.equal(compared.significantGenes.before.significantCount, 1);
  assert.deepEqual(compared.significantGenes.before, { significantCount: 1, upCount: 1, downCount: 0 });

  const blank = files(context,
    'gene,log2FoldChange,padj\nTP53,2,\n',
    'gene,log2FoldChange,padj\nTP53,2,0.01\n');
  const unavailable = compareScientificTables({
    artifactId: 'deg_table', ...blank,
    beforeParameters: { padj_cutoff: 0.05, lfc_cutoff: 1 },
    afterParameters: { padj_cutoff: 0.05, lfc_cutoff: 1 },
  });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.reason, 'deg_schema_or_stable_gene_id_invalid');
});

test('P5 scientific comparison rejects probability values outside [0, 1]', (context) => {
  for (const invalidPadj of ['-0.01', '1.01']) {
    const deg = files(context,
      `gene,log2FoldChange,padj\nTP53,2,${invalidPadj}\n`,
      'gene,log2FoldChange,padj\nTP53,2,0.01\n');
    const result = compareScientificTables({
      artifactId: 'deg_table', ...deg,
      beforeParameters: { padj_cutoff: 0.05, lfc_cutoff: 1 },
      afterParameters: { padj_cutoff: 0.05, lfc_cutoff: 1 },
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'deg_schema_or_stable_gene_id_invalid');
  }

  for (const invalidAdjusted of ['-0.01', '1.01']) {
    const enrichment = files(context,
      `ID,Description,p.adjust\nGO:1,alpha,${invalidAdjusted}\n`,
      'ID,Description,p.adjust\nGO:1,alpha,0.01\n');
    const result = compareScientificTables({ artifactId: 'go_bp_results', ...enrichment });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'enrichment_schema_or_stable_term_id_invalid');
  }
});

test('P5 volcano and enrichment comparisons distinguish classification, ranking and missing direction', (context) => {
  const volcano = files(context,
    'gene,log2FoldChange,sig\nTP53,2,Up\nEGFR,-2,Down\nMYC,0,NS\n',
    'gene,log2FoldChange,sig\nTP53,2,Up\nEGFR,-2,NS\nMYC,-2,Down\n');
  const volcanoResult = compareScientificTables({ artifactId: 'classified_table', ...volcano });
  assert.equal(volcanoResult.status, 'available');
  assert.equal(volcanoResult.classifications.before.significantCount, 2);
  assert.deepEqual(volcanoResult.classifications.membership.gained, ['MYC']);
  assert.deepEqual(volcanoResult.classifications.membership.lost, ['EGFR']);

  const enrichment = files(context,
    'ID,Description,p.adjust\nGO:1,alpha,0.001\nGO:2,beta,0.01\n',
    'ID,Description,p.adjust\nGO:3,gamma,0.0001\nGO:1,alpha,0.002\n');
  const enrichmentResult = compareScientificTables({ artifactId: 'go_bp_results', ...enrichment });
  assert.equal(enrichmentResult.status, 'available');
  assert.deepEqual(enrichmentResult.terms.topAfter.map((item) => item.id), ['GO:3', 'GO:1']);
  assert.equal(enrichmentResult.direction.status, 'unavailable');
  assert.equal(enrichmentResult.direction.reason, 'enrichment_table_has_no_declared_direction_column');
});

test('P5 enrichment comparison reports audited ranking and direction changes', (context) => {
  const enrichment = files(context,
    'ID,Description,p.adjust,direction\nGO:1,alpha,0.001,up\nGO:2,beta,0.01,mixed\n',
    'ID,Description,p.adjust,direction\nGO:2,beta,0.0001,down\nGO:1,alpha,0.002,up\n');
  const result = compareScientificTables({ artifactId: 'go_bp_results', ...enrichment });
  assert.equal(result.status, 'available');
  assert.deepEqual(result.terms.topAfter.map((item) => item.id), ['GO:2', 'GO:1']);
  assert.equal(result.direction.status, 'available');
  assert.equal(result.direction.changedCount, 1);
  assert.deepEqual(result.direction.changes, [{ id: 'GO:2', before: 'mixed', after: 'down' }]);

  const unsigned = files(context,
    'ID,Description,p.adjust,direction\nGO:1,alpha,0.001,unavailable_without_signed_deg\n',
    'ID,Description,p.adjust,direction\nGO:1,alpha,0.002,unavailable_without_signed_deg\n');
  const unsignedResult = compareScientificTables({ artifactId: 'go_bp_results', ...unsigned });
  assert.equal(unsignedResult.status, 'available');
  assert.equal(unsignedResult.direction.status, 'unavailable');
  assert.equal(unsignedResult.direction.reason, 'enrichment_direction_unavailable_without_signed_deg');
});

test('P5 never assigns scientific semantics to an undeclared table artifact', (context) => {
  const paths = files(context, 'gene,value\nA,1\n', 'gene,value\nA,2\n');
  const result = compareScientificTables({ artifactId: 'arbitrary_table', ...paths });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'scientific_schema_not_declared_for_artifact');
});
