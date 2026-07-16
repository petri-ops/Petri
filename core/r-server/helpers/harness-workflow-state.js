const WORKFLOW_STAGE_IDS = [
  'inspect',
  'infer',
  'select',
  'repair',
  'confirm',
  'run',
  'verify',
  'report',
];

function parseJsonMaybe(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stageMap(initial = 'pending') {
  return new Map(WORKFLOW_STAGE_IDS.map((id) => [id, { id, status: initial }]));
}

function setStages(stages, ids, status, detail = null) {
  for (const id of ids) {
    stages.set(id, { id, status, ...(detail ? { detail } : {}) });
  }
}

function firstIncompleteStage(stages) {
  return WORKFLOW_STAGE_IDS.find((id) => stages.get(id)?.status !== 'completed') || null;
}

function recoveryActions({ stages, ackStatus, truth, status }) {
  const actions = [];
  const add = (id, label, stage) => actions.push({ id, label, stage });
  if (ackStatus === 'pending') add('confirm_params', '确认参数后继续', 'confirm');
  if (['pending', 'queued'].includes(status)) add('wait_for_run', '等待任务开始', 'run');
  if (stages.get('run')?.status === 'failed') add('retry_run', '修复运行错误后重试', 'run');
  if (stages.get('verify')?.detail === 'artifact_truth_pending') {
    add('reconcile_artifacts', '重新校验结果产物', 'verify');
  }
  if (truth?.status === 'blocked') add('repair_artifacts', '修复缺失或异常产物后重试', 'verify');
  if (truth?.status === 'degraded') add('review_artifacts', '检查降级产物与诊断', 'verify');
  return actions;
}

function projectHarnessWorkflowJob(job = {}) {
  const stages = stageMap();
  const status = String(job.status || 'pending').toLowerCase();
  const result = parseJsonMaybe(job.result || job.result_json) || {};
  const truth = result.artifactTruth || null;
  const diagnostics = Array.isArray(result.artifactDiagnostics) ? result.artifactDiagnostics : [];
  const artifacts = Array.isArray(result.artifacts)
    ? result.artifacts
    : Array.isArray(result.files)
      ? result.files
      : [];
  const params = parseJsonMaybe(job.params || job.params_json) || {};
  const recoveryHistory = Array.isArray(params.__harnessRecovery) ? params.__harnessRecovery : [];
  const ackStatus = job.ack_status || job.ackStatus || null;
  const preRunStages = ['inspect', 'infer', 'select', 'repair'];
  setStages(stages, preRunStages, 'completed');

  if (ackStatus === 'pending') {
    stages.set('confirm', { id: 'confirm', status: 'pending', detail: 'waiting_for_user' });
    setStages(stages, ['run', 'verify', 'report'], 'blocked', 'waiting_for_confirmation');
  } else if (ackStatus === 'rejected') {
    stages.set('confirm', { id: 'confirm', status: 'cancelled', detail: 'rejected_by_user' });
    setStages(stages, ['run', 'verify', 'report'], 'cancelled', 'rejected_by_user');
  } else {
    stages.set('confirm', { id: 'confirm', status: 'completed' });

    if (['pending', 'queued'].includes(status)) {
      stages.set('run', { id: 'run', status: 'pending', detail: status });
    } else if (status === 'running') {
      stages.set('run', { id: 'run', status: 'in_progress' });
    } else if (status === 'cancelled') {
      stages.set('run', { id: 'run', status: 'cancelled', detail: job.error || null });
      setStages(stages, ['verify', 'report'], 'cancelled');
    } else if (status === 'failed') {
      if (truth?.status === 'blocked') {
        stages.set('run', { id: 'run', status: 'completed' });
        stages.set('verify', { id: 'verify', status: 'failed', detail: 'artifact_truth_blocked' });
        stages.set('report', { id: 'report', status: 'blocked', detail: 'artifact_truth_blocked' });
      } else {
        stages.set('run', { id: 'run', status: 'failed', detail: job.error || 'execution_failed' });
        setStages(stages, ['verify', 'report'], 'blocked', 'execution_failed');
      }
    } else if (status === 'completed') {
      stages.set('run', { id: 'run', status: 'completed' });
      if (!truth) {
        stages.set('verify', { id: 'verify', status: 'pending', detail: 'artifact_truth_pending' });
        stages.set('report', { id: 'report', status: 'blocked', detail: 'artifact_truth_pending' });
      } else if (truth.status === 'blocked' || truth.blocking === true) {
        stages.set('verify', { id: 'verify', status: 'failed', detail: 'artifact_truth_blocked' });
        stages.set('report', { id: 'report', status: 'blocked', detail: 'artifact_truth_blocked' });
      } else if (truth.status === 'degraded') {
        stages.set('verify', { id: 'verify', status: 'needs_review', detail: 'artifact_truth_degraded' });
        stages.set('report', {
          id: 'report',
          status: artifacts.length > 0 ? 'completed' : 'blocked',
          detail: 'artifact_truth_degraded',
        });
      } else {
        stages.set('verify', { id: 'verify', status: 'completed' });
        stages.set('report', {
          id: 'report',
          status: artifacts.length > 0 ? 'completed' : 'blocked',
          detail: artifacts.length > 0 ? null : 'no_verified_artifacts',
        });
      }
    }
  }

  const stageList = WORKFLOW_STAGE_IDS.map((id) => stages.get(id));
  const terminal = ['completed', 'failed', 'cancelled'].includes(status) &&
    !stageList.some((stage) => ['pending', 'in_progress'].includes(stage.status));
  const recoverable =
    truth?.status === 'degraded' ||
    truth?.status === 'blocked' ||
    diagnostics.some((issue) => issue && issue.recoverable !== false);
  const nextActions = recoveryActions({ stages, ackStatus, truth, status });

  return {
    harnessWorkflowStateVersion: 1,
    jobId: job.id || null,
    toolId: job.tool_id || job.toolId || null,
    jobStatus: status,
    ackStatus,
    terminal,
    recoverable,
    resumeFrom: firstIncompleteStage(stages),
    artifactTruth: truth,
    artifactDiagnostics: diagnostics,
    artifactCount: artifacts.length,
    error: job.error || null,
    recoveryHistory,
    nextActions,
    stages: stageList,
  };
}

module.exports = {
  WORKFLOW_STAGE_IDS,
  projectHarnessWorkflowJob,
};
