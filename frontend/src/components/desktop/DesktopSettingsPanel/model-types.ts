// ============================================================
// DesktopSettingsPanel — model role types + helpers
//
// Extracted from src/components/desktop/DesktopSettingsPanel.tsx
// by BLOCK-9.2 PHASE 1. Original location: lines 130-161.
//
// ModelRole / ModelCapability / MODEL_ROLES + providerDefaults +
// credentialId. Tightly coupled to the Models section rendering in
// the main panel.
// ============================================================

import type { ChatModelPreset } from '@/hooks/useAiSettings';
import {
  modelProviderCredentialRef,
  modelProviderProtocol,
} from '@/lib/model-provider-options';

export type ModelRole =
  | 'chat'
  | 'agent'
  | 'planner'
  | 'vision'
  | 'embedding'
  | 'summary'
  | 'report'
  | 'explanation';

export type ModelCapability =
  | 'chat'
  | 'streaming'
  | 'tools'
  | 'vision'
  | 'embedding'
  | 'reasoning';

export const MODEL_ROLES: Array<{
  id: ModelRole;
  label: string;
  capability: ModelCapability;
  hint: string;
}> = [
  { id: 'chat', label: '默认聊天', capability: 'chat', hint: '日常对话与问答' },
  { id: 'agent', label: 'Agent 工具调用', capability: 'tools', hint: '分析规划和工具执行' },
  { id: 'planner', label: '复杂规划', capability: 'chat', hint: '多步骤任务拆解' },
  { id: 'vision', label: '视觉理解', capability: 'vision', hint: '图片和图表解读' },
  { id: 'embedding', label: '语义向量', capability: 'embedding', hint: '记忆与语义检索' },
  { id: 'summary', label: '低成本摘要', capability: 'chat', hint: '会话与文档摘要' },
  { id: 'report', label: '报告生成', capability: 'chat', hint: '分析报告撰写' },
  { id: 'explanation', label: '结果解释', capability: 'chat', hint: 'Artifact 结果解读' },
];

export function providerDefaults(provider: string, id: string): Partial<ChatModelPreset> {
  const defaults: Record<string, Partial<ChatModelPreset>> = {
    'openai-compatible': {
      model: '',
      capabilities: ['chat', 'streaming', 'tools'],
      credentialRef: modelProviderCredentialRef('openai-compatible', id),
    },
    anthropic: {
      model: '',
      capabilities: ['chat', 'streaming', 'tools'],
      credentialRef: modelProviderCredentialRef('anthropic', id),
    },
  };
  return {
    protocol: modelProviderProtocol(provider),
    baseUrl: undefined,
    ...defaults[provider],
  };
}

export function credentialId(profile: ChatModelPreset): string {
  const ref = profile.credentialRef || `provider:${profile.provider.replace(/-vision$/, '')}`;
  return ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
}