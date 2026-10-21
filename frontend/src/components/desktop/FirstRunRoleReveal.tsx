/**
 * FirstRunRoleReveal — BLOCK-227 Q9 K9 首启角色揭示。
 *
 * 只在首次启动（roleRevealSeen !== true）时出现一屏，用三张卡说清「能帮你做什么」；
 * 必须显式点「开始使用」才关闭（不提供点遮罩/Esc 误跳过），随后写回偏好。
 */

import React from 'react';
import styles from './FirstRunRoleReveal.module.css';
import button from '@/components/ui/controls/button.module.css';
import { useRoleRevealPreference } from '@/hooks/useRoleRevealPreference';

const ROLES: ReadonlyArray<{ title: string; body: string }> = [
  { title: '分析数据', body: '拆解任务、运行本地工具，把结果整理成可追溯的产物。' },
  { title: '写代码', body: '读工作区、改文件、跑测试；每一步改动都可以审阅。' },
  { title: '整理知识', body: '把资料、笔记和历史分析收进知识空间，随时检索复用。' },
];

export function FirstRunRoleReveal(): React.ReactElement | null {
  const { visible, dismiss, error } = useRoleRevealPreference();
  if (!visible) return null;
  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-reveal-title"
      data-testid="role-reveal"
    >
      <div className={styles.card}>
        <h2 id="role-reveal-title" className={styles.title}>你好，我是格物</h2>
        <p className={styles.lead}>
          一个跑在你机器上的通用 agent。你可以把它当成会动手的搭档——说清目标，它来拆步骤、调工具、交付结果。
        </p>
        <div className={styles.roles}>
          {ROLES.map((role) => (
            <div key={role.title} className={styles.role}>
              <span className={styles.roleTitle}>{role.title}</span>
              <span className={styles.roleBody}>{role.body}</span>
            </div>
          ))}
        </div>
        <p className={styles.note}>本地执行、无厂商中继；工具调用与审批记录都可回看。</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <button
            type="button"
            className={button.primary}
            onClick={() => void dismiss()}
            autoFocus
            data-testid="role-reveal-start"
          >
            开始使用
          </button>
        </div>
      </div>
    </div>
  );
}
