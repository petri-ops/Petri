/**
 * UI-620 — 消息排队面板（参考 Qoder CN chatQueue 形态）。
 *
 * 每条排队消息自带 插话 / 编辑 / 移除；插话=在下一个安全执行边界交给
 * Agent（不停止当前执行）。立即执行/上移/下移收进「更多」菜单。
 * 面板只在有排队项、溢出提示或暂停排水时出现。
 */

import React, { useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { QueuedPrompt } from './hooks/useChatStream';

interface QueuedMessagesPanelProps {
  prompts: QueuedPrompt[];
  autoDrain: boolean;
  overflow: boolean;
  streaming: boolean;
  steeringId: string | null;
  queueCap: number;
  onPause: () => void;
  onResume: () => void;
  onSteer: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onSendNow: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}

const STEER_TIP = '在下一个安全执行边界交给 Agent，不停止当前执行；运行中可在输入框按 Ctrl+Enter 直接插话';
const STEER_INACTIVE_TIP = '当前没有运行中的任务，消息将继续排队';

export function QueuedMessagesPanel({
  prompts,
  autoDrain,
  overflow,
  streaming,
  steeringId,
  queueCap,
  onPause,
  onResume,
  onSteer,
  onEdit,
  onRemove,
  onSendNow,
  onMove,
}: QueuedMessagesPanelProps): React.ReactElement | null {
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!menuId) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuId]);

  if (prompts.length === 0 && !overflow && autoDrain) return null;

  return (
    <div className="sc-queue-panel" role="list" aria-label="消息排队" data-testid="queue-panel">
      <div className="sc-queue-panel__head">
        <span className="sc-queue-panel__title">
          消息排队 · {prompts.length} 条{!autoDrain ? ' · 自动排水已暂停' : ''}
        </span>
        {prompts.length > 0 && autoDrain && (
          <button
            type="button"
            className="sc-queue-panel__headbtn"
            aria-label="暂停自动排水"
            title="暂停自动排水：跑完当前轮后不自动发送，排队项保留"
            data-testid="queue-pause"
            onClick={onPause}
          >
            ‖ 暂停排水
          </button>
        )}
        {!autoDrain && (
          <button
            type="button"
            className="sc-queue-panel__headbtn"
            aria-label="恢复自动排水"
            title="恢复自动排水（跑完自动发送排队项）"
            data-testid="queue-resume"
            onClick={onResume}
          >
            ▶ 恢复排水
          </button>
        )}
      </div>
      {overflow && (
        <div className="sc-queue-panel__notice" role="status" data-testid="queue-overflow">
          队列已满（上限 {queueCap} 条）——请先处理既有排队项
        </div>
      )}
      {prompts.map((prompt, index) => {
        const steering = steeringId === prompt.id;
        return (
          <div key={prompt.id} className="sc-queue-row" role="listitem" data-testid={`queue-row-${prompt.id}`}>
            <span className="sc-queue-row__pos">#{index + 1}</span>
            <span className="sc-queue-row__text" title={prompt.text}>{prompt.text}</span>
            <span className="sc-queue-row__actions">
              <button
                type="button"
                className="sc-queue-row__steer"
                data-testid="queue-chip-steer"
                disabled={!streaming || steering}
                aria-label="插话（下一个安全边界交给 Agent）"
                title={streaming ? STEER_TIP : STEER_INACTIVE_TIP}
                onClick={() => onSteer(prompt.id)}
              >
                <Icon name={steering ? 'clock' : 'arrow-right'} size={12} />
                <span>{steering ? '插话中' : '插话'}</span>
              </button>
              <button
                type="button"
                className="sc-queue-row__btn"
                aria-label="编辑该排队消息"
                title="编辑（撤回到输入框）"
                data-testid="queue-chip-withdraw"
                onClick={() => onEdit(prompt.id)}
              >
                <Icon name="pencil" size={13} />
              </button>
              <button
                type="button"
                className="sc-queue-row__btn"
                aria-label="移除该排队消息"
                title="移除消息"
                data-testid="queue-chip-remove"
                onClick={() => onRemove(prompt.id)}
              >
                <Icon name="trash" size={13} />
              </button>
              <button
                type="button"
                className="sc-queue-row__btn"
                aria-label="更多操作"
                title="更多操作"
                aria-haspopup="menu"
                aria-expanded={menuId === prompt.id}
                data-testid="queue-chip-more"
                onClick={() => setMenuId((current) => (current === prompt.id ? null : prompt.id))}
              >
                <Icon name="more-horizontal" size={14} />
              </button>
            </span>
            {menuId === prompt.id && (
              <>
                <button
                  type="button"
                  className="sc-queue-menu-overlay"
                  aria-label="关闭排队操作菜单"
                  onClick={() => setMenuId(null)}
                />
                <div className="sc-queue-row__menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="queue-chip-send-now"
                    title={streaming ? '停止当前任务，并优先执行这条排队消息' : '把这条排队消息移到队首'}
                    onClick={() => { setMenuId(null); onSendNow(prompt.id); }}
                  >
                    {streaming ? '立即执行（打断当前任务）' : '移到队首'}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="queue-chip-up"
                    onClick={() => { setMenuId(null); onMove(prompt.id, -1); }}
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="queue-chip-down"
                    onClick={() => { setMenuId(null); onMove(prompt.id, 1); }}
                  >
                    下移
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
