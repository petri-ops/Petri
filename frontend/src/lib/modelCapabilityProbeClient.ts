import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

export type CapabilityProbeVerdict = 'supported' | 'unsupported' | 'unknown' | 'error';

export interface CapabilityProbeEvidence {
  reasoningContent?: boolean;
  reasoningTokens?: number;
  requestId?: string | null;
  requestedModel?: string;
  model?: string | null;
  responseModel?: string | null;
  observedAt?: string;
}

export interface CapabilityProbeResult {
  ok: boolean;
  verdict: CapabilityProbeVerdict;
  profileId?: string;
  requestedModel?: string;
  model?: string;
  provider?: string;
  evidence?: CapabilityProbeEvidence;
  error?: string;
}

export async function probeReasoningCapability(input: {
  profileId: string;
  model: string;
  signal?: AbortSignal;
}): Promise<CapabilityProbeResult> {
  const token = getToken();
  const response = await fetch(`${getPlatformApiPrefix()}/ai/agent/probe-model-capability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ profileId: input.profileId, model: input.model }),
    signal: input.signal || AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => null) as CapabilityProbeResult | null;
  if (!response.ok || !data || data.ok === false) {
    throw new Error((data && data.error) || `http_${response.status}`);
  }
  return data;
}
