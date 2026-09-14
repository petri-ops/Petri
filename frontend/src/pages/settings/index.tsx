/**
 * Settings 页面入口（UI-365）—— 设置独立页，与 /skills /plugins 同形态。
 *
 * 设置是设备级能力（外观 / 模型接口 / 计算与数据 / 运行时与诊断），与项目
 * 无语义绑定；原工作区 settings 模式退役（历史深链 /project/:id/settings
 * 按 UI-347「search」先例 fail-closed 回 chat）。本体 DesktopSettingsPanel
 * 只依赖 onClose 回调，整页承载即可。
 */

import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DesktopSettingsPanel } from '@/components/desktop/DesktopSettingsPanel';
import styles from './settings.module.css';

export default function SettingsPage(): React.ReactElement {
  const navigate = useNavigate();

  const handleReturnHome = useCallback(() => {
    // 与 Skills / Plugins 页同语义：回到上一页，而非硬跳 /
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate('/');
    }
  }, [navigate]);

  return (
    <div className={styles.settingsPage}>
      <DesktopSettingsPanel onClose={handleReturnHome} />
    </div>
  );
}
