/**
 * DesktopSection — 通知与桌面分区（BLOCK-424 信息架构拆分）。
 * 从「常规」抽出：系统通知 / 关闭到托盘 / 免打扰时段，与外观关注点分离。
 */
import React from 'react';
import { DesktopBehaviorPanel } from './DesktopBehaviorPanel';

export function DesktopSection(): React.ReactElement {
  return (
    <section className="petri-settings-section">
      <div className="petri-settings-section__heading">
        <h3>通知与桌面</h3>
        <p>任务完成提醒、关闭窗口行为与免打扰时段。</p>
      </div>
      <DesktopBehaviorPanel />
    </section>
  );
}
