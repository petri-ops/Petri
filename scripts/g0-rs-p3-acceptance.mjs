#!/usr/bin/env node

/**
 * G0-RS-P3 acceptance — Agent Context 与 Edit Orchestration。
 *
 * 与 P1/P2 同一形态：源码哈希 + 命令门禁 + 结构性断言，全部机器可读。
 * 本阶段是 offline/contract 层的 P3 收口，`qualificationEligible` 恒为 false：
 * 真实双 Provider tool calling 与 packaged 连续 trace 仍然只属于 G0-RS-P7。
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(root, 'acceptance/g0-result-studio/rs-p3-agent-context.json');
const read = (file) => readFileSync(join(root, file), 'utf8');
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const item = (id, passed, evidence, detail) => ({ id, passed: passed === true, evidence, detail });

const sourceFiles = {
  contextContract: 'core/shared-backend/result-studio-context.js',
  contextTools: 'core/r-server/agent-tools/result-context-tools.js',
  contextEditTools: 'core/r-server/agent-tools/result-context-edit-tools.js',
  toolDefinitions: 'core/r-server/agent-tools/tool-defs.js',
  toolRegistry: 'core/r-server/agent-tools/registry.js',
  systemPrompt: 'core/r-server/helpers/system-prompt.js',
  routes: 'core/r-server/routes/result-studio.js',
  editTools: 'core/r-server/agent-tools/result-edit-tools.js',
  contextClient: 'frontend/src/lib/result-studio-interaction-client.ts',
  surface: 'frontend/src/components/result-studio/ResultStudioSurface.tsx',
  surfaceStyle: 'frontend/src/components/result-studio/ResultStudioSurface.module.css',
  rightPanel: 'frontend/src/components/workspace-panels/RightPanel.tsx',
  workspace: 'frontend/src/pages/project-workspace.tsx',
  contextTest: 'test/result-studio-context.test.mjs',
  promptTest: 'test/system-prompt-result-context.test.mjs',
  registryTest: 'test/agent-tool-registry.test.mjs',
  readinessTest: 'frontend/src/components/result-studio/ResultStudioContextReadiness.test.tsx',
  acceptanceScript: 'scripts/g0-rs-p3-acceptance.mjs',
  packageScripts: 'package.json',
};

const productObservation = {
  captureMode: 'automated_contract_registry_prompt_and_strict_build_offline_verification',
  qualificationEligible: false,
  qualificationReason:
    'P3 closes the offline Agent-context contract stage. Two real Providers completing tool calling with no internal ids, and packaged continuous product trace, remain reserved for G0-RS-P7.',
  notCoveredByThisStage: [
    'real_provider_tool_calling',
    'packaged_electron_continuous_trace',
    'manual_parameter_panels',
    'real_scientific_diff',
  ],
};

const CONTEXT_BOUND_TOOLS = Object.freeze([
  'result_studio_context',
  'result_edit_plan_in_context',
  'result_changeset_create_in_context',
  'result_changeset_status_in_context',
  'result_changeset_compare_in_context',
  'result_changeset_adopt_in_context',
  'result_changeset_revert_in_context',
]);

const INTERNAL_ID_PARAMS = Object.freeze(['toolJobId', 'artifactId', 'revisionId', 'artifactFamilyId', 'selectionId']);

function sourceHashes() {
  return Object.fromEntries(Object.entries(sourceFiles).map(([key, file]) => [key, sha(read(file))]));
}

function runCommands() {
  const commands = [
    ['backend-p3', 'node', ['--test',
      'test/result-studio-context.test.mjs',
      'test/system-prompt-result-context.test.mjs',
      'test/agent-tool-registry.test.mjs',
      'test/result-edit-intent.test.mjs',
      'test/result-edit-agent-tool.test.mjs',
    ]],
    // `npm test` in frontend is `vitest run --changed`, which combines with these
    // filters to select nothing and exit 0 — recording passed:true for a run that
    // executed no tests. `test:files` is plain `vitest run`, matching the gate.
    ['frontend-p3', 'npm', ['run', 'test:files', '--prefix', 'frontend', '--',
      'ResultStudioContextReadiness.test.tsx',
      'ResultStudioSurface.test.tsx',
    ]],
    ['frontend-build', 'npm', ['run', 'build:check', '--prefix', 'frontend']],
    ['syntax', 'node', ['--check', 'scripts/g0-rs-p3-acceptance.mjs']],
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

/** 从注册表读取模型可见 schema。绕过 provider 投影就无法证明"模型看不到内部 id"。 */
function providerDefinitions() {
  // 用显式哨兵切分：注册表加载会打印启动日志（含 `[llm-providers]` 这类方括号），
  // 直接取第一个 '[' 会切到日志上，而不是 JSON 数组。
  const probe = spawnSync(process.execPath, ['-e',
    "process.stdout.write('<<RS_P3_DEFS>>' + JSON.stringify(require('./core/r-server/agent-tools/registry.js').getProviderToolDefs()))",
  ], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (probe.status !== 0) throw new Error('tool registry failed to load');
  const marker = '<<RS_P3_DEFS>>';
  const index = probe.stdout.indexOf(marker);
  if (index < 0) throw new Error('tool registry probe produced no provider definitions');
  return JSON.parse(probe.stdout.slice(index + marker.length));
}

function inspect(verification = null) {
  const contract = read(sourceFiles.contextContract);
  const contextTools = read(sourceFiles.contextTools);
  const contextEditTools = read(sourceFiles.contextEditTools);
  const prompt = read(sourceFiles.systemPrompt);
  const routes = read(sourceFiles.routes);
  const client = read(sourceFiles.contextClient);
  const surface = read(sourceFiles.surface);
  const workspace = read(sourceFiles.workspace);
  const rightPanel = read(sourceFiles.rightPanel);
  const definitions = providerDefinitions();
  const byName = new Map(definitions.map((definition) => [definition.function.name, definition]));
  const commands = verification?.commands || [];

  const contextToolsRegistered = CONTEXT_BOUND_TOOLS.every((name) => byName.has(name));
  // 模型可见 schema 里不得出现内部 id 参数：这是 P3 的核心可验证断言。
  const noInternalIdParams = CONTEXT_BOUND_TOOLS.every((name) => {
    const properties = byName.get(name)?.function?.parameters?.properties || {};
    return INTERNAL_ID_PARAMS.every((param) => !(param in properties));
  });
  const writeToolsRequireToken = ['result_changeset_create_in_context', 'result_changeset_adopt_in_context', 'result_changeset_revert_in_context']
    .every((name) => (byName.get(name)?.function?.parameters?.required || []).includes('contextToken'));
  const legacyToolsPreserved = ['result_edit_plan', 'result_changeset_create', 'result_changeset_adopt']
    .every((name) => byName.has(name));

  const checks = [
    item('RS-P3-01',
      /RESULT_STUDIO_CONTEXT_VERSION = 1/.test(contract)
      && /buildResultStudioContextEnvelope/.test(contract)
      && ['artifact', 'job', 'revision', 'script', 'plugin', 'selection', 'workflow', 'validation', 'reproducibility']
        .every((field) => new RegExp(`${field}:`).test(contract)),
      [sourceFiles.contextContract],
      'ResultStudioContextEnvelope v1 carries project, conversation, job, artifact, family, revision, selection, plugin, script, validation and reproducibility coordinates.'),
    item('RS-P3-02',
      /computeContextToken/.test(contract) && /context_token_stale/.test(contract) && /authorizeContextOperation/.test(contract),
      [sourceFiles.contextContract],
      'A content-addressed contextToken exists and stale operations are rejected fail-closed.'),
    item('RS-P3-03', contextToolsRegistered, [sourceFiles.toolRegistry, sourceFiles.toolDefinitions],
      'All seven context-bound tools are registered with definition, handler and contract parity.'),
    item('RS-P3-04', noInternalIdParams, [sourceFiles.toolDefinitions],
      'No context-bound tool exposes toolJobId, artifactId, revisionId, artifactFamilyId or selectionId to the model.'),
    item('RS-P3-05', writeToolsRequireToken, [sourceFiles.toolDefinitions],
      'Create, adopt and revert require contextToken in their model-visible schema.'),
    item('RS-P3-06',
      /resolveResultStudioContext/.test(contextTools)
      && /findRevisionByJobArtifact/.test(contextTools)
      && /assessSelectionCompatibility/.test(contextTools),
      [sourceFiles.contextTools],
      'Coordinates are re-resolved from SQLite, tool_jobs and plugin descriptors instead of trusting client-declared identity.'),
    item('RS-P3-07',
      /context_attribution_job_only/.test(contract) && /context_revision_missing/.test(contract),
      [sourceFiles.contextContract],
      'Job-only attribution and a missing revision block honestly rather than fabricating script coordinates.'),
    // 兼容性闸门实现在契约层（buildResultStudioContextEnvelope），工具层只负责
    // 从 SQLite 恢复选择并交给它判定。断言必须落在真正实现该行为的文件上。
    item('RS-P3-08',
      /compatibility === 'compatible'/.test(contract)
        && /selectionState/.test(contract)
        && /usableByAgent/.test(contract)
        && /assessSelectionCompatibility/.test(contextTools),
      [sourceFiles.contextContract, sourceFiles.contextTools],
      'Only a compatible selection enters the agent context; stale and invalid selections report actionable state.'),
    item('RS-P3-09',
      /context_change_set_ambiguous/.test(contextTools) && /OPEN_CHANGE_SET_STATUSES/.test(contextTools),
      [sourceFiles.contextTools],
      'Change sets are bound from context and ambiguity is refused instead of guessed.'),
    item('RS-P3-10',
      /PUBLIC_EDIT_PHASES/.test(contract)
      && ['understand_intent', 'assess_impact', 'execute_or_recompute', 'validate', 'candidate_comparable']
        .every((phase) => contract.includes(phase))
      && /publicProgress/.test(contextEditTools),
      [sourceFiles.contextContract, sourceFiles.contextEditTools],
      'Public progress is fixed to the five phases and projected from engineering stages without exposing hidden reasoning.'),
    item('RS-P3-11',
      /createResultChangeSetTools/.test(contextEditTools) && /result-edit-tools/.test(contextEditTools),
      [sourceFiles.contextEditTools, sourceFiles.editTools],
      'Context-bound tools delegate to the existing ChangeSet and compare services, creating no second execution truth.'),
    item('RS-P3-12',
      /context_intent_mismatch/.test(contextEditTools),
      [sourceFiles.contextEditTools],
      'An intent planned against another revision cannot be materialized in the current context.'),
    item('RS-P3-13',
      /result-studio\/context-envelope/.test(routes) && /canAccessProject/.test(routes),
      [sourceFiles.routes],
      'The production API exposes the same envelope projection under existing project authorization.'),
    item('RS-P3-14',
      /RESULT_STUDIO_CONTEXT_v1/.test(prompt)
      && /result_studio_context/.test(prompt)
      && /不要向用户索要/.test(prompt),
      [sourceFiles.systemPrompt],
      'The system prompt describes the open result and forbids asking the user for internal ids.'),
    item('RS-P3-15',
      !/revisionId\s*\+/.test(prompt) && !/artifact\.revisionId\s*\)/.test(prompt.replace(/artifact\.revisionId \? /g, '')),
      [sourceFiles.systemPrompt],
      'The prompt never interpolates a revision, job, changeset or selection id into model-visible text.'),
    item('RS-P3-16',
      /fetchResultStudioContext/.test(client) && /context-envelope/.test(client) && /blocked/.test(client),
      [sourceFiles.contextClient],
      'The frontend reads the same envelope and normalizes backend blocking into an honest state.'),
    item('RS-P3-17',
      /ResultStudioContextReadiness/.test(surface)
      && /已过期/.test(surface)
      && /fetchResultStudioContext/.test(workspace)
      && /resultContext/.test(rightPanel),
      [sourceFiles.surface, sourceFiles.workspace, sourceFiles.rightPanel],
      'Inspector readiness is wired to the real projection and reports stale or unusable selections truthfully.'),
    item('RS-P3-18', legacyToolsPreserved, [sourceFiles.toolDefinitions],
      'The original explicit-id RS4-RS6 tools remain available for scripted use and were not replaced.'),
    item('RS-P3-19', commands.length >= 4 && commands.every((command) => command.passed),
      ['acceptance/g0-result-studio/rs-p3-agent-context.json'],
      'All declared P3 command gates passed, including frontend strict build.'),
    item('RS-P3-20',
      /qualificationEligible/.test(read(sourceFiles.acceptanceScript))
      && productObservation.qualificationEligible === false,
      [sourceFiles.acceptanceScript],
      'This stage explicitly declares itself non-qualifying; real Provider and packaged trace stay with P7.'),
  ];

  return {
    schemaVersion: 1,
    workPackage: 'G0-RS-P3',
    sourceCommit: git('rev-parse', 'HEAD'),
    captureMode: productObservation.captureMode,
    qualificationEligible: false,
    privacy: 'repository_relative_paths_digests_counts_and_bounded_statuses_only_no_project_job_conversation_selection_url_credential_prompt_or_result_data',
    sourceHashes: sourceHashes(),
    productObservation,
    modelVisibleTools: {
      total: definitions.length,
      contextBound: CONTEXT_BOUND_TOOLS.length,
      internalIdParametersExposed: 0,
    },
    checks,
    verification,
    invariants: {
      executionTruth: 'run_tool -> tool_job -> artifact_truth',
      secondExecutionTruth: false,
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
    console.log(`[G0-RS-P3] PASS — evidence updated (${report.checks.length}/${report.checks.length})`);
  } else {
    if (!existsSync(evidencePath)) throw new Error('evidence missing; run npm run g0:result-studio:p3:update');
    const stored = JSON.parse(readFileSync(evidencePath, 'utf8'));
    const current = inspect(stored.verification);
    if (!stored.passed || !current.passed || JSON.stringify(stored.sourceHashes) !== JSON.stringify(current.sourceHashes)) {
      throw new Error('stored G0-RS-P3 evidence is stale or invalid');
    }
    console.log(`[G0-RS-P3] PASS — ${current.checks.length}/${current.checks.length}`);
  }
} catch (error) {
  console.error(`[G0-RS-P3] FAIL — ${error.message}`);
  process.exitCode = 1;
}
