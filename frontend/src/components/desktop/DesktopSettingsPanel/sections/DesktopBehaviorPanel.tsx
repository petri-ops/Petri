/**
 * DesktopBehaviorPanel — BLOCK-223 常规设置里的桌面行为两项（通知 / 关闭到托盘）。
 *
 * 真值仍走 `/api/user/prefs`（多端偏好单链）；本组件只做展示与开关，
 * 由 `DesktopShellProvider` 负责落盘与推镜像给主进程。
 * 非桌面宿主（投影 Web）没有 app 桥 → 整块隐藏（这两项只对桌面壳有意义）。
 */

import React, { useState } from 'react';
import styles from './DesktopBehaviorPanel.module.css';
import { SettingsField } from '../SettingsField';
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
    <div data-testid="desktop-behavior-panel">
      <SettingsField
        icon="bell"
        label="回合结束通知"
        trailing
        hint="仅窗口不在前台时提醒，不含对话正文"
      >
        <input
          type="checkbox"
          checked={prefs.notifyOnTurnEnd}
          aria-label="回合结束时发送系统通知"
          onChange={(event) => onChange({ notifyOnTurnEnd: event.target.checked })}
        />
      </SettingsField>
      <SettingsField
        icon="panel-bottom"
        label="关闭窗口时最小化到托盘"
        trailing
        hint="后台继续运行，从托盘菜单可真正退出"
      >
        <input
          type="checkbox"
          checked={prefs.closeToTray}
          aria-label="关闭窗口时最小化到托盘"
          onChange={(event) => onChange({ closeToTray: event.target.checked })}
        />
      </SettingsField>
      <SettingsField
        icon="moon"
        label="免打扰时段"
        htmlFor="quiet-hours-input"
        hint="此时段不弹通知；跨午夜写成 22:00-08:00，留空关闭"
      >
        <input
          id="quiet-hours-input"
          type="text"
          className="petri-input petri-input--sm"
          value={quietDraft}
          onChange={(event) => handleQuietChange(event.target.value)}
          placeholder="22:00-08:00"
          aria-invalid={quietError ? 'true' : 'false'}
        />
        {quietError && <span className={styles.error} role="alert">{quietError}</span>}
      </SettingsField>
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
