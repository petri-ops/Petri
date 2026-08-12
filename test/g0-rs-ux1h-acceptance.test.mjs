import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildUx1hEvidence,
  observeAirwayDataset,
  resolveUx1hElectronPath,
} from '../scripts/g0-rs-ux1h-acceptance.mjs';
import { buildSdc1GatewayResponse } from '../scripts/g0-sdc1-local-gateway.mjs';

test('resolves the UX1H Electron executable for Windows and POSIX', () => {
  assert.match(resolveUx1hElectronPath('/repo', 'win32').replaceAll('\\', '/'),
    /\/node_modules\/electron\/dist\/electron\.exe$/);
  assert.match(resolveUx1hElectronPath('/repo', 'darwin').replaceAll('\\', '/'),
    /\/node_modules\/\.bin\/electron$/);
});

function responseBody(messages) {
  return { messages };
}

test('observes the checked-in airway fixture shape and groups exactly', () => {
  const dataset = observeAirwayDataset();
  assert.equal(dataset.featureRows, 34_889);
  assert.equal(dataset.sampleColumns, 8);
  assert.equal(dataset.metadataRows, 8);
  assert.deepEqual(dataset.groups, { control: 4, treated: 4 });
  assert.match(dataset.countsSha256, /^[a-f0-9]{64}$/);
  assert.match(dataset.metadataSha256, /^[a-f0-9]{64}$/);
});

test('projects airway control/treated labels into the existing DESeq2 tool call', () => {
  const first = buildSdc1GatewayResponse(responseBody([
    { role: 'user', content: 'Data Profiler 已确认文件，请开始。' },
  ]), {
    countsPath: '/project/data/airway_counts_symbol.csv',
    metadataPath: '/project/data/airway_metadata.csv',
    requestIndex: 1,
    analysis: { design: 'condition', reference: 'control', treatment: 'treated' },
  });
  assert.match(first.response.choices[0].message.content, /对照组 control，实验组 treated/);

  const executed = buildSdc1GatewayResponse(responseBody([
    { role: 'user', content: '确认：design=condition，对照组=control，实验组=treated。' },
    {
      role: 'assistant',
      tool_calls: [{
        function: { name: 'run_tool', arguments: JSON.stringify({ op: 'list' }) },
      }],
    },
    {
      role: 'assistant',
      tool_calls: [{
        function: { name: 'run_tool', arguments: JSON.stringify({ op: 'list', toolId: 'deseq2' }) },
      }],
    },
  ]), {
    countsPath: '/project/data/airway_counts_symbol.csv',
    metadataPath: '/project/data/airway_metadata.csv',
    requestIndex: 3,
    analysis: { design: 'condition', reference: 'control', treatment: 'treated' },
  });
  const args = JSON.parse(executed.response.choices[0].message.tool_calls[0].function.arguments);
  assert.equal(args.params.contrast_ref, 'control');
  assert.equal(args.params.contrast_treat, 'treated');
  assert.equal(args.params.design, 'condition');
});

test('acceptance verdict requires real tool truth, soft presentation, and final socket timeout', () => {
  const renderer = {
    passed: true,
    execution: {
      completedJobCount: 1,
      artifactTruthStatus: 'valid',
      artifactTruthBlocking: false,
    },
    automaticResultOpen: { exactJob: true },
    summaryPresentation: {
      expectedVisible: true,
      forbiddenVisible: false,
      successfulTool: true,
      mode: 'chat',
    },
    screenshots: {
      summaryUnavailable: { file: 'summary-unavailable.png', sha256: 'a'.repeat(64), bytes: 100 },
    },
  };
  const gatewayTrace = [
    { phase: 'scientific_confirmation', behavior: 'response' },
    { phase: 'catalog', behavior: 'response' },
    { phase: 'contract', behavior: 'response' },
    { phase: 'execute', behavior: 'response' },
    { phase: 'final', behavior: 'timeout' },
    { phase: 'final', behavior: 'timeout' },
  ];
  const dataset = {
    countsSha256: 'b'.repeat(64),
    metadataSha256: 'c'.repeat(64),
    featureRows: 34_889,
    sampleColumns: 8,
    metadataRows: 8,
    groups: { control: 4, treated: 4 },
  };
  const binding = {
    sourceCommit: 'abc123',
    sourceHashes: {},
    sourceDigest: 'd'.repeat(64),
    sourceCommitMatchesSourceHashes: true,
    sourceMismatches: [],
  };

  assert.equal(buildUx1hEvidence({
    renderer,
    gatewayTrace,
    binding,
    dataset,
    noSeedPrecondition: true,
  }).passed, true);

  assert.equal(buildUx1hEvidence({
    renderer,
    gatewayTrace: gatewayTrace.map((item) => (
      item.phase === 'final' ? { ...item, behavior: 'response' } : item
    )),
    binding,
    dataset,
    noSeedPrecondition: true,
  }).passed, false);
});
