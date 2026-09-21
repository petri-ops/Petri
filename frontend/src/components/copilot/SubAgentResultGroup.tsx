import React, { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { SubAgentResultCard, type SubAgentCardData } from './SubAgentResultCard';

/**
 * UI-432（BLOCK-109 P3）— 子智能体终态结果**组卡**。
 *
 * 用户实测反馈（2026-09-21）：并行派发的多个子智能体各自往主会话回写一张大卡，
 * 完成顺序随机 → 刷屏且无序。改为：同一会话的终态子任务收拢为**一个可折叠汇总卡**
 * ——摘要行恒定可见（数量/成功/失败），点击展开逐任务明细卡；有失败时默认展开
 * （失败必须显性），全成功默认收起（细节按需查看）。
 */
export function SubAgentResultGroup({ tasks }: { tasks: SubAgentCardData[] }): React.ReactElement | null {
  const [open, setOpen] = useState(() => tasks.some((t) => t.status === 'failed'));
  if (tasks.length === 0) return null;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const succeeded = tasks.length - failed;
  return (
    <div className="sc-msg-child-finished-group" data-testid="subagent-result-group" data-open={open || undefined}>
      <button
        type="button"
        className="sc-msg-child-finished-group-summary"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        <span>
          阶段汇总 · {tasks.length} 个子智能体 · 成功 {succeeded}
          {failed > 0 ? ` · 失败 ${failed}` : ''}
        </span>
      </button>
      {open && (
        <div className="sc-msg-child-finished" data-testid="subagent-result-cards">
          {tasks.map((t) => (
            <SubAgentResultCard key={t.taskId} data={t} />
          ))}
        </div>
      )}
    </div>
  );
}

export default SubAgentResultGroup;
