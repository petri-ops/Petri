import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { useAutoUpdate } from '@/hooks/useAutoUpdate';
import styles from './UpdatePill.module.css';

/**
 * UI-705 — 标题栏内嵌更新 pill（对标 Qoder「⬇ 更新」形态，用户裁决
 * 2026-11-17「对比一下我们 petri 的更新 是否能做到相似的效果」）。
 *
 * 形态迭代（接 UI-704 UpdateCard 的用户裁决链「更新应页面内主动出现」）：
 * 检测到新版本（主进程轮询推送，useAutoUpdate 单一状态源）时，标题栏
 * windowTools 区（铃铛旁）出现蓝色「⬇ 更新」pill——视线热点、不遮挡内容
 * （替代右下角浮层卡片，该卡片已退役）。点击就地下拉面板：版本号 / 下载
 * （进度%）/ 安装 / 稍后。
 *
 * Petri 差别形态（X5 自检）：Qoder 按钮跳外部下载；本 pill 走本地更新链
 * 全链审计（主进程轮询 → 下载进度事件 → 安装，tool/usage 可追溯），「稍后」
 * = session 内不再打扰、下一个新版本推送时复现（P5-b 偏好一次记住）。
 *
 * 边界：无更新/未推送时不渲染（推送制不常驻）；updater 桥缺席（投影/dev
 * 未打包且未开 demo 档）不渲染。
 */
export function UpdatePill(): React.ReactElement | null {
  const auto = useAutoUpdate();
  const [panelOpen, setPanelOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // 派生态（react-hooks/set-state-in-effect）：稍后 = 本会话隐藏，下载完成
  // （downloaded）重新唤起提示安装。
  const effectivelyDismissed = dismissed && !auto.downloaded;

  useEffect(() => {
    if (!panelOpen) return undefined;
    const onDocClick = (event: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setPanelOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [panelOpen]);

  if (!auto.available && !auto.downloaded) return null;
  if (effectivelyDismissed) return null;

  const versionLabel = auto.availableVersion || '';
  const busy = auto.downloading || auto.installing;

  return (
    <div className={styles.wrap} ref={wrapRef} data-testid="update-pill">
      <button
        type="button"
        className={`${styles.pill}${auto.downloaded ? ` ${styles.pillReady}` : ''}`}
        onClick={() => setPanelOpen((v) => !v)}
        aria-expanded={panelOpen}
        aria-label="更新面板"
        title={auto.downloaded ? '更新已下载，点击安装' : `发现新版本${versionLabel ? ` ${versionLabel}` : ''}，点击查看`}
      >
        <Icon name="download" size={13} />
        {auto.downloaded ? '安装更新' : busy ? `下载中 ${auto.progress != null ? `${Math.round(auto.progress * 100)}%` : '…'}` : '更新'}
      </button>
      {panelOpen && (
        <div className={styles.panel} role="dialog" aria-label="更新面板">
          <div className={styles.panelHead}>
            <strong>
              {auto.downloaded
                ? '更新已就绪'
                : `发现新版本${versionLabel ? ` ${versionLabel}` : ''}`}
            </strong>
            <button
              type="button"
              className={styles.close}
              onClick={() => { setPanelOpen(false); setDismissed(true); }}
              aria-label="关闭面板"
              title="稍后（本会话不再打扰，下个新版本推送时会再出现）"
            >
              <Icon name="x" size={12} />
            </button>
          </div>
          <p className={styles.note}>
            {auto.downloaded
              ? '安装包已下载完成，安装后即可使用新版本。'
              : auto.downloading
                ? '正在下载更新包，完成后可一键安装。'
                : '新版本已发布。下载走本地更新链（进度可追踪，安装包落本机下载目录）。'}
          </p>
          {auto.error && <p className={styles.error} role="alert">更新失败：{auto.error}</p>}
          <div className={styles.actions}>
            {auto.downloaded ? (
              <button
                type="button"
                className="petri-btn petri-btn--primary petri-btn--sm"
                onClick={() => void auto.install()}
                disabled={auto.installing}
              >
                {auto.installing ? '安装中…' : '⬆ 安装更新'}
              </button>
            ) : (
              <button
                type="button"
                className="petri-btn petri-btn--primary petri-btn--sm"
                onClick={() => void auto.download()}
                disabled={auto.downloading}
              >
                {auto.downloading ? `下载中 ${auto.progress != null ? `${Math.round(auto.progress * 100)}%` : '…'}` : '⬇ 下载更新'}
              </button>
            )}
            {!auto.downloaded && (
              <button
                type="button"
                className="petri-btn petri-btn--ghost petri-btn--sm"
                onClick={() => { setPanelOpen(false); setDismissed(true); }}
              >
                稍后
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
