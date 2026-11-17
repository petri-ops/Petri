/**
 * frontend/src/components/copilot/gen-ui/compose/ComposeCard.tsx
 *
 * BLOCK-461 [W11 P0/P2] ::compose spec 卡渲染入口。
 * - spec=null → 降级占位 + console 留痕（fail-closed，不冒充渲染成功）；
 * - spec.source.jobId 在场时经 gen-ui:get-data 既有通道取数（CP-11 复用），
 *   $state 引用对该数据求值；失败诚实降级为字面渲染（引用显示为空值）。
 */

import React from 'react';
import type { ComposeSpec } from './spec';
import { ComposeTree } from './catalog';
import type { StateData } from './catalog';

export interface ComposeCardProps {
  spec: ComposeSpec | null;
  conversationId: string | null;
}

function readBridge(): Window['petri'] | null {
  return (typeof window !== 'undefined' && window.petri) || null;
}

export function ComposeCard({ spec, conversationId }: ComposeCardProps): React.ReactElement {
  const [stateData, setStateData] = React.useState<StateData>(null);

  // spec 无数据源时直接走派生（effect 内不再同步 setState——react-hooks/set-state-in-effect）
  const targetJobId = spec?.source?.jobId ?? null;
  const needsFetch = Boolean(targetJobId && conversationId);
  React.useEffect(() => {
    if (!targetJobId || !conversationId) return; // 类型收窄 + 数据源守卫
    let cancelled = false;
    const bridge = readBridge();
    const load = async () => {
      try {
        const result = await bridge?.genUi.getData({ sessionId: conversationId, jobId: targetJobId });
        if (!cancelled && result?.ok) setStateData(result.data);
        if (!cancelled && result && !result.ok) console.error('[compose] get-data 失败（诚实降级为字面渲染）:', result.code);
      } catch (error) {
        if (!cancelled) console.error('[compose] get-data 异常（诚实降级为字面渲染）:', error);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [targetJobId, conversationId]);

  if (spec === null) {
    // fail-closed 降级：与 ::visualize invalid 占位同款语义 + console 留痕
    console.error('[compose] spec 校验失败——已降级占位（不冒充渲染成功）');
    return (
      <div
        data-testid="compose-invalid"
        style={{
          margin: '10px 0',
          padding: '10px 12px',
          border: '1px dashed var(--petri-border)',
          borderRadius: 10,
          fontSize: 'var(--petri-font-size-sm, 12px)',
          color: 'var(--petri-text-muted)',
        }}
      >
        组合视图 spec 无效，已跳过渲染
      </div>
    );
  }
  return <ComposeTree spec={spec} state={needsFetch ? stateData : null} />;
}
