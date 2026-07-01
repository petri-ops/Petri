/**
 * DesktopNavPanel — 桌面版导航面板（类似 VS Code Activity Bar 的启动器）
 *
 * 列出 BioF3 各主要模块入口，点击跳转到对应页面。
 * Vite SPA 版：用 react-router useNavigate 替代 window.location.href，
 * 路由去掉 /BioF3/ 前缀（Docusaurus baseUrl）。
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/icons/Icon';

interface Props {
  onClose: () => void;
}

interface NavItem {
  label: string;
  to: string;
  icon: IconName;
}

const NAV_ITEMS: NavItem[] = [
  { label: '首页', to: '/', icon: 'book' },
  { label: '教程', to: '/docs/intro', icon: 'book' },
  { label: '博客', to: '/blog', icon: 'calendar' },
  { label: 'FigCode', to: '/figcode', icon: 'image' },
  { label: '分析工具', to: '/tools', icon: 'bar-chart' },
  { label: '单细胞', to: '/single-cell', icon: 'dna' },
  { label: '空间组学', to: '/spatial', icon: 'sparkles' },
  { label: 'Skills 库', to: '/skills', icon: 'study' },
  { label: '算法卡片', to: '/algorithms', icon: 'brain' },
  { label: '关于', to: '/about', icon: 'flag' },
];

export function DesktopNavPanel({ onClose }: Props): React.ReactElement {
  const navigate = useNavigate();
  const handleClick = (to: string) => {
    navigate(to);
    onClose();
  };

  return (
    <div className="biof3-desktop-panel biof3-nav-panel">
      <div className="biof3-desktop-panel__header">
        <span className="biof3-desktop-panel__icon">
          <Icon name="sidebar" size={18} />
        </span>
        <div className="biof3-desktop-panel__titles">
          <h2 className="biof3-desktop-panel__title">导航</h2>
        </div>
        <button
          type="button"
          className="biof3-desktop-panel__close"
          onClick={onClose}
          aria-label="关闭"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="biof3-desktop-panel__body">
        <nav className="biof3-nav-list">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.to}
              type="button"
              className="biof3-nav-item"
              onClick={() => handleClick(item.to)}
              title={item.label}
            >
              <span className="biof3-nav-item__icon">
                <Icon name={item.icon} size={18} />
              </span>
              <span className="biof3-nav-item__label">{item.label}</span>
              <Icon name="arrow-right" size={14} className="biof3-nav-item__arrow" />
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

export default DesktopNavPanel;
