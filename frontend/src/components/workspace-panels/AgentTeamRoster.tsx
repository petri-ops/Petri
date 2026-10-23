import React, { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import buttonStyles from '@/components/ui/controls/button.module.css';
import { getAgentCategoryByKey } from '@/lib/agentCategories';
import type { AgentTeamStopReceipt, AgentTeamView, TeamMember } from '@/lib/agentTeamClient';
import styles from './AgentTeamRoster.module.css';

const STATUS_LABEL: Record<string, string> = {
  running: '运行中',
  paused: '已暂停',
  cancel_requested: '停止中',
  completed: '已完成',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const OUTCOME_LABEL: Record<string, string> = {
  cancel_requested: '已请求停止',
  already_finished: '本就已结束',
  not_cancelled: '未取消',
};

function statusLabel(member: Pick<TeamMember, 'status' | 'agentStatus'>): string {
  if (member.agentStatus === 'paused') return '已暂停';
  if (member.agentStatus === 'cancel_requested') return '停止中';
  return STATUS_LABEL[member.status] || member.status;
}

function formatClock(at: string | null): string {
  if (!at) return '—';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function roleLabel(role: string | null): string {
  if (!role) return '通用';
  const category = getAgentCategoryByKey(role);
  return category ? `${category.emoji} ${category.label}` : role;
}

export function AgentTeamRoster({
  team,
  currentAgentId,
  busy,
  receipt,
  onSelectAgent,
  onPause,
  onResume,
  onStopTeam,
}: {
  team: AgentTeamView | null;
  currentAgentId: string | null;
  busy: boolean;
  receipt: AgentTeamStopReceipt | null;
  onSelectAgent: (agentId: string) => void;
  onPause: (agentId: string) => void;
  onResume: (agentId: string) => void;
  onStopTeam: (leaderId: string) => void;
}): React.ReactElement | null {
  const leaderId = team ? team.leader.agentId : null;
  // 两步武装按「leader + 回执」归属：状态变了自然回落为未武装（不在 effect 里 setState）。
  const armKey = `${leaderId || ''}|${receipt ? `${receipt.leader.agentId}:${receipt.summary.requested}:${receipt.summary.alreadyFinished}` : ''}`;
  const [armState, setArmState] = useState<{ key: string; armed: boolean }>({ key: '', armed: false });
  const armed = armState.key === armKey ? armState.armed : false;
  const setArmed = (value: boolean) => setArmState({ key: armKey, armed: value });
  // 焦点成员：父面板切换是"打开详情"，但暂停/恢复不应依赖切换是否成功——
  // 点谁就对谁操作；父层 currentAgentId 变化时焦点自动回落。
  const [focus, setFocus] = useState<{ forCurrent: string | null; id: string | null }>({ forCurrent: null, id: null });
  const focusedId = focus.forCurrent === currentAgentId ? (focus.id ?? currentAgentId) : currentAgentId;
  const setFocusedId = (id: string) => setFocus({ forCurrent: currentAgentId, id });

  if (!team) return null;

  const runningMembers = team.members.filter((member) => statusLabel(member) === '运行中' || statusLabel(member) === '已暂停');
  const current = team.members.find((member) => member.agentId === focusedId)
    || team.members.find((member) => member.agentId === currentAgentId)
    || null;
  const currentPaused = current ? current.agentStatus === 'paused' : false;
  const currentRunning = current ? current.status === 'running' : false;

  return (
    <div className={styles.roster} data-testid="agent-team-roster" data-state={team.members.length > 0 ? 'ready' : 'empty'}>
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="layers" size={14} />
          <strong>团队</strong>
        </span>
        <span className={styles.counts} data-testid="team-counts">
          {team.counts.total} 成员 · {team.counts.running} 在跑 · {team.counts.finished} 已结束
          {team.counts.structuredInvalid > 0 ? ` · ${team.counts.structuredInvalid} 结构化未通过` : ''}
        </span>
        {team.journalAvailable ? (
          <span className={styles.badge} data-testid="team-journal" title="运行级 journal 已落盘（诊断前先读）">
            journal
          </span>
        ) : null}
      </div>

      <div className={styles.leader} data-testid="team-leader">
        <span className={styles.role}>
          <Icon name="cpu" size={12} /> 主智能体
        </span>
        <span className={styles.status}>{statusLabel({ status: team.leader.status, agentStatus: team.leader.agentStatus })}</span>
        <span className={styles.task} title={team.leader.taskHead}>{team.leader.taskHead || '（无任务描述）'}</span>
      </div>

      {team.members.length === 0 && (
        <p className={styles.empty} data-testid="team-empty">还没有子智能体。</p>
      )}

      <div className={styles.members}>
        {team.members.map((member) => {
          const active = member.agentId === (focusedId || currentAgentId);
          return (
            <button
              key={member.agentId}
              type="button"
              className={`${styles.member}${active ? ` ${styles.memberActive}` : ''}`}
              data-testid="team-member"
              data-agent-id={member.agentId}
              data-status={member.status}
              aria-current={active || undefined}
              onClick={() => { setFocusedId(member.agentId); onSelectAgent(member.agentId); }}
            >
              <span className={styles.role}>{roleLabel(member.role)}</span>
              <span className={styles.status}>{statusLabel(member)}</span>
              <span className={styles.task} title={member.taskHead}>{member.taskHead || '（无任务描述）'}</span>
              <span className={styles.meta}>{formatClock(member.lastEventAt)}</span>
              {member.structured ? (
                <span className={member.structured.ok ? styles.badgeOk : styles.badgeWarn} title={member.structured.errors.join('\n')}>
                  {member.structured.ok ? '结构化 ✓' : '结构化 ✗'}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className={styles.actions}>
        {current && currentRunning && (
          currentPaused ? (
            <button type="button" className={buttonStyles.ghost} data-testid="team-resume" disabled={busy} onClick={() => onResume(current.agentId)}>
              恢复
            </button>
          ) : (
            <button
              type="button"
              className={buttonStyles.ghost}
              data-testid="team-pause"
              disabled={busy}
              title="将在当前步骤（工具调用）结束后暂停"
              onClick={() => onPause(current.agentId)}
            >
              暂停（当前步骤后生效）
            </button>
          )
        )}
        {team.members.length > 0 && (
          armed ? (
            <>
              <button
                type="button"
                className={buttonStyles.danger}
                data-testid="team-stop-confirm"
                disabled={busy}
                onClick={() => { setArmed(false); onStopTeam(team.leader.agentId); }}
              >
                确认停止团队（{runningMembers.length} 个在跑）
              </button>
              <button type="button" className={buttonStyles.ghost} data-testid="team-stop-cancel" onClick={() => setArmed(false)}>
                取消
              </button>
            </>
          ) : (
            <button type="button" className={buttonStyles.ghost} data-testid="team-stop" disabled={busy} onClick={() => setArmed(true)}>
              停止团队
            </button>
          )
        )}
      </div>

      {receipt && (
        <div className={styles.receipt} data-testid="team-receipt">
          <span>
            停止回执：已请求 {receipt.summary.requested} · 本就已结束 {receipt.summary.alreadyFinished} · 未取消 {receipt.summary.notCancelled}
          </span>
          <span className={styles.receiptRow}>
            {receipt.members.map((member) => (
              <span key={member.agentId} data-testid="team-receipt-member">
                {member.agentId.slice(0, 8)} → {OUTCOME_LABEL[member.outcome] || member.outcome}
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
