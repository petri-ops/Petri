import { describe, expect, it } from 'vitest';
import {
  buildResultEditCopilotAsk,
  copilotContextOverrideForAsk,
} from './result-edit-agent-bridge';

const TOKEN = 'c'.repeat(64);
const activeArtifact = {
  jobId: 'job_internal',
  toolId: 'volcano-plot',
  name: 'volcano.png',
  type: 'image',
  revisionId: 'rev_internal',
  artifactFamilyId: 'family_internal',
  selectionId: 'selection_internal',
  selectionCompatibility: 'compatible' as const,
  selection: null,
};

describe('P4R-3 Result Composer → Copilot bridge', () => {
  it('绑定 token/Artifact/编辑快照，但可见用户消息只保留用户目标', () => {
    const detail = buildResultEditCopilotAsk({
      submission: {
        origin: 'agent',
        requestedOutcome: '换成更清晰的配色',
        parameterPatch: {},
        scientificConfirmed: false,
        contextToken: TOKEN,
      },
      activeArtifact,
      currentContextToken: TOKEN,
    });

    expect(detail).not.toBeNull();
    expect(detail?.resultContext).toEqual({
      contextToken: TOKEN,
      activeArtifact,
      editRequest: { origin: 'agent', parameterPatch: {}, scientificConfirmed: false },
    });
    expect(detail?.prompt).toBe('换成更清晰的配色');
    expect(detail?.prompt).not.toContain('result_edit_plan_in_context');
    expect(detail?.prompt).not.toContain(TOKEN);
    expect(detail?.prompt).not.toContain('job_internal');
    expect(detail?.prompt).not.toContain('rev_internal');
  });

  it('token 缺失、非法或与当前上下文不一致时拒绝派发', () => {
    const submission = {
      origin: 'agent' as const,
      requestedOutcome: '换配色',
      parameterPatch: {},
      scientificConfirmed: false,
      contextToken: TOKEN,
    };
    expect(buildResultEditCopilotAsk({ submission, activeArtifact, currentContextToken: null })).toBeNull();
    expect(buildResultEditCopilotAsk({
      submission: { ...submission, contextToken: 'invalid' }, activeArtifact, currentContextToken: TOKEN,
    })).toBeNull();
    expect(buildResultEditCopilotAsk({
      submission, activeArtifact, currentContextToken: 'd'.repeat(64),
    })).toBeNull();
  });

  it('SimpleChat 使用事件中的快照覆盖异步期间变化的页面上下文', () => {
    const detail = buildResultEditCopilotAsk({
      submission: {
        origin: 'agent', requestedOutcome: '换配色', parameterPatch: {},
        scientificConfirmed: false, contextToken: TOKEN,
      },
      activeArtifact,
      currentContextToken: TOKEN,
    });
    const override = copilotContextOverrideForAsk(detail!);
    expect(override).toEqual({
      activeArtifact: { ...activeArtifact, contextToken: TOKEN },
      resultEditRequest: { origin: 'agent', parameterPatch: {}, scientificConfirmed: false },
    });
  });

  it('高级控件的 Patch 只进入结构化请求上下文，不伪装成用户说过的话', () => {
    const detail = buildResultEditCopilotAsk({
      submission: {
        origin: 'manual', requestedOutcome: '应用高级参数调整',
        parameterPatch: { point_size: 3 }, scientificConfirmed: false, contextToken: TOKEN,
      },
      activeArtifact,
      currentContextToken: TOKEN,
    });
    expect(detail?.prompt).toBe('应用高级参数调整');
    expect(detail?.prompt).not.toContain('point_size');
    expect(detail?.resultContext?.editRequest.parameterPatch).toEqual({ point_size: 3 });
  });
});
