import React, { useState } from 'react';
import { EXTRA_RENDERERS_STORAGE_KEY, resolveInitialFlag } from '@/components/copilot/extraRenderers';
import styles from './ExperimentalFeaturesSection.module.css';

export const EXPERIMENTAL_FEATURES_LABEL = 'Experimental Features';
export const EXTRA_RENDERERS_LABEL = 'Agent 工作台：ResultCard 渲染';

type AgentWorkbenchFlagBridge = NonNullable<Window['biof3']>['agentWorkbenchFlags'];

type Props = {
  bridge?: AgentWorkbenchFlagBridge;
};

function notifyStorage(flag: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(EXTRA_RENDERERS_STORAGE_KEY, String(flag));
  } catch {
    // Keep the UI usable when a browser privacy policy blocks localStorage.
  }
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: EXTRA_RENDERERS_STORAGE_KEY,
      newValue: String(flag),
    }),
  );
}

export function ExperimentalFeaturesSection({ bridge }: Props): React.ReactElement {
  const [enabled, setEnabled] = useState<boolean>(() => resolveInitialFlag());
  const [saving, setSaving] = useState(false);

  const handleToggle = async (next: boolean) => {
    if (saving) return;
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    notifyStorage(next);

    try {
      if (bridge?.set) {
        const result = await bridge.set(next);
        if (result?.extraRenderers !== next) {
          throw new Error('Agent 工作台 flag 状态未同步');
        }
      }
    } catch {
      setEnabled(previous);
      notifyStorage(previous);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="biof3-experimental-features-heading">
      <div className={styles.heading}>
        <h3 id="biof3-experimental-features-heading">{EXPERIMENTAL_FEATURES_LABEL}</h3>
        <p>控制当前版本仍处于实验阶段的工作台能力。</p>
      </div>
      <div className={styles.featureRow} data-testid="experimental-feature-extra-renderers">
        <label className={styles.featureLabel} htmlFor="biof3-extra-renderers-toggle">
          <span>{EXTRA_RENDERERS_LABEL}</span>
          <small>在 SimpleChat 消息流中显示结构化 ResultCard 渲染结果。</small>
        </label>
        <div className={styles.toggleControl}>
          <input
            id="biof3-extra-renderers-toggle"
            className={styles.toggle}
            type="checkbox"
            role="switch"
            aria-label={EXTRA_RENDERERS_LABEL}
            aria-describedby="biof3-extra-renderers-description"
            checked={enabled}
            disabled={saving}
            onChange={(event) => void handleToggle(event.target.checked)}
          />
          <span id="biof3-extra-renderers-description" className={styles.description}>
            {enabled ? '已开启' : '已关闭'}
          </span>
        </div>
      </div>
    </section>
  );
}

export default ExperimentalFeaturesSection;
