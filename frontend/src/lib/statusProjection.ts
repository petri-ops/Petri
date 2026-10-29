/**
 * NEXT-02A — 执行 / 证据 / 能力三轴状态投影。
 *
 * 原始后端词表保留在 `raw`；UI 只按轴消费统一 status/label/tone。
 * 未识别状态必须显示为 unknown，禁止默认成 completed/waiting。
 */

export type ExecutionStatus =
  | 'draft'
  | 'running'
  | 'waiting'
  | 'partial'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export type EvidenceStatus = 'verified' | 'unverified' | 'stale' | 'unknown';

type CapabilityStatus = 'ready' | 'degraded' | 'unavailable' | 'disabled' | 'unknown';

type StatusTone = 'neutral' | 'running' | 'success' | 'warning' | 'danger' | 'muted';

export interface AxisProjection<TStatus extends string> {
  axis: 'execution' | 'evidence' | 'capability';
  status: TStatus;
  label: string;
  tone: StatusTone;
  detail?: string;
  raw?: string;
}

export interface ComposedTrustStatus {
  execution: AxisProjection<ExecutionStatus> | null;
  evidence: AxisProjection<EvidenceStatus> | null;
  capability: AxisProjection<CapabilityStatus> | null;
}

const EXECUTION_BY_RAW: Record<string, ExecutionStatus> = {
  draft: 'draft',
  pending: 'waiting',
  queued: 'waiting',
  waiting: 'waiting',
  awaiting_confirmation: 'waiting',
  retry_pending: 'waiting',
  running: 'running',
  in_progress: 'running',
  partial: 'partial',
  completed: 'completed',
  complete: 'completed',
  done: 'completed',
  success: 'completed',
  failed: 'failed',
  error: 'failed',
  denied: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  stopped: 'cancelled',
};

const EXECUTION_LABEL: Record<ExecutionStatus, string> = {
  draft: '草稿',
  running: '运行中',
  waiting: '等待中',
  partial: '部分完成',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  unknown: '未知状态',
};

const EXECUTION_RAW_LABEL: Record<string, string> = {
  pending: '排队中',
  queued: '排队中',
  awaiting_confirmation: '等待确认',
  retry_pending: '等待重试',
  denied: '已拒绝',
  stopped: '已停止',
};

const EXECUTION_TONE: Record<ExecutionStatus, StatusTone> = {
  draft: 'muted',
  running: 'running',
  waiting: 'warning',
  partial: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'muted',
  unknown: 'neutral',
};

const EVIDENCE_BY_RAW: Record<string, EvidenceStatus> = {
  valid: 'verified',
  verified: 'verified',
  degraded: 'unverified',
  blocked: 'unverified',
  unverified: 'unverified',
  stale: 'stale',
};

const EVIDENCE_LABEL: Record<EvidenceStatus, string> = {
  verified: '已核验',
  unverified: '尚未核验',
  stale: '证据已过期',
  unknown: '证据状态未知',
};

const EVIDENCE_TONE: Record<EvidenceStatus, StatusTone> = {
  verified: 'success',
  unverified: 'warning',
  stale: 'warning',
  unknown: 'neutral',
};

const CAPABILITY_BY_RAW: Record<string, CapabilityStatus> = {
  ready: 'ready',
  available: 'ready',
  degraded: 'degraded',
  unavailable: 'unavailable',
  disabled: 'disabled',
};

const CAPABILITY_LABEL: Record<CapabilityStatus, string> = {
  ready: '可用',
  degraded: '降级',
  unavailable: '不可用',
  disabled: '已停用',
  unknown: '状态未知',
};

const CAPABILITY_TONE: Record<CapabilityStatus, StatusTone> = {
  ready: 'success',
  degraded: 'warning',
  unavailable: 'danger',
  disabled: 'muted',
  unknown: 'neutral',
};

function normalizeRaw(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function projectExecutionAxis(rawStatus: string | null | undefined): AxisProjection<ExecutionStatus> | null {
  const raw = normalizeRaw(rawStatus);
  if (!raw) return null;
  const status = EXECUTION_BY_RAW[raw] ?? 'unknown';
  return {
    axis: 'execution',
    status,
    label: EXECUTION_RAW_LABEL[raw] || EXECUTION_LABEL[status],
    tone: EXECUTION_TONE[status],
    detail: status === 'unknown' ? `未识别的执行状态：${rawStatus}` : undefined,
    raw,
  };
}

export function projectEvidenceAxis(input: {
  truthStatus?: string | null;
  hasEvidence: boolean;
  jobStatus?: string | null;
}): AxisProjection<EvidenceStatus> | null {
  if (!input.hasEvidence) return null;
  const raw = normalizeRaw(input.truthStatus);
  if (!raw) {
    const job = normalizeRaw(input.jobStatus);
    if (job === 'running') {
      return {
        axis: 'evidence',
        status: 'unverified',
        label: '正在生成',
        tone: 'running',
        detail: '结果生成中，尚无可核验产物。',
      };
    }
    if (job === 'pending') {
      return {
        axis: 'evidence',
        status: 'unverified',
        label: '等待运行',
        tone: 'warning',
        detail: '任务尚未运行，尚无证据。',
      };
    }
    return {
      axis: 'evidence',
      status: 'unverified',
      label: EVIDENCE_LABEL.unverified,
      tone: EVIDENCE_TONE.unverified,
      detail: '尚未做过真值核验：当前内容属未验证状态，不要当成可信结论。',
    };
  }

  const status = EVIDENCE_BY_RAW[raw] ?? 'unknown';
  if (raw === 'valid' || raw === 'verified') {
    return {
      axis: 'evidence',
      status,
      label: '已核验（未篡改）',
      tone: EVIDENCE_TONE[status],
      detail: '核验范围=产物的完整性与来源一致性（artifact-truth）；不代表科学结论正确，也不代表 Result Studio 整体已验证（当前仍为实验性 / 未整体验证）。',
      raw,
    };
  }
  if (status === 'unverified' && raw === 'degraded') {
    return {
      axis: 'evidence',
      status,
      label: '需要复核',
      tone: EVIDENCE_TONE[status],
      detail: '产物核验未通过或有降级项：请对照来源与证据人工复核。',
      raw,
    };
  }
  if (status === 'unverified' && raw === 'blocked') {
    return {
      axis: 'evidence',
      status,
      label: '结果已阻断',
      tone: 'danger',
      detail: '产物被真值门阻断（不可作为结论使用），请查看诊断。',
      raw,
    };
  }
  if (status === 'stale') {
    return {
      axis: 'evidence',
      status,
      label: EVIDENCE_LABEL.stale,
      tone: EVIDENCE_TONE.stale,
      detail: '证据与当前产物版本或输入不再一致，需要重新核验。',
      raw,
    };
  }
  return {
    axis: 'evidence',
    status,
    label: EVIDENCE_LABEL[status],
    tone: EVIDENCE_TONE[status],
    detail: status === 'unknown' ? `未识别的证据状态：${raw}` : undefined,
    raw,
  };
}

export function projectCapabilityAxis(
  rawStatus: string | null | undefined,
): AxisProjection<CapabilityStatus> | null {
  const raw = normalizeRaw(rawStatus);
  if (!raw) return null;
  const status = CAPABILITY_BY_RAW[raw] ?? 'unknown';
  return {
    axis: 'capability',
    status,
    label: CAPABILITY_LABEL[status],
    tone: CAPABILITY_TONE[status],
    detail: status === 'unknown' ? `未识别能力状态：${raw}` : undefined,
    raw,
  };
}

export function composeTrustStatus(input: {
  execution?: string | null;
  truthStatus?: string | null;
  hasEvidence: boolean;
  jobStatus?: string | null;
  capability?: string | null;
}): ComposedTrustStatus {
  return {
    execution: projectExecutionAxis(input.execution),
    evidence: projectEvidenceAxis({
      truthStatus: input.truthStatus,
      hasEvidence: input.hasEvidence,
      jobStatus: input.jobStatus,
    }),
    capability: projectCapabilityAxis(input.capability),
  };
}
