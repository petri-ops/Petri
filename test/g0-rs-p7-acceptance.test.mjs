import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('P7 producer is packaged-only, source-bound, and never imports historical RS9 evidence', () => {
  const source = readFileSync(new URL('../scripts/g0-rs-p7-acceptance.mjs', import.meta.url), 'utf8');
  assert.match(source, /appMode: 'packaged_desktop_app'/);
  assert.match(source, /sourceCommitMatchesSourceHashes/);
  assert.match(source, /connectToPackagedPage/);
  assert.match(source, /providerPreflight/);
  assert.match(source, /NSRunningApplication\(processIdentifier:/);
  assert.match(source, /activateAllWindows/);
  assert.match(source, /kCGWindowLayer/);
  for (const completionSource of [
    'core/biof3-server/agent-runner.js',
    'core/biof3-server/agent-tools/agent-loop-control.js',
    'core/biof3-server/agent-tools/result-context-binding.js',
    'frontend/src/lib/result-edit-agent-bridge.ts',
  ]) assert.match(source, new RegExp(completionSource.replaceAll('/', '\\/').replaceAll('.', '\\.')));
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

test('P7 scientific UI trace completes an explicit Provider confirmation turn without weakening verification', () => {
  const source = readFileSync(new URL('../scripts/g0-rs-p6-ui110-driver.cjs', import.meta.url), 'utf8');
  assert.match(source, /确认执行这次科学重算/);
  assert.match(source, /expectedCompletion:\s*verifiedCandidateTerminal/);
  assert.match(source, /scientific-impact acknowledgement/);
  assert.match(source, /agent terminal response did not confirm the expected successful outcome/);
});

test('P7 UI trace accepts truthful enrichment submission or completion wording', () => {
  const source = readFileSync(new URL('../scripts/g0-rs-p6-ui110-driver.cjs', import.meta.url), 'utf8');
  assert.match(source, /function enrichmentTerminal\(text\)/);
  assert.match(source, /任务已经提交\|已成功执行\|分析已完成/);
  assert.match(source, /expectedCompletion:[\s\S]*enrichmentTerminal/);
});

test('P7 bound drawer completion guard covers both legacy HTTP and durable task Agent paths', () => {
  for (const path of ['routes/ai-agent.js', 'agent-runner.js']) {
    const source = readFileSync(new URL(`../core/biof3-server/${path}`, import.meta.url), 'utf8');
    assert.match(source, /createResultEditCompletionGuard/);
    assert.match(source, /expectation:\s*toolCtx\.resultStudioCompletionExpectation/);
    assert.match(source, /resultEditCompletionGuard\.recordToolResult\(name, result\)/);
    assert.match(source, /result_edit_completion_retry/);
    assert.match(source, /resultEditCompletionGuard\.required/);
    assert.match(source, /resultEditCompletionGuard\.requiresToolExecution\(\)/);
    assert.match(source, /resultEditCompletionGuard\.requiredToolChoice\(\)/);
  }
});
