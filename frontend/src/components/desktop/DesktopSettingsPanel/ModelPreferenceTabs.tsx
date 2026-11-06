/**
 * UI-696 — 图 2 形态的「默认 / 自定义」页签。
 * 从 DesktopSettingsPanel 抽出，避免大文件继续增长（code-size 棘轮只减不增）。
 */
import React from 'react';
import prefStyles from '@/components/copilot/SimpleChat/ModelPreferenceControls.module.css';

export type ModelPrefTab = 'default' | 'custom';

const TABS: readonly { id: ModelPrefTab; label: string }[] = [
  { id: 'default', label: '默认' },
  { id: 'custom', label: '自定义' },
];

export function ModelPreferenceTabs({
  value,
  onChange,
}: {
  value: ModelPrefTab;
  onChange: (next: ModelPrefTab) => void;
}): React.ReactElement {
  return (
    <div className={prefStyles.prefTabs} role="tablist" aria-label="模型偏好">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          className={`${prefStyles.prefTab} ${value === tab.id ? prefStyles.prefTabActive : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
