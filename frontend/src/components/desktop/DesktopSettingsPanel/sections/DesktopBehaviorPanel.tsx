/**
 * DesktopBehaviorPanel — BLOCK-223 常规设置里的桌面行为两项（通知 / 关闭到托盘）。
 *
 * 真值仍走 `/api/user/prefs`（多端偏好单链）；本组件只做展示与开关，
 * 由 `DesktopShellProvider` 负责落盘与推镜像给主进程。
 * 非桌面宿主（投影 Web）没有 app 桥 → 整块隐藏（这两项只对桌面壳有意义）。
 */

import React, { useState } from 'react';
import styles from './DesktopBehaviorPanel.module.css';
import { useDesktopShellContext, type ShellPrefs } from '@/components/shell/DesktopShellProvider';
import { validateQuietHoursInput } from '@/lib/quiet-hours';

interface DesktopBehaviorPanelViewProps {
  prefs: ShellPrefs;
  syncError?: string | null;
  onChange: (patch: Partial<ShellPrefs>) => void;
}

export function DesktopBehaviorPanelView({ prefs, syncError, onChange }: DesktopBehaviorPanelViewProps): React.ReactElement {
  const [quietDraft, setQuietDraft] = useState(prefs.quietHours);
  const [quietError, setQuietError] = useState<string | null>(null);
  const [lastServerQuiet, setLastServerQuiet] = useState(prefs.quietHours);
  if (prefs.quietHours !== lastServerQuiet) {
    // 服务端偏好异步到达：渲染期同步草稿（不在 effect 里 setState）。
    setLastServerQuiet(prefs.quietHours);
    setQuietDraft(prefs.quietHours);
  }
  const handleQuietChange = (value: string) => {
    setQuietDraft(value);
    const error = validateQuietHoursInput(value);
    setQuietError(error);
    if (!error) onChange({ quietHours: value.trim() });
  };
  return (
    <div className="petri-field" data-testid="desktop-behavior-panel">
      <label className="petri-field__label">桌面行为</label>
      <div className={styles.rows}>
        <label className={styles.row}>
          <input
            type="checkbox"
            checked={prefs.notifyOnTurnEnd}
            onChange={(event) => onChange({ notifyOnTurnEnd: event.target.checked })}
          />
          <span>
            <span className={styles.rowTitle}>回合结束时发送系统通知</span>
            <span className={styles.rowHint}>仅当窗口不在前台时出现；通知不包含对话正文。</span>
          </span>
        </label>
        <label className={styles.row}>
          <input
            type="checkbox"
            checked={prefs.closeToTray}
            onChange={(event) => onChange({ closeToTray: event.target.checked })}
          />
          <span>
            <span className={styles.rowTitle}>关闭窗口时最小化到托盘</span>
            <span className={styles.rowHint}>关闭后后端与正在运行的工具继续执行；从托盘菜单可以真正退出。</span>
          </span>
        </label>
      </div>
      <div className={styles.quietRow}>
        <label className={styles.rowTitle} htmlFor="quiet-hours-input">免打扰时段</label>
        <input
          id="quiet-hours-input"
          type="text"
          className="petri-input petri-input--sm"
          value={quietDraft}
          onChange={(event) => handleQuietChange(event.target.value)}
          placeholder="22:00-08:00（留空关闭）"
          aria-label="免打扰时段"
          aria-invalid={quietError ? 'true' : 'false'}
        />
        <span className={styles.rowHint}>该时段内不弹系统通知，但应用内通知中心仍会记录。跨午夜请写成 22:00-08:00。</span>
        {quietError && <span className={styles.error} role="alert">{quietError}</span>}
      </div>
      <p className="petri-field__hint">
        两项默认：通知开启、关闭即退出。退出时若仍有运行中的任务，会先显示活动摘要。
      </p>
      {syncError && (
        <p className={styles.error} role="alert" data-testid="desktop-behavior-sync-error">
          {syncError}
        </p>
      )}
    </div>
  );
}

export function DesktopBehaviorPanel(): React.ReactElement | null {
  const context = useDesktopShellContext();
  if (!context || !context.bridgeAvailable) return null;
  return (
    <DesktopBehaviorPanelView
      prefs={context.prefs}
      syncError={context.syncError}
      onChange={(patch) => { void context.updatePref(patch); }}
    />
  );
}
