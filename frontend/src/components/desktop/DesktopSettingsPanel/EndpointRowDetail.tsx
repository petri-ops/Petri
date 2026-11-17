/**
 * EndpointRowDetail — BLOCK-455 D6 渠道行详情（展开区）。
 *
 * 控件行 = 当前默认模型的「选择器显示 + 思考合并下拉 + 视觉 + 向量」；
 * 能力表 = 「渠道默认（兜底）」行（写渠道级 capabilities，照顾未发现/未单列的模型）
 * + 其余已发现模型逐行编辑（写 modelCapabilities 显式条目）。
 * 默认模型不进逐模型表——其能力位由控件行编辑，避免同一位两处视图。
 */

import React, { useState } from 'react';
import type { ChatModelPreset } from '@/hooks/useAiSettings';
import { resolveModelCapabilities } from '@/lib/model-capabilities';
import { probeReasoningCapability } from '@/lib/modelCapabilityProbeClient';
import { EndpointCapabilityToggle } from './EndpointCapabilityToggle';
import { ModelSelectorControls } from './sections/ModelSelectorControls';

interface EndpointRowDetailProps {
  profile: ChatModelPreset;
  /** 连通性测试发现的模型列表。 */
  models: string[];
  onUpdate: (id: string, patch: Partial<ChatModelPreset>) => void;
}

const CAPABILITY_META = [
  {
    capability: 'vision',
    label: '视觉',
    title: '声明该模型支持图片输入（识图）：勾选后可在上方「识图模型」换绑；网关须真正支持 image_url 多模态，否则识图调用诚实报错',
    aria: '支持识图（视觉输入）',
  },
  {
    capability: 'reasoning',
    label: '思考',
    title: '声明该模型支持思考档位：勾选后 composer 的档位控件才会出现，并按协议映射上游参数',
    aria: '支持思考档位',
  },
  {
    capability: 'embedding',
    label: '向量',
    title: '声明该模型可用于向量化（embedding）：勾选后可在上方「向量模型」换绑；端点需支持 /embeddings 且输出 1024 维（如 bge-m3），否则整批拒收并降级',
    aria: '支持向量化（embedding）',
  },
] as const;

export function EndpointRowDetail({ profile, models, onUpdate }: EndpointRowDetailProps): React.ReactElement {
  const label = profile.label || '自定义渠道';
  const defaultModel = profile.defaultModel || profile.model || '';
  const otherModels = Array.from(new Set(models.filter((model) => model && model !== defaultModel)));
  const [probing, setProbing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const runProbe = async (model: string) => {
    if (!model || probing) return;
    setProbing(model);
    setNotice(`正在探测 ${model} 的思考能力（极小请求，可能消耗少量积分）…`);
    try {
      const result = await probeReasoningCapability({ profileId: profile.id, model });
      if (result.verdict === 'supported') {
        const base = resolveModelCapabilities(profile, model);
        const next = Array.from(new Set([...base, 'reasoning']));
        onUpdate(profile.id, { modelCapabilities: { ...(profile.modelCapabilities || {}), [model]: next } });
        const requestId = result.evidence?.requestId;
        const responseModel = result.evidence?.responseModel;
        const aliasNote = responseModel && responseModel !== model ? `；上游响应模型=${responseModel}` : '';
        setNotice(`探测到思考证据${requestId ? `（request_id=${requestId}）` : ''}${aliasNote}，已启用该模型思考。`);
      } else if (result.verdict === 'unsupported') {
        const next = resolveModelCapabilities(profile, model).filter((cap) => cap !== 'reasoning');
        onUpdate(profile.id, { modelCapabilities: { ...(profile.modelCapabilities || {}), [model]: next } });
        setNotice('上游明确拒绝思考参数，已将该模型思考能力关闭。');
      } else {
        setNotice('未找到明确思考证据，未改动能力位；可在上方手动声明。');
      }
    } catch (error) {
      setNotice(`探测失败：${error instanceof Error ? error.message : String(error)}。能力位未改动。`);
    } finally {
      setProbing(null);
    }
  };

  return (
    <div className="petri-endpoint-card__detail">
      <div className="petri-endpoint-detail__controls">
        <ModelSelectorControls profile={profile} onUpdate={onUpdate} />
        <EndpointCapabilityToggle
          profile={profile}
          model={defaultModel}
          capability="vision"
          label="视觉"
          title={CAPABILITY_META[0].title}
          ariaLabel={`${label} ${defaultModel} ${CAPABILITY_META[0].aria}`}
          onUpdate={onUpdate}
        />
        <EndpointCapabilityToggle
          profile={profile}
          model={defaultModel}
          capability="embedding"
          label="向量"
          title={CAPABILITY_META[2].title}
          ariaLabel={`${label} ${defaultModel} ${CAPABILITY_META[2].aria}`}
          onUpdate={onUpdate}
        />
        <button
          type="button"
          className="petri-btn petri-btn--ghost petri-btn--sm"
          data-testid="capability-probe-default"
          aria-label={`${label} 探测 ${defaultModel} 思考能力`}
          title="点击后发送极小请求探测该模型是否产生思考证据（可能消耗少量积分）"
          disabled={!defaultModel || probing !== null}
          onClick={() => void runProbe(defaultModel)}
        >
          {probing === defaultModel ? '探测中…' : '探测默认模型思考'}
        </button>
      </div>
      <div className="petri-endpoint-detail__models" aria-label={`${label} 逐模型能力声明`}>
        <span className="petri-endpoint-detail__models-header">模型</span>
        <span className="petri-endpoint-detail__models-header">视觉</span>
        <span className="petri-endpoint-detail__models-header">思考</span>
        <span className="petri-endpoint-detail__models-header">向量</span>
        <span className="petri-endpoint-detail__models-header">探测</span>
        <span
          className="petri-endpoint-detail__model-name"
          title="渠道默认能力：未单列声明的模型按此兜底（旧数据语义不变）"
        >
          渠道默认（兜底）
        </span>
        {CAPABILITY_META.map((meta) => (
          <EndpointCapabilityToggle
            key={`channel-${meta.capability}`}
            profile={profile}
            capability={meta.capability}
            label={meta.label}
            title={meta.title}
            ariaLabel={`${label} 渠道默认 ${meta.aria}`}
            onUpdate={onUpdate}
          />
        ))}
        <span aria-hidden="true" />
        {otherModels.map((model) => (
          <React.Fragment key={model}>
            <span className="petri-endpoint-detail__model-name" title={model}>{model}</span>
            {CAPABILITY_META.map((meta) => (
              <EndpointCapabilityToggle
                key={`${model}-${meta.capability}`}
                profile={profile}
                model={model}
                capability={meta.capability}
                label={meta.label}
                title={meta.title}
                ariaLabel={`${label} ${model} ${meta.aria}`}
                onUpdate={onUpdate}
              />
            ))}
            <button
              type="button"
              className="petri-btn petri-btn--ghost petri-btn--sm"
              data-testid={`capability-probe-${model}`}
              aria-label={`${label} 探测 ${model} 思考能力`}
              title="点击后发送极小请求探测该模型是否产生思考证据（可能消耗少量积分）"
              disabled={probing !== null}
              onClick={() => void runProbe(model)}
            >
              {probing === model ? '探测中…' : '探测'}
            </button>
          </React.Fragment>
        ))}
      </div>
      {otherModels.length === 0 && (
        <p className="petri-field__hint" role="note">
          暂无其他已发现模型：测试连通性成功后，这里会列出该渠道的模型供逐个声明能力（发现时按模型名自动预填，可纠正）。
        </p>
      )}
      {notice && <p className="petri-field__hint" role="status">{notice}</p>}
    </div>
  );
}