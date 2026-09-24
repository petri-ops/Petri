import React, { useCallback, useEffect, useState } from 'react';
import { EXTRA_RENDERERS_STORAGE_KEY, resolveInitialFlag } from '@/components/copilot/extraRenderers';
import { getApiPrefix } from '@/components/copilot/copilotClient/apiBase';
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
    <section className={styles.section} aria-labelledby="gewu-experimental-features-heading">
      <div className={styles.heading}>
        <h3 id="gewu-experimental-features-heading">{EXPERIMENTAL_FEATURES_LABEL}</h3>
        <p>控制当前版本仍处于实验阶段的工作台能力。</p>
      </div>
      <div className={styles.featureRow} data-testid="experimental-feature-extra-renderers">
        <label className={styles.featureLabel} htmlFor="gewu-extra-renderers-toggle">
          <span>{EXTRA_RENDERERS_LABEL}</span>
          <small>在 SimpleChat 消息流中显示结构化 ResultCard 渲染结果。</small>
        </label>
        <div className={styles.toggleControl}>
          <input
            id="gewu-extra-renderers-toggle"
            className={styles.toggle}
            type="checkbox"
            role="switch"
            aria-label={EXTRA_RENDERERS_LABEL}
            aria-describedby="gewu-extra-renderers-description"
            checked={enabled}
            disabled={saving}
            onChange={(event) => void handleToggle(event.target.checked)}
          />
          <span id="gewu-extra-renderers-description" className={styles.description}>
            {enabled ? '已开启' : '已关闭'}
          </span>
        </div>
      </div>
      <ServerFlagRows />
    </section>
  );
}

/** UI-403 — 后端灰度开关（feature-flags 单一真相，2026-09-18 裁决翻默认开+设置页可控）。 */
type ServerFlagView = {
  key: string;
  enabled: boolean;
  envOverride: boolean | null;
  label: string;
  description: string;
  env: string;
};

function ServerFlagRows(): React.ReactElement {
  const [flags, setFlags] = useState<ServerFlagView[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const resp = await fetch(`${getApiPrefix()}/feature-flags`);
      const body = (await resp.json()) as { status?: unknown; error?: unknown; flags?: Record<string, Record<string, unknown>> };
      if (body.status === 'ok') {
        setFlags(Object.entries(body.flags ?? {}).map(([key, view]) => ({ key, ...view } as ServerFlagView)));
      }
    } catch {
      // 后端未就绪时静默（设置页其余分区同策略）；下次进入页面重试
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleToggle = async (key: string, next: boolean) => {
    if (busyKey) return;
    setBusyKey(key);
    setError(null);
    try {
      const resp = await fetch(`${getApiPrefix()}/feature-flags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, enabled: next }),
      });
      const body = (await resp.json()) as { status?: unknown; error?: unknown; flags?: Record<string, Record<string, unknown>> };
      if (body.status !== 'ok') throw new Error(typeof body.error === 'string' && body.error ? body.error : `HTTP ${resp.status}`);
      setFlags(Object.entries(body.flags ?? {}).map(([k, view]) => ({ key: k, ...view } as ServerFlagView)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      void refresh();
    } finally {
      setBusyKey(null);
    }
  };

  if (flags.length === 0) return <></>;

  return (
    <div className={styles.serverFlags} data-testid="server-flags">
      <div className={styles.featureLabel}>
        <span>长会话与长任务（已实机验证）</span>
        <small>以下开关由后端持久化保存；环境变量强制覆盖时以环境变量为准并锁定。</small>
      </div>
      {flags.map((flag) => (
        <div key={flag.key} className={styles.featureRow} data-testid={`server-flag-${flag.key}`}>
          <label className={styles.featureLabel} htmlFor={`server-flag-toggle-${flag.key}`}>
            <span>{flag.label}</span>
            <small>{flag.description}</small>
          </label>
          <div className={styles.toggleControl}>
            <input
              id={`server-flag-toggle-${flag.key}`}
              className={styles.toggle}
              type="checkbox"
              role="switch"
              aria-label={flag.label}
              checked={flag.enabled}
              disabled={busyKey === flag.key || flag.envOverride != null}
              onChange={(event) => void handleToggle(flag.key, event.target.checked)}
            />
            <span className={styles.description}>
              {flag.envOverride != null
                ? `已被环境变量 ${flag.env} 锁定为${flag.envOverride ? '开' : '关'}`
                : flag.enabled
                  ? '已开启'
                  : '已关闭'}
            </span>
          </div>
        </div>
      ))}
      {error && (
        <div className={styles.envLockError} data-testid="server-flags-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export default ExperimentalFeaturesSection;
