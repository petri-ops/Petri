/**
 * Plugins 页面入口（UI-364）—— 插件商店独立页，与 /skills 同形态。
 *
 * 插件装卸是设备级能力（BLOCK-84 装卸记录在 dataDir/packs/installed.json，
 * boot 全局接线），与项目无语义绑定；原工作区 plugins 模式退役
 * （历史深链 /project/:id/plugins 按 UI-347「search」先例 fail-closed 回 chat）。
 * 本体 PluginStorePanel 纯 IPC、零项目依赖，整页承载即可。
 */

import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PluginStorePanel } from '@/components/desktop/PluginStorePanel';
import styles from './plugins.module.css';

export default function PluginsPage(): React.ReactElement {
  const navigate = useNavigate();

  const handleReturnHome = useCallback(() => {
    // 与 SkillsPage 同语义：回到上一页（可能来自项目工作台），而非硬跳 /
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate('/');
    }
  }, [navigate]);

  return (
    <div className={styles.pluginsPage}>
      <PluginStorePanel onClose={handleReturnHome} backLabel="返回" />
    </div>
  );
}
