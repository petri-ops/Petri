import React, { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { useAutoUpdate } from '@/hooks/useAutoUpdate';
import styles from './UpdateCard.module.css';

/**
 * UpdateCard — 页面内更新卡片（UI-704 · 设置页 IA v2）。
 *
 * 用户裁决（docs/settings-ia-simplification-design.md §二.3）：「新版本发布推送更新
 * 会自动在页面上出现更好，目前在设置内部不实用」→ 更新入口从设置分区主位移除，
 * 改为检测到新版本时在主界面主动呈现本卡片（可关闭），设置里不再让用户找。
 *
 * 形态复用（零新 IPC / 零新框架）：
 *  · 状态与动作全部来自 useAutoUpdate（BLOCK-452/453：主进程轮询 + app:notify 推送）；
 *  · 主进程 onUpdateAvailable 推送 → 卡片即时出现（不依赖用户打开设置页）；
 *  · 下载沿用现有 DMG/NSIS 流程（updater.download/install）。
 *
 * 诚实边界：updater 桥缺席（投影/dev 环境）不渲染；关闭即本轮会话不再打扰
 * （session-only，新版本推送会重新出现——与 useAutoUpdate 状态生命周期一致）。
 */
export function UpdateCard(): React.ReactElement | null {
  const auto = useAutoUpdate();
  const [dismissed, setDismissed] = useState(false);
  // 派生态而非 effect 写态（react-hooks/set-state-in-effect）：关闭后本轮不再打扰；
  // 下载完成（downloaded）时卡片重新唤起提示安装——由该表达式直接派生，无需写回。
  const effectivelyDismissed = dismissed && !auto.downloaded;

  if (!auto.available && !auto.downloaded) return null;
  if (effectivelyDismissed) return null;

  const versionLabel = auto.availableVersion || '';

  return (
    <div className={styles.card} data-testid="update-card" role="status">
      <div className={styles.row}>
        <span className={styles.icon}>
          <Icon name="refresh" size={15} />
        </span>
        <div className={styles.titles}>
          <strong>
            {auto.downloaded
              ? '更新已就绪'
              : auto.available
                ? `发现新版本${versionLabel ? ` ${versionLabel}` : ''}`
                : '正在检查更新…'}
          </strong>
          <small>
            {auto.downloaded
              ? '安装包已下载，安装后即可使用新版本。'
              : auto.downloading
                ? `下载中…${auto.progress != null ? ` ${Math.round(auto.progress * 100)}%` : ''}`
                : '新版本已发布，可在页面内直接下载安装。'}
          </small>
        </div>
        <div className={styles.actions}>
          {auto.downloaded ? (
            <button
              type="button"
              className="petri-btn petri-btn--primary petri-btn--sm"
              onClick={() => void auto.install()}
              disabled={auto.installing}
            >
              {auto.installing ? '安装中…' : '安装更新'}
            </button>
          ) : (
            <button
              type="button"
              className="petri-btn petri-btn--primary petri-btn--sm"
              onClick={() => void auto.download()}
              disabled={auto.downloading}
            >
              {auto.downloading ? '下载中…' : '下载更新'}
            </button>
          )}
          {!auto.downloaded && (
            <button
              type="button"
              className="petri-btn petri-btn--ghost petri-btn--sm"
              onClick={() => setDismissed(true)}
              aria-label="稍后"
            >
              稍后
            </button>
          )}
          <button
            type="button"
            className={styles.close}
            onClick={() => setDismissed(true)}
            aria-label="关闭"
            title="关闭"
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      </div>
      {auto.error && (
        <p className={styles.error} role="alert">
          更新失败：{auto.error}
        </p>
      )}
    </div>
  );
}
