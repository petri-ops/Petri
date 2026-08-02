import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('P7 producer is packaged-only, source-bound, and never imports historical RS9 evidence', () => {
  const source = readFileSync(new URL('../scripts/g0-rs-p7-acceptance.mjs', import.meta.url), 'utf8');
  assert.match(source, /appMode: 'packaged_desktop_app'/);
  assert.match(source, /sourceCommitMatchesSourceHashes/);
  assert.match(source, /connectToPackagedPage/);
  assert.match(source, /providerPreflight/);
  assert.doesNotMatch(source, /rs9-(?:product|provider|visual)-acceptance\.json/);
  assert.doesNotMatch(source, /manual_boolean|asserted_constant|prompt_expected_json/);
});

test('P7 producer requires two real Provider classes and all five task ids', () => {
  const source = readFileSync(new URL('../scripts/g0-rs-p7-acceptance.mjs', import.meta.url), 'utf8');
  for (const task of [
    'deg_selection_to_enrichment',
    'volcano_ai_presentation_edit',
    'heatmap_manual_then_ai_edit',
    'scientific_threshold_recompute',
    'historical_alternative_compare',
  ]) assert.match(source, new RegExp(task));
  assert.match(source, /selected\.has\('deepseek'\).*selected\.has\('openai-compatible'\)/s);
});
