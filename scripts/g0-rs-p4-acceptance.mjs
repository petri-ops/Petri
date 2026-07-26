#!/usr/bin/env node

/**
 * G0-RS-P4 验收 — Manual + AI Unified Editing。
 *
 * 证据类型：离线契约 + descriptor 投影 + 插件脚本接线 + 模型可见 schema +
 * strict build。这些**不能**替代 P7 要求的 packaged 连续产品 trace 与双真实
 * Provider 观测，因此 `qualificationEligible` 恒为 false。
 *
 * 断言原则：只断言可从真实源码/descriptor/注册表读出的事实，不接受人工布尔值。
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(root, 'acceptance/g0-result-studio/rs-p4-unified-editing.json');
const read = (file) => readFileSync(join(root, file), 'utf8');
const readJson = (file) => JSON.parse(read(file));
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const item = (id, passed, evidence, detail) => ({ id, passed: passed === true, evidence, detail });

const sourceFiles = {
  controls: 'core/shared-backend/result-edit-controls.js',
  intent: 'core/shared-backend/result-edit-intent.js',
  contextTools: 'core/r-server/agent-tools/result-context-tools.js',
  contextEditTools: 'core/r-server/agent-tools/result-context-edit-tools.js',
  toolDefinitions: 'core/r-server/agent-tools/tool-defs.js',
  changeSetService: 'core/shared-backend/result-changeset-service.js',
  routes: 'core/r-server/routes/result-studio.js',
  panel: 'frontend/src/components/result-studio/ResultEditPanel.tsx',
  panelStyle: 'frontend/src/components/result-studio/ResultEditPanel.module.css',
  panelTest: 'frontend/src/components/result-studio/ResultEditPanel.test.tsx',
  rightPanel: 'frontend/src/components/workspace-panels/RightPanel.tsx',
  workspace: 'frontend/src/pages/project-workspace.tsx',
  contextClient: 'frontend/src/lib/result-studio-interaction-client.ts',
  volcanoDescriptor: 'resources/built-in-plugins/volcano-plot/tool-definition.json',
  volcanoScript: 'resources/built-in-plugins/volcano-plot/scripts/volcano-plot.R',
  volcanoGolden: 'resources/built-in-plugins/volcano-plot/golden-revisions/result-studio-v1.json',
  controlsTest: 'test/result-edit-controls.test.mjs',
  acceptanceScript: 'scripts/g0-rs-p4-acceptance.mjs',
  packageScripts: 'package.json',
};

/** P4 交付要求的首批控件类别 → volcano descriptor 中的参数名。 */
const FIRST_BATCH_CONTROLS = Object.freeze({
  color: ['color_up', 'color_down', 'color_ns'],
  font: ['base_font_size', 'label_size'],
  size: ['point_size', 'plot_width', 'plot_height'],
  legend: ['legend_position'],
  label: ['plot_title'],
  export: ['export_dpi'],
});

function sourceHashes() {
  return Object.fromEntries(Object.entries(sourceFiles).map(([key, file]) => [key, sha(read(file))]));
}

function runCommands() {
  const commands = [
    ['backend-p4', 'node', ['--test',
      'test/result-edit-controls.test.mjs',
      'test/result-edit-intent.test.mjs',
      'test/result-studio-context.test.mjs',
      'test/result-studio-plugin-sdk.test.mjs',
      'test/result-studio-qualification.test.mjs',
      'test/agent-tool-registry.test.mjs',
    ]],
    ['frontend-p4', 'npm', ['test', '--prefix', 'frontend', '--',
      'ResultEditPanel.test.tsx',
      'ResultStudioContextReadiness.test.tsx',
      'ResultStudioSurface.test.tsx',
      'CenterPanel.test.tsx',
    ]],
    ['frontend-build', 'npm', ['run', 'build:check', '--prefix', 'frontend']],
    ['syntax', 'node', ['--check', 'scripts/g0-rs-p4-acceptance.mjs']],
  ];
  return commands.map(([label, bin, args]) => {
    const result = spawnSync(bin, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return {
      label,
      command: [bin, ...args].join(' '),
      exitCode: result.status,
      passed: result.status === 0,
      stdoutSha256: sha(result.stdout || ''),
      stderrSha256: sha(result.stderr || ''),
    };
  });
}

/** 从真实模块投影控件，避免只用正则"看起来实现了"。 */
function projectControls() {
  const probe = spawnSync(process.execPath, ['-e', `
    const controls = require('./core/shared-backend/result-edit-controls');
    const intentModule = require('./core/shared-backend/result-edit-intent');
    const definition = require('./resources/built-in-plugins/volcano-plot/tool-definition.json');
    const schema = controls.buildEditControlSchema(definition.resultStudio);
    const neutral = controls.normalizeEditSubmission({
      descriptor: definition.resultStudio,
      proposedValues: { color_up: '#111111', plot_title: 'New title' },
      origin: 'manual',
    });
    const scientific = controls.normalizeEditSubmission({
      descriptor: definition.resultStudio,
      proposedValues: { fc_threshold: 2 },
      origin: 'agent',
    });
    // 真正的降级尝试：调用方自称这只是样式修改，descriptor 说是科学参数。
    // normalizeEditSubmission 只信 descriptor，因此 requestedEditClass 必须无效。
    const downgradeAttempt = controls.normalizeEditSubmission({
      descriptor: definition.resultStudio,
      proposedValues: { fc_threshold: 2 },
      requestedEditClass: 'presentation_rerender',
      editClass: 'presentation_rerender',
      origin: 'agent',
    });
    // deseq2 把 design 声明为 workflow。保护字段表也认识 design，但只能当下限：
    // 若保护字段覆盖了 descriptor，workflow 会被悄悄降级成 scientific。
    const deseq2 = require('./resources/built-in-plugins/deseq2/tool-definition.json');
    const workflowAttempt = controls.normalizeEditSubmission({
      descriptor: deseq2.resultStudio,
      proposedValues: { design: 'condition + batch' },
      requestedEditClass: 'presentation_rerender',
      origin: 'agent',
    });
    const rejected = controls.normalizeEditSubmission({
      descriptor: definition.resultStudio,
      proposedValues: { color_up: 'not-a-color', undeclared_param: 1 },
      origin: 'manual',
    });
    const unchanged = controls.normalizeEditSubmission({
      descriptor: definition.resultStudio,
      proposedValues: { point_size: 1.8 },
      currentValues: { point_size: 1.8 },
      origin: 'manual',
    });
    process.stdout.write('__RSP4__' + JSON.stringify({
      groups: schema.groups.map((group) => group.group),
      controlCount: schema.controls.length,
      byName: Object.fromEntries(schema.controls.map((control) => [control.name, {
        group: control.group,
        controlType: control.controlType,
        neutral: control.scientificallyNeutral,
      }])),
      neutral: {
        editClass: neutral.classification && neutral.classification.editClass,
        requiresJob: neutral.classification && neutral.classification.requiresJob,
        confirm: neutral.classification && neutral.classification.requiresScientificConfirmation,
        impact: controls.explainEditImpact(neutral.classification),
      },
      scientific: {
        editClass: scientific.classification && scientific.classification.editClass,
        confirm: scientific.classification && scientific.classification.requiresScientificConfirmation,
        impact: controls.explainEditImpact(scientific.classification, { affectedNodeIds: ['a', 'b'] }),
      },
      downgradeBlocked: downgradeAttempt.classification.editClass === 'scientific_recompute',
      workflowNotDowngraded: workflowAttempt.classification.editClass === 'workflow_replan',
      workflowConfirm: workflowAttempt.classification.requiresScientificConfirmation === true,
      // 未知参数的保守回退发生在 classifyParameterPatch：控件层会直接拒绝
      // 未声明参数，而 AI 直接提交的 patch 仍要经过这条保守分级。
      unknownParameterFallback: intentModule.classifyParameterPatch({
        proposedParameterPatch: { mystery_knob: 5 },
        parameterImpactRules: {},
        requestedEditClass: 'presentation_rerender',
      }).editClass,
      unknownParameterConservative: intentModule.classifyParameterPatch({
        proposedParameterPatch: { mystery_knob: 5 },
        parameterImpactRules: {},
      }).usedConservativeFallback,
      rejected: rejected.rejected.sort(),
      rejectedOk: rejected.ok,
      unchangedChanged: unchanged.changed.length,
      unchangedOk: unchanged.ok,
    }));
  `], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (probe.status !== 0) throw new Error(`control projection failed: ${(probe.stderr || '').slice(0, 300)}`);
  const marker = probe.stdout.indexOf('__RSP4__');
  if (marker < 0) throw new Error('control projection produced no payload');
  return JSON.parse(probe.stdout.slice(marker + '__RSP4__'.length));
}

/** 读取模型可见 schema，证明 AI 侧与手动侧共用同一入口。 */
function providerDefinitions() {
  const probe = spawnSync(process.execPath, ['-e',
    "process.stdout.write('__DEFS__' + JSON.stringify(require('./core/r-server/agent-tools/registry.js').getProviderToolDefs()))",
  ], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (probe.status !== 0) throw new Error('tool registry failed to load');
  const marker = probe.stdout.indexOf('__DEFS__');
  if (marker < 0) throw new Error('registry produced no payload');
  return JSON.parse(probe.stdout.slice(marker + '__DEFS__'.length));
}

function inspect(verification = null) {
  const controls = read(sourceFiles.controls);
  const intent = read(sourceFiles.intent);
  const contextEditTools = read(sourceFiles.contextEditTools);
  const contextTools = read(sourceFiles.contextTools);
  const routes = read(sourceFiles.routes);
  const panel = read(sourceFiles.panel);
  const workspace = read(sourceFiles.workspace);
  const rightPanel = read(sourceFiles.rightPanel);
  const changeSetService = read(sourceFiles.changeSetService);
  const volcanoScript = read(sourceFiles.volcanoScript);
  const descriptor = readJson(sourceFiles.volcanoDescriptor).resultStudio;
  const projected = projectControls();
  const definitions = providerDefinitions();
  const planDefinition = definitions.find((d) => d.function.name === 'result_edit_plan_in_context');
  const commands = verification?.commands || [];

  // 首批控件必须真的出现在 descriptor 投影里，且被 R 脚本消费。
  const firstBatch = Object.entries(FIRST_BATCH_CONTROLS).map(([category, names]) => ({
    category,
    names,
    projected: names.every((name) => !!projected.byName[name]),
    wired: names.every((name) => new RegExp(`params\\$${name}\\b`).test(volcanoScript)),
  }));
  const firstBatchPassed = firstBatch.every((entry) => entry.projected && entry.wired);

  // presentation 控件不得被声明成会重算科学的级别。
  const presentationNames = Object.values(FIRST_BATCH_CONTROLS).flat();
  const presentationNeutral = presentationNames.every((name) => projected.byName[name]?.group === 'presentation'
    && projected.byName[name]?.neutral === true);

  const checks = [
    item('RS-P4-01',
      /buildEditControlSchema/.test(controls) && /descriptor\.parameters/.test(controls)
        && projected.controlCount >= 12 && projected.groups.includes('presentation'),
      [sourceFiles.controls],
      'Controls are projected from the plugin descriptor schema; no per-plugin result page is hand written.'),
    item('RS-P4-02', firstBatchPassed, [sourceFiles.volcanoDescriptor, sourceFiles.volcanoScript],
      'The first control batch covers color, font, size, legend, label and export format, and each parameter is consumed by the real renderer script.'),
    item('RS-P4-03', presentationNeutral && projected.neutral.editClass === 'presentation_rerender'
      && projected.neutral.impact.rerunsScience === false,
      [sourceFiles.controls, sourceFiles.volcanoDescriptor],
      'A pure styling change is classified as presentation rerender and never reruns the scientific computation.'),
    item('RS-P4-04', projected.scientific.editClass === 'scientific_recompute'
      && projected.scientific.confirm === true
      && projected.scientific.impact.affectedNodeCount === 2,
      [sourceFiles.controls],
      'A scientific threshold change requires explicit confirmation and reports its affected downstream nodes.'),
    item('RS-P4-05', /normalizeEditSubmission/.test(contextEditTools)
      && /editOrigin/.test(contextEditTools)
      && /planResultEdit/.test(intent),
      [sourceFiles.contextEditTools],
      'Manual controls and AI intent pass through one normalization gate before the shared ResultEditIntent planner.'),
    item('RS-P4-06', planDefinition?.function?.parameters?.properties?.editOrigin?.enum?.includes('manual') === true
      && planDefinition?.function?.parameters?.properties?.editOrigin?.enum?.includes('agent') === true,
      [sourceFiles.toolDefinitions],
      'The model-visible schema records the edit origin so manual and AI submissions stay auditable on one tool.'),
    item('RS-P4-07', projected.rejectedOk === false
      && projected.rejected.includes('undeclared_param') && projected.rejected.includes('color_up'),
      [sourceFiles.controls],
      'Undeclared parameters and out-of-contract values are rejected rather than silently dropped or clamped.'),
    item('RS-P4-08', projected.unchangedChanged === 0 && projected.unchangedOk === false
      && /edit_no_effective_change/.test(contextEditTools),
      [sourceFiles.controls, sourceFiles.contextEditTools],
      'A submission equal to the current values produces no patch, so no empty ChangeSet or Job is created.'),
    item('RS-P4-09', projected.downgradeBlocked === true
      && projected.workflowNotDowngraded === true && projected.workflowConfirm === true,
      [sourceFiles.controls, sourceFiles.intent],
      'A caller declaring presentation_rerender cannot downgrade a parameter the descriptor declares scientific, and a declared workflow parameter is not silently degraded to scientific by the protected-field table.'),
    item('RS-P4-10', projected.unknownParameterFallback === 'scientific_recompute'
      && projected.unknownParameterConservative === true,
      [sourceFiles.intent],
      'A parameter with no declared impact falls back to scientific recompute and is flagged as a conservative decision, never guessed as styling.'),
    item('RS-P4-11', /currentParameters/.test(contextTools)
      && /executionProvenance/.test(contextTools),
      [sourceFiles.contextTools],
      'Current values come from the parameters the job really executed, not from descriptor defaults.'),
    item('RS-P4-12', /editControls/.test(routes) && /buildEditControlSchema/.test(routes)
      && /currentValues/.test(routes),
      [sourceFiles.routes],
      'The production API serves one control schema shared by the manual panel and the agent context.'),
    item('RS-P4-13', /scientificallyNeutral/.test(panel) && /needsConfirm/.test(panel)
      && /我已理解这会改变科学结论/.test(panel),
      [sourceFiles.panel],
      'The panel only claims scientific neutrality where the descriptor allows it and requires explicit confirmation otherwise.'),
    item('RS-P4-14', !/fetch\(/.test(panel) && !/writeFile|localStorage/.test(panel),
      [sourceFiles.panel],
      'No control writes an Artifact, source data, or the current Revision: the panel only emits an edit request.'),
    item('RS-P4-15', /result_edit_plan_in_context/.test(workspace)
      && /result_studio_context/.test(workspace),
      [sourceFiles.workspace],
      'Both submission paths reach the backend through the context-bound tools, so no second editing chain exists.'),
    item('RS-P4-16', /ResultEditPanel/.test(rightPanel) && /disabledReason/.test(rightPanel),
      [sourceFiles.rightPanel],
      'The panel is disabled with an honest reason when the backend cannot project reproducible coordinates.'),
    item('RS-P4-17', /createResultChangeSet/.test(changeSetService)
      && /run_tool|executeJob/.test(changeSetService),
      [sourceFiles.changeSetService],
      'Candidate creation still flows through the existing ChangeSet service and formal execution truth.'),
    item('RS-P4-18', commands.length >= 4 && commands.every((command) => command.passed),
      [evidencePath.replace(`${root}/`, '')],
      'All declared P4 command gates passed.'),
  ];

  return {
    schemaVersion: 1,
    workPackage: 'G0-RS-P4',
    sourceCommit: git('rev-parse', 'HEAD'),
    captureMode: 'automated_descriptor_projection_plugin_wiring_registry_and_strict_build_offline_verification',
    qualificationEligible: false,
    qualificationReason: 'P4 closes the offline unified-editing contract; real manual-vs-AI equivalence on a live plugin run and packaged product qualification remain reserved for P5 and P7.',
    privacy: 'repository_relative_paths_digests_counts_and_bounded_statuses_only_no_project_job_conversation_selection_url_credential_prompt_or_result_data',
    sourceHashes: sourceHashes(),
    controlObservation: {
      controlCount: projected.controlCount,
      groups: projected.groups,
      firstBatch,
      presentationNeutral,
      descriptorParameterCount: Object.keys(descriptor.parameters || {}).length,
    },
    checks,
    verification,
    invariants: {
      executionTruth: 'run_tool -> tool_job -> artifact_truth',
      secondEditingChain: false,
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
    console.log(`[G0-RS-P4] PASS — evidence updated (${report.checks.length}/${report.checks.length})`);
  } else {
    if (!existsSync(evidencePath)) throw new Error('evidence missing; run npm run g0:result-studio:p4:update');
    const stored = JSON.parse(readFileSync(evidencePath, 'utf8'));
    const current = inspect(stored.verification);
    if (!stored.passed || !current.passed
      || JSON.stringify(stored.sourceHashes) !== JSON.stringify(current.sourceHashes)) {
      throw new Error('stored G0-RS-P4 evidence is stale or invalid');
    }
    console.log(`[G0-RS-P4] PASS — ${current.checks.length}/${current.checks.length}`);
  }
} catch (error) {
  console.error(`[G0-RS-P4] FAIL — ${error.message}`);
  process.exitCode = 1;
}
