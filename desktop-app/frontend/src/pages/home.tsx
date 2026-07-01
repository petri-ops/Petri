/**
 * Home — 桌面版首页（Vite SPA）
 * 桌面版直接渲染 DesktopDashboard（工作台），不走 Web 营销首页。
 */

import React from 'react';
import { DesktopDashboard } from './_desktop-dashboard';

export default function Home(): React.ReactElement {
  return <DesktopDashboard />;
}
