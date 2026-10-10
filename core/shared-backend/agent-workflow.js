const AGENT_WORKFLOW_TEMPLATE_VERSION = 1;
const { isRegisteredProfile } = require('./artifact-profiles');

// A-003 configure inject: harness-workflow-state is injected at bootstrap time,
// not required at load time. This breaks the shared-backend → petri-server reverse require.
let _projectHarnessWorkflowJob = null;
function configure(opts) {
  if (opts && opts.projectHarnessWorkflowJob) {
    _projectHarnessWorkflowJob = opts.projectHarnessWorkflowJob;
  }
}

// ---------------------------------------------------------------------------
// Phase 6 — Multi-step Agent Workflow Runtime
// Pure functions: state projection from plan + real tool jobs.
// No database writes; no executors added.
// ---------------------------------------------------------------------------

// Step-level statuses tracked through the workflow lifecycle.
const STEP_STATUSES = /** @type {const} */ ([
  'waiting_for_dependency',
  'ready',
  'waiting_for_confirmation',
  'queued',
  'running',
  'recoverable',
  'blocked',
  'complete',
  'cancelled',
]);

// Parse result_json (string) or result (object) — mirrors harness-workflow-state.js.
function _parseResult(job) {
  if (!job) return {};
  const raw = job.result_json || job.result || null;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Map a harness-style job status to a step status.
function _stepStatusFromJob(job) {
  if (!job) return 'waiting_for_dependency';
  const s = (job.status || '').toLowerCase();
  const ack = (job.ack_status || '').toLowerCase();
  if (ack === 'rejected' || s === 'cancelled') return 'cancelled';
  if (ack === 'pending') return 'waiting_for_confirmation';
  if (s === 'running') return 'running';
  if (s === 'queued' || s === 'pending') return 'queued';
  if (s === 'blocked') return 'blocked';
  if (s === 'failed') {
    const result = _parseResult(job);
    const truth = result.artifactTruth || null;
    const diag = Array.isArray(result.artifactDiagnostics) ? result.artifactDiagnostics : [];
    if (truth?.status === 'degraded' || diag.some((d) => d && d.recoverable === true)) {
      return 'recoverable';
    }
    return 'blocked';
  }
  if (s === 'completed') {
    const result = _parseResult(job);
    const truth = result.artifactTruth || null;
    if (!truth) return 'recoverable';
    if (truth.status === 'valid') return 'complete';
    if (truth.status === 'degraded') return 'recoverable';
    if (truth.status === 'blocked' || truth.blocking === true) return 'blocked';
    return 'complete';
  }
  return 'waiting_for_dependency';
}

// ---------------------------------------------------------------------------
// projectStepStatuses — project each step's status from real tool jobs.
// Matches by job.stepId / job._stepId first, then by array index as fallback.
// @param {Array}  steps        - plan.steps
// @param {Array}  toolJobs     - harness-workflow-state compatible job rows
// @returns {Array} steps with updated status / toolJobId / taskId fields.
// ---------------------------------------------------------------------------
// projectStepStatuses — project each step's status from real tool jobs.
// Matches by job.stepId / job._stepId field.  Callers in tests should set
// stepId on jobs; production calls from learning.js use runToolJobs which
// populates _stepId automatically.
// @param {Array}  steps        - plan.steps
// @param {Array}  toolJobs     - harness-workflow-state compatible job rows
// @returns {Array} steps with updated status / toolJobId / taskId fields.
// ---------------------------------------------------------------------------
function projectStepStatuses(steps, toolJobs = []) {
  const byStepId = new Map((toolJobs || []).map((j) => [j.stepId || j._stepId || null, j]));
  return (steps || []).map((step) => {
    const job = byStepId.get(step.id) || null;
    const status = job ? _stepStatusFromJob(job) : step.status;
    return {
      ...step,
      status,
      toolJobId: job ? job.id || job.toolJobId || null : step.toolJobId,
      taskId: job ? job.task_id || job.taskId || null : step.taskId,
    };
  });
}

// ---------------------------------------------------------------------------
// projectWorkflowPlan — full projection of workflow plan status from real jobs.
// @param {Object} plan               - workflow plan
// @param {Array}  toolJobs           - tool job rows (must include stepId / _stepId)
// @returns {Object} projected plan with status / terminal / recoverable / readyStepIds
// ---------------------------------------------------------------------------
function projectWorkflowPlan(plan, toolJobs = []) {
  if (!plan || plan.agentWorkflowPlanVersion !== 1) return plan;

  const projectedSteps = projectStepStatuses(plan.steps, toolJobs);
  const jobByStepId = new Map((toolJobs || []).map((j) => [j.stepId || j._stepId || null, j]));

  // Compute which steps are currently "ready" (dependencies satisfied, not blocked).
  const completedSet = new Set(
    projectedSteps.filter((s) => s.status === 'complete').map((s) => s.id)
  );
  const readyStepIds = projectedSteps
    .filter((step) => {
      if (['complete', 'cancelled', 'blocked', 'recoverable', 'running'].includes(step.status))
        return false;
      // Step is ready if its dependencies are satisfied and it has a tool assigned.
      // Include waiting_for_dependency (no job yet), ready (inputs bound), queued (job waiting).
      const waitingForDep =
        step.status === 'waiting_for_dependency' ||
        step.status === 'ready' ||
        step.status === 'queued';
      return waitingForDep && step.dependsOn.every((dep) => completedSet.has(dep));
    })
    .map((s) => s.id);

  // Terminal: all non-cancelled steps are done.
  const terminal =
    !['cancelled', 'recoverable', 'blocked', 'waiting_for_confirmation'].some((s) =>
      projectedSteps.some((st) => st.status === s)
    ) && projectedSteps.every((s) => ['complete', 'cancelled'].includes(s.status));

  // Recoverable: any step or job is recoverable.
  const recoverable = projectedSteps.some(
    (s) => s.status === 'recoverable' || jobByStepId.get(s.id)?.recoverable === true
  );

  // Resume from: first incomplete non-terminal step.
  const resumeFromStepId =
    projectedSteps.find(
      (s) => !['complete', 'cancelled', 'waiting_for_confirmation'].includes(s.status)
    )?.id || null;

  // Plan-level status.
  let status = 'active';
  if (terminal && !recoverable) status = 'complete';
  else if (projectedSteps.some((s) => s.status === 'cancelled')) status = 'cancelled';
  else if (projectedSteps.every((s) => ['complete', 'ready', 'blocked'].includes(s.status))) {
    status = 'blocked';
  }

  // nextActions: actions derived from step states.
  const nextActions = [];
  for (const step of projectedSteps) {
    if (step.status === 'waiting_for_confirmation') {
      nextActions.push({
        id: `confirm_${step.id}`,
        stepId: step.id,
        label: `确认 ${step.id} 后继续`,
        stage: 'confirm',
      });
    }
    if (step.status === 'recoverable') {
      nextActions.push({
        id: `recover_${step.id}`,
        stepId: step.id,
        label: `修复 ${step.id} 后重试`,
        stage: 'run',
      });
    }
    if (step.status === 'blocked' && step.dependsOn.length > 0) {
      nextActions.push({
        id: `unblock_${step.id}`,
        stepId: step.id,
        label: `解除 ${step.id} 阻塞`,
        stage: 'run',
      });
    }
  }

  return {
    ...plan,
    steps: projectedSteps,
    status,
    terminal,
    recoverable,
    readyStepIds,
    resumeFromStepId,
    nextActions,
  };
}

// ---------------------------------------------------------------------------
// validateLineageEntry — guard that a lineage entry is valid.
// Returns { ok, error }
function validateLineageEntry(entry, plan) {
  if (!entry || typeof entry !== 'object') return { ok: false, error: 'invalid_entry' };
  if (entry.artifactTruthStatus !== 'valid') return { ok: false, error: 'artifact_not_verified' };
  if (!entry.artifactPath) return { ok: false, error: 'artifact_location_missing' };

  const fromStep = (plan.steps || []).find((s) => s.id === entry.fromStepId);
  if (!fromStep) return { ok: false, error: 'workflow_step_not_found' };
  if (fromStep.toolJobId && fromStep.toolJobId !== entry.fromToolJobId) {
    return { ok: false, error: 'artifact_job_mismatch' };
  }

  const toStep = (plan.steps || []).find((s) => s.id === entry.toStepId);
  if (!toStep) return { ok: false, error: 'workflow_step_not_found' };

  const binding = (toStep.inputBindings || []).find((b) => b.inputId === entry.inputId);
  if (!binding) return { ok: false, error: 'workflow_dependency_mismatch' };

  if (binding.artifactType && entry.artifactType && binding.artifactType !== entry.artifactType) {
    return { ok: false, error: 'artifact_type_mismatch' };
  }

  // HLE-C5R: If binding declares artifactProfile, verify artifact matches it.
  if (binding.artifactProfile && entry.artifactProfile && binding.artifactProfile !== entry.artifactProfile) {
    return { ok: false, error: 'artifact_profile_mismatch' };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// bindVerifiedArtifact — bind a verified artifact to a plan (idempotent).
// Validation: artifactTruth must be valid, belongs to source job, type matches.
// Duplicate bind (same fromStepId + toStepId + inputId) is idempotent.
// ---------------------------------------------------------------------------
function bindVerifiedArtifact(plan, { fromStepId, toStepId, inputId, artifact, artifactTruth }) {
  if (!plan || plan.agentWorkflowPlanVersion !== 1) throw new Error('invalid_agent_workflow_plan');
  if (!artifactTruth || artifactTruth.status !== 'valid') throw new Error('artifact_not_verified');
  const fromStep = plan.steps.find((step) => step.id === fromStepId);
  const toStep = plan.steps.find((step) => step.id === toStepId);
  if (!fromStep || !toStep) throw new Error('workflow_step_not_found');
  if (!toStep.dependsOn.includes(fromStepId)) throw new Error('workflow_dependency_mismatch');
  const value = artifact?.canonicalPath || artifact?.path || artifact?.url;
  if (!value) throw new Error('artifact_location_missing');

  const binding = (toStep.inputBindings || []).find((item) => item.inputId === inputId);
  if (!binding || binding.fromStepId !== fromStepId)
    throw new Error('workflow_dependency_mismatch');
  const effectiveProfile = binding.artifactProfile || artifact?.artifactProfile || null;
  if (effectiveProfile && !isRegisteredProfile(effectiveProfile)) {
    throw new Error(`unregistered_artifact_profile:${effectiveProfile}`);
  }
  if (binding.artifactType && artifact?.type && binding.artifactType !== artifact.type) {
    throw new Error('artifact_type_mismatch');
  }
  const lineageEntry = {
    lineageVersion: 1,
    fromStepId,
    fromToolJobId: fromStep.toolJobId,
    artifactId: artifact.id || null,
    artifactName: artifact.name || artifact.filename || null,
    artifactPath: value,
    artifactType: artifact.type || null,
    artifactProfile: binding.artifactProfile || artifact.artifactProfile || null,
    artifactTruthStatus: artifactTruth.status,
    toStepId,
    inputId,
  };

  // Idempotent: if entry for same (fromStepId, toStepId, inputId) already exists, skip.
  const existingIdx = (plan.lineage || []).findIndex(
    (e) => e.fromStepId === fromStepId && e.toStepId === toStepId && e.inputId === inputId
  );

  let lineage;
  if (existingIdx >= 0) {
    // Replace existing entry (idempotent re-bind).
    lineage = (plan.lineage || []).map((e, i) => (i === existingIdx ? lineageEntry : e));
  } else {
    lineage = [...(plan.lineage || []), lineageEntry];
  }

  // Mark step as ready if all its inputs are now bound.
  const newInputs = { ...toStep.inputs, [inputId]: value };
  const allInputsBound = (toStep.inputBindings || []).every((b) => !!newInputs[b.inputId]);
  return {
    ...plan,
    steps: plan.steps.map((step) =>
      step.id === toStepId
        ? { ...step, inputs: newInputs, status: allInputsBound ? 'ready' : step.status }
        : step
    ),
    lineage,
  };
}

// ---------------------------------------------------------------------------
// runToolJobs — collect tool jobs for the workflow's steps from the DB.
// @param {Object} plan                - workflow plan
// @param {Function} getToolJobFn       - db.getToolJob (synchronous)
// @returns {Array} tool job rows enriched with harness state + _stepId
// ---------------------------------------------------------------------------
function runToolJobs(plan, getToolJobFn) {
  if (!getToolJobFn || typeof getToolJobFn !== 'function') return [];
  return (plan.steps || [])
    .filter((step) => !!step.toolJobId)
    .map((step) => {
      const job = getToolJobFn(step.toolJobId);
      if (!job) return null;
      const enriched = { ...job, _stepId: step.id };
      // Attach harness workflow state if available.
      if (typeof _projectHarnessWorkflowJob === 'function') {
        enriched.harnessState = _projectHarnessWorkflowJob(job);
      }
      return enriched;
    })
    .filter(Boolean);
}

// End Phase 6 state machine.
// ---------------------------------------------------------------------------

const AGENT_WORKFLOW_TEMPLATES = [
  {
    id: 'bulk-rna-core',
    title: 'Bulk RNA 标准分析',
    description: 'DESeq2 差异分析 → DEG 标准化 → 火山图 + 功能富集。',
    steps: [
      { id: 'differential', toolCandidates: ['deseq2'], dependsOn: [] },
      {
        id: 'deg-standardization',
        toolCandidates: ['deg-standardizer'],
        dependsOn: ['differential'],
        inputBindings: [
          {
            inputId: 'deg_results',
            fromStepId: 'differential',
            artifactType: 'table',
            artifactProfile: 'petri.deg.v1',
            description: 'DESeq2 deg_table.csv → canonical DEG artifact',
          },
        ],
      },
      {
        id: 'volcano',
        toolCandidates: ['volcano-plot'],
        dependsOn: ['deg-standardization'],
        inputBindings: [
          {
            inputId: 'deg_table',
            fromStepId: 'deg-standardization',
            artifactType: 'table',
            artifactProfile: 'petri.deg.v1',
            description: 'deg-standardizer deg_standardized.csv (canonical)',
          },
        ],
      },
      {
        id: 'enrichment',
        toolCandidates: ['go-kegg', 'gsea'],
        dependsOn: ['deg-standardization'],
        inputBindings: [
          {
            inputId: 'deg_table',
            fromStepId: 'deg-standardization',
            artifactType: 'table',
            artifactProfile: 'petri.deg.v1',
            description: 'deg-standardizer ranked_genes.csv (full ranked list for GSEA)',
          },
        ],
      },
    ],
  },
  {
    id: 'deg-result-refinement',
    title: '差异结果二次分析',
    description: '从已有 DEG artifact 生成火山图并开展功能富集。',
    steps: [
      { id: 'volcano', toolCandidates: ['volcano-plot'], dependsOn: [] },
      { id: 'enrichment', toolCandidates: ['go-kegg', 'gsea'], dependsOn: [] },
    ],
  },
  {
    id: 'coexpression-network',
    title: '共表达网络分析',
    description: 'WGCNA 从表达矩阵构建共表达网络、识别模块并做模块-性状关联，再对模块基因做功能富集。',
    steps: [
      { id: 'coexpression', toolCandidates: ['wgcna'], dependsOn: [] },
      {
        id: 'enrichment',
        toolCandidates: ['go-kegg', 'gsea'],
        dependsOn: ['coexpression'],
        inputBindings: [
          { inputId: 'deg_table', fromStepId: 'coexpression', artifactType: 'table' },
        ],
      },
    ],
  },
];

function listAgentWorkflowTemplates(availableToolIds = []) {
  const available = new Set(availableToolIds);
  return AGENT_WORKFLOW_TEMPLATES.map((template) => {
    const supported = template.steps.filter((step) =>
      step.toolCandidates.some((toolId) => available.has(toolId))
    ).length;
    return {
      id: template.id,
      title: template.title,
      description: template.description,
      stepCount: template.steps.length,
      supportedStepCount: supported,
      available: supported === template.steps.length,
    };
  });
}

function createAgentWorkflowPlan({ templateId, availableToolIds = [], initialInputs = {} } = {}) {
  const template = AGENT_WORKFLOW_TEMPLATES.find((item) => item.id === templateId);
  if (!template) throw new Error(`unknown_workflow_template: ${templateId}`);
  const available = new Set(availableToolIds);
  const steps = template.steps.map((step) => {
    const toolId = step.toolCandidates.find((candidate) => available.has(candidate)) || null;
    return {
      id: step.id,
      toolId,
      toolCandidates: [...step.toolCandidates],
      dependsOn: [...step.dependsOn],
      inputBindings: (step.inputBindings || []).map((binding) => ({ ...binding })),
      inputs: step.dependsOn.length === 0 ? { ...initialInputs } : {},
      status: toolId ? (step.dependsOn.length === 0 ? 'ready' : 'waiting_for_artifact') : 'blocked',
      blockedReason: toolId ? null : 'tool_not_available',
      toolJobId: null,
      taskId: null,
    };
  });
  return {
    agentWorkflowPlanVersion: 1,
    templateVersion: AGENT_WORKFLOW_TEMPLATE_VERSION,
    templateId: template.id,
    title: template.title,
    executionPolicy: 'agent_led_existing_tools',
    autoExecute: false,
    status: steps.some((step) => step.status === 'blocked') ? 'blocked' : 'ready',
    steps,
    lineage: [],
  };
}

// ---------------------------------------------------------------------------
// validateWorkflowPlanBindings — structural validation of a workflow plan.
// Checks: inputBindings reference valid steps, no cycles, artifactProfile compatibility.
// @param {Object} plan
// @returns {object} { valid, errors, warnings }
// ---------------------------------------------------------------------------
function validateWorkflowPlanBindings(plan) {
  if (!plan || plan.agentWorkflowPlanVersion !== 1) {
    return { valid: false, errors: ['invalid_agent_workflow_plan'], warnings: [] };
  }
  const errors = [];
  const warnings = [];
  const stepIds = new Set((plan.steps || []).map((s) => s.id));

  for (const step of (plan.steps || [])) {
    // Check dependsOn references
    for (const dep of (step.dependsOn || [])) {
      if (!stepIds.has(dep)) {
        errors.push(`Step '${step.id}': dependsOn references unknown step '${dep}'`);
      }
    }
    // Check inputBindings references
    for (const binding of (step.inputBindings || [])) {
      if (!stepIds.has(binding.fromStepId)) {
        errors.push(`Step '${step.id}': inputBinding fromStepId '${binding.fromStepId}' references unknown step`);
      }
      if (binding.artifactProfile) {
        if (!isRegisteredProfile(binding.artifactProfile)) {
          errors.push(
            `Step '${step.id}' input '${binding.inputId}': unregistered_artifact_profile '${binding.artifactProfile}'`
          );
        } else {
          // Runtime artifact truth remains authoritative for the concrete file.
          warnings.push(
            `Step '${step.id}' input '${binding.inputId}': artifactProfile '${binding.artifactProfile}' registered; runtime artifact-truth validation will confirm compatibility`
          );
        }
      }
    }
  }

  // Cycle detection (simple DFS)
  const visited = new Set();
  const stack = new Set();
  const hasCycle = (stepId, visiting) => {
    if (stack.has(stepId)) return true;
    if (visited.has(stepId)) return false;
    stack.add(stepId);
    const step = (plan.steps || []).find((s) => s.id === stepId);
    if (step) {
      for (const dep of (step.dependsOn || [])) {
        if (hasCycle(dep, visiting)) return true;
      }
    }
    stack.delete(stepId);
    visited.add(stepId);
    return false;
  };
  for (const step of (plan.steps || [])) {
    if (hasCycle(step.id, new Set())) {
      errors.push(`Workflow plan contains a cycle`);
      break;
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = {
  configure,
  AGENT_WORKFLOW_TEMPLATE_VERSION,
  AGENT_WORKFLOW_TEMPLATES,
  STEP_STATUSES,
  listAgentWorkflowTemplates,
  createAgentWorkflowPlan,
  bindVerifiedArtifact,
  projectStepStatuses,
  projectWorkflowPlan,
  validateLineageEntry,
  validateWorkflowPlanBindings,
  runToolJobs,
};
