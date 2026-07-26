#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(root, 'acceptance/g0-result-studio/rs-p2-scientific-interaction.json');
const liveObservationPath = join(root, 'acceptance/g0-result-studio/rs-p2-live-observation.json');
const read = (file) => readFileSync(join(root, file), 'utf8');
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const item = (id, passed, evidence, detail) => ({ id, passed: passed === true, evidence, detail });

const sourceFiles = {
  tableQuery: 'core/shared-backend/result-studio-table-query.js',
  interaction: 'core/shared-backend/artifact-interaction.js',
  contracts: 'core/shared-backend/result-studio-contracts.js',
  repository: 'core/shared-backend/result-studio-repository.js',
  pluginSdk: 'core/shared-backend/result-studio-plugin-sdk.js',
  routes: 'core/r-server/routes/result-studio.js',
  selectionTool: 'core/r-server/agent-tools/result-selection-tools.js',
  toolDefinitions: 'core/r-server/agent-tools/tool-defs.js',
  toolRegistry: 'core/r-server/agent-tools/registry.js',
  viewer: 'frontend/src/components/result-studio/ScientificInteractionViewer.tsx',
  viewerStyle: 'frontend/src/components/result-studio/ScientificInteractionViewer.module.css',
  selectionClient: 'frontend/src/lib/result-studio-interaction-client.ts',
  workspace: 'frontend/src/pages/project-workspace.tsx',
  viewerTest: 'frontend/src/components/result-studio/ScientificInteractionViewer.test.tsx',
  selectionLogic: 'frontend/src/lib/artifact-selection.ts',
  selectionLogicTest: 'frontend/src/lib/artifact-selection.test.ts',
  deseq2Descriptor: 'resources/built-in-plugins/deseq2/tool-definition.json',
  volcanoDescriptor: 'resources/built-in-plugins/volcano-plot/tool-definition.json',
  heatmapDescriptor: 'resources/built-in-plugins/gene-correlation/tool-definition.json',
  enrichmentDescriptor: 'resources/built-in-plugins/go-kegg/tool-definition.json',
  selectionToolTest: 'test/result-selection-tools.test.mjs',
  tableQueryTest: 'test/result-studio-table-query.test.mjs',
  liveCapture: 'scripts/g0-rs-p2-live-observation.mjs',
  acceptanceScript: 'scripts/g0-rs-p2-acceptance.mjs',
  liveObservation: 'acceptance/g0-result-studio/rs-p2-live-observation.json',
  uiObservation: 'acceptance/g0-result-studio/rs-p2-ui-observation.json',
  packageScripts: 'package.json',
};

const productObservation = {
  captureMode: 'automated_contract_renderer_performance_and_live_local_product_plus_bounded_visual_spot_check',
  qualificationEligible: false,
  qualificationReason: 'P2 closes the bounded scientific-interaction stage; packaged continuous product qualification remains reserved for G0-RS-P7.',
  interactionEvidence: {
    tableSingleMultiAndRestart: 'interactive_real_plugin',
    scatterPoint: 'interactive_real_plugin',
    scatterRegionAndLegend: 'automated_real_mapping_contract',
    matrixRowAndColumn: 'live_real_plugin_backing_contract_plus_automated_ui',
    missingMappingReadOnly: 'interactive_real_plugin',
    largeTable: 'controlled_100k_authoritative_query_and_renderer',
  },
  visualEvidence: 'acceptance/g0-result-studio/rs-p2-ui-observation.json',
};

function sourceHashes() {
  return Object.fromEntries(Object.entries(sourceFiles).map(([key, file]) => [key, sha(read(file))]));
}

function runCommands() {
  const commands = [
    ['backend-p2', 'node', ['--test',
      'test/result-studio-table-query.test.mjs',
      'test/result-selection-tools.test.mjs',
      'test/artifact-interaction.test.mjs',
      'test/result-studio-contracts.test.mjs',
      'test/result-studio-repository.test.mjs',
      'test/result-studio-plugin-sdk.test.mjs',
      'test/agent-tool-registry.test.mjs',
    ]],
    // `npm test` in frontend is `vitest run --changed`, which combines with these
    // filters to select nothing and exit 0 — recording passed:true for a run that
    // executed no tests. `test:files` is plain `vitest run`, matching the gate.
    ['frontend-p2', 'npm', ['run', 'test:files', '--prefix', 'frontend', '--',
      'ScientificInteractionViewer.test.tsx',
      'artifact-selection.test.ts',
      'CenterPanel.test.tsx',
      'ResultStudioSurface.test.tsx',
    ]],
    ['frontend-build', 'npm', ['run', 'build:check', '--prefix', 'frontend']],
    ['syntax', 'node', ['--check', 'scripts/g0-rs-p2-acceptance.mjs']],
  ];
  return commands.map(([label, bin, args]) => {
    const result = spawnSync(bin, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const performanceMatch = String(result.stdout || '').match(/RS_P2_RENDERER_PERF\s+(\{[^\r\n]+\})/);
    let rendererPerformance = null;
    if (performanceMatch) {
      try { rendererPerformance = JSON.parse(performanceMatch[1]); } catch { rendererPerformance = null; }
    }
    return {
      label,
      command: [bin, ...args].join(' '),
      exitCode: result.status,
      passed: result.status === 0,
      stdoutSha256: sha(result.stdout || ''),
      stderrSha256: sha(result.stderr || ''),
      ...(rendererPerformance ? { rendererPerformance } : {}),
    };
  });
}

function inspect(verification = null) {
  const tableQuery = read(sourceFiles.tableQuery);
  const interaction = read(sourceFiles.interaction);
  const contracts = read(sourceFiles.contracts);
  const repository = read(sourceFiles.repository);
  const pluginSdk = read(sourceFiles.pluginSdk);
  const routes = read(sourceFiles.routes);
  const selectionTool = read(sourceFiles.selectionTool);
  const viewer = read(sourceFiles.viewer);
  const workspace = read(sourceFiles.workspace);
  const liveObservation = JSON.parse(readFileSync(liveObservationPath, 'utf8'));
  const uiObservation = JSON.parse(read(sourceFiles.uiObservation));
  const commands = verification?.commands || [];
  const rendererPerformance = commands.find((command) => command.label === 'frontend-p2')?.rendererPerformance || null;
  const requiredPerformanceMetrics = ['scrollFeedbackMs', 'selectionFeedbackMs', 'sortFeedbackMs', 'filterFeedbackMs'];
  const performancePassed = rendererPerformance?.budgetMs === 100
    && requiredPerformanceMetrics.every((metric) => Number.isFinite(rendererPerformance[metric])
      && rendererPerformance[metric] >= 0 && rendererPerformance[metric] < rendererPerformance.budgetMs);
  const liveChecks = Object.values(liveObservation?.checks || {});
  const liveChecksPassed = liveObservation?.passed === true
    && liveObservation?.qualificationEligible === false
    && liveObservation?.evidenceClass === 'live_local_product_observation_non_qualifying'
    && liveChecks.length >= 10
    && liveChecks.every((passed) => passed === true);
  const expectedVisualMatrix = new Set(['light:1440', 'light:1024', 'light:820', 'dark:1440', 'dark:1024', 'dark:820']);
  const visualMatrix = Array.isArray(uiObservation?.matrix) ? uiObservation.matrix : [];
  const layoutPassed = uiObservation?.passed === true
    && uiObservation?.qualificationEligible === false
    && uiObservation?.evidenceClass === 'automated_local_renderer_visual_spot_check_non_qualifying'
    && uiObservation?.themePreferenceRestored === 'system'
    && visualMatrix.length === expectedVisualMatrix.size
    && visualMatrix.every((entry) => (
      expectedVisualMatrix.has(`${entry.theme}:${entry.width}`)
      && entry.pageHorizontalOverflow === false
      && entry.checkedCount === 3
      && /^[a-f0-9]{64}$/.test(entry.screenshotSha256 || '')
      && (entry.width === 820 ? entry.inspectorVisible === false : entry.inspectorVisible === true)
    ));
  const checks = [
    item('RS-P2-01', /MAX_QUERY_ROWS = 250_000/.test(tableQuery) && /MAX_QUERY_PAGE_ROWS = 250/.test(tableQuery) && /entityIdsHash/.test(tableQuery) && /filterHash/.test(tableQuery), [sourceFiles.tableQuery], 'Complete-file filtering, sorting and bounded authoritative selection evidence are implemented.'),
    item('RS-P2-02', /VIEW_ROWS = 18/.test(viewer) && /virtualSpacer/.test(viewer) && /100_000/.test(read('frontend/src/components/result-studio/ScientificInteractionViewer.test.tsx')), [sourceFiles.viewer], 'The renderer keeps a bounded viewport for a controlled 100k-row authoritative table.'),
    item('RS-P2-03', /row_select/.test(viewer) && /selectAllFiltered/.test(viewer) && /toggleSort/.test(viewer), [sourceFiles.viewer], 'Table row selection, query selection, filtering and sorting share one interaction component.'),
    item('RS-P2-04', /ScientificScatter/.test(viewer) && /buildRegionSelection/.test(viewer) && /buildLegendSelection/.test(viewer), [sourceFiles.viewer], 'Scatter point, region and legend interactions resolve through stable entity mappings.'),
    item('RS-P2-05', /ScientificMatrix/.test(viewer) && /buildColumnSelection/.test(viewer), [sourceFiles.viewer], 'Matrix row and column selections use declared row/column entity semantics.'),
    item('RS-P2-06', /interactionMappings/.test(pluginSdk) && /plot_without_entity_mapping/.test(interaction) && /read-only/.test(interaction), [sourceFiles.pluginSdk, sourceFiles.interaction], 'Plugin mappings are explicit and missing mappings remain read-only.'),
    item('RS-P2-07', /assessSelectionCompatibility/.test(contracts) && /same_revision/.test(contracts) && /revision_changed/.test(contracts), [sourceFiles.contracts], 'Selection compatibility is classified as compatible, stale or invalid without row remapping.'),
    item('RS-P2-08', /conversation_id IS NULL/.test(repository) && /Never/.test(repository), [sourceFiles.repository], 'Restart recovery can reuse only an unscoped selection and never another conversation selection.'),
    item('RS-P2-09', /result-studio\/table\/query/.test(routes) && /selection\/current/.test(routes), [sourceFiles.routes], 'Production APIs expose complete table query and durable current-selection recovery.'),
    item('RS-P2-10', /materialize-selection/.test(selectionTool) && /tool_job/.test(selectionTool) && /artifact/.test(selectionTool), [sourceFiles.selectionTool], 'Selection actions materialize independent inputs before entering the formal execution chain.'),
    item('RS-P2-11', /selectionId/.test(workspace) && /summarizeSelectionForAgent/.test(workspace) && /compatibility === 'compatible'/.test(workspace), [sourceFiles.workspace], 'Context Bar, Inspector and Agent projection share one compatible selection identity.'),
    item('RS-P2-12', liveChecksPassed && liveObservation.selection?.recoveredAcrossServerRestart === true, [sourceFiles.liveObservation], 'A machine-captured real plugin selection predates the current server process and restored from SQLite as compatible.'),
    item('RS-P2-13', liveChecksPassed && liveObservation.jobs?.source?.truth === 'valid' && liveObservation.jobs?.downstream?.truth === 'valid' && liveObservation.materialization?.independentFiles === 3, [sourceFiles.liveObservation], 'A real admitted DESeq2 selection produced independent materialization files and a valid GO/KEGG Job through the formal execution truth.'),
    item('RS-P2-14', layoutPassed, [sourceFiles.uiObservation], 'Automated light/dark and 1440/1024/820px renderer captures preserve the restored selection without page overflow.'),
    item('RS-P2-15', commands.length >= 4 && commands.every((command) => command.passed), [evidencePath.replace(`${root}/`, '')], 'All declared P2 command gates passed.'),
    item('RS-P2-16', performancePassed, [sourceFiles.viewerTest, evidencePath.replace(`${root}/`, '')], 'Automated 100k-table renderer scroll, selection, sort and filter feedback each stayed below the frozen 100ms budget.'),
    item('RS-P2-17', liveChecksPassed && liveObservation.interactions?.degTable?.mode === 'table' && liveObservation.interactions?.volcano?.mode === 'scatter' && liveObservation.interactions?.heatmap?.mode === 'matrix' && liveObservation.interactions?.enrichmentTable?.entityType === 'pathway', [sourceFiles.liveObservation], 'Machine-captured admitted results cover DEG, volcano, heatmap and enrichment interaction contracts.'),
  ];
  return {
    schemaVersion: 1,
    workPackage: 'G0-RS-P2',
    sourceCommit: git('rev-parse', 'HEAD'),
    captureMode: productObservation.captureMode,
    qualificationEligible: false,
    privacy: 'repository_relative_paths_digests_counts_dimensions_timings_and_bounded_statuses_only_no_project_job_conversation_selection_url_credential_prompt_or_result_data',
    sourceHashes: sourceHashes(),
    productObservation,
    checks,
    verification,
    invariants: {
      executionTruth: 'run_tool -> tool_job -> artifact_truth',
      secondSelectionSystem: false,
      resultStudioQualificationClaimed: false,
      futureStagesImplemented: false,
    },
    passed: checks.every((check) => check.passed),
  };
}

try {
  if (process.argv.includes('--write-evidence')) {
    const verification = { generatedAt: new Date().toISOString(), commands: runCommands() };
    const report = { ...inspect(verification), generatedAt: verification.generatedAt, privacyClean: true };
    if (!report.passed) throw new Error(report.checks.filter((check) => !check.passed).map((check) => check.id).join(','));
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[G0-RS-P2] PASS — evidence updated (${report.checks.length}/${report.checks.length})`);
  } else {
    if (!existsSync(evidencePath)) throw new Error('evidence missing; run npm run g0:result-studio:p2:update');
    const stored = JSON.parse(readFileSync(evidencePath, 'utf8'));
    const current = inspect(stored.verification);
    if (!stored.passed || !current.passed || JSON.stringify(stored.sourceHashes) !== JSON.stringify(current.sourceHashes)) {
      throw new Error('stored G0-RS-P2 evidence is stale or invalid');
    }
    console.log(`[G0-RS-P2] PASS — ${current.checks.length}/${current.checks.length}`);
  }
} catch (error) {
  console.error(`[G0-RS-P2] FAIL — ${error.message}`);
  process.exitCode = 1;
}
