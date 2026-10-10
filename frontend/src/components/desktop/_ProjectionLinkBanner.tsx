/**
 * BLOCK-159 P1-9 / UI-482 — 投影断连横幅。
 *
 * 数据桥/终端桥失败此前静默（手机端表现=数据变空、终端卡死），用户无法区分
 * 「慢」与「断了」。link 状态离线时显示固定顶横幅，恢复自动隐藏。仅投影环境
 * 渲染（桌面零行为）。
 */
import { useEffect, useState } from 'react';
import {
  getProjectionLinkStatus,
  onProjectionLinkChange,
  type ProjectionLinkStatus,
} from '@/lib/projectionLink';
import { isProjectionEnv } from '@/lib/projectionDataBridges';
import styles from './_ProjectionLinkBanner.module.css';

export function ProjectionLinkBanner() {
  const [status, setStatus] = useState<ProjectionLinkStatus>(() =>
    isProjectionEnv() ? getProjectionLinkStatus() : 'online'
  );

  useEffect(() => {
    if (!isProjectionEnv()) return;
    return onProjectionLinkChange(setStatus);
  }, []);

  if (!isProjectionEnv() || status !== 'offline') return null;
  return (
    <div className={styles.banner} role="status" data-projection-link="offline">
      <span className={styles.dot} aria-hidden />
      <span>与桌面连接中断，正在自动重试…（恢复后数据自动刷新）</span>
    </div>
  );
}
