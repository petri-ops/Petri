/**
 * DesktopToolbar — 桌面版左侧活动栏 + 工作区面板（Vite SPA 版）
 *
 * 从 Docusaurus 版移植，改动：
 * - useLocation 从 @docusaurus/router → react-router-dom
 * - 去掉 IS_DESKTOP 短路（整个 SPA 就是桌面版）
 * - 去掉 UserMenu / DesktopSearchPanel（依赖 Docusaurus，阶段 1 后补）
 * - 保留 dock + nav/settings/plugins/onboarding 面板
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/icons/Icon';
import { DesktopSettingsPanel } from './DesktopSettingsPanel';
import { PluginStorePanel } from './PluginStorePanel';
import { DesktopNavPanel } from './DesktopNavPanel';
import './desktop.css';

// 各面板宽度区间（px）。拖拽右边缘手柄在此范围内调整。
type ResizablePanel = Exclude<PanelKind, null>;
const PANEL_WIDTH_CONFIG: Record<ResizablePanel, { min: number; max: number; default: number }> = {
  search: { min: 320, max: 720, default: 360 },
  nav: { min: 300, max: 600, default: 360 },
  settings: { min: 360, max: 760, default: 380 },
  plugins: { min: 520, max: 1600, default: 960 },
  user: { min: 380, max: 640, default: 420 },
};

const PANEL_WIDTHS_KEY = 'biof3-panel-widths';

function readPanelWidths(): Record<ResizablePanel, number> {
  const defaults = Object.fromEntries(
    (Object.keys(PANEL_WIDTH_CONFIG) as ResizablePanel[]).map((k) => [
      k,
      PANEL_WIDTH_CONFIG[k].default,
    ])
  ) as Record<ResizablePanel, number>;
  try {
    const raw = localStorage.getItem(PANEL_WIDTHS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    for (const key of Object.keys(PANEL_WIDTH_CONFIG) as ResizablePanel[]) {
      const v = Number(parsed[key]);
      if (Number.isFinite(v)) {
        const cfg = PANEL_WIDTH_CONFIG[key];
        defaults[key] = Math.min(cfg.max, Math.max(cfg.min, v));
      }
    }
    return defaults;
  } catch {
    return defaults;
  }
}

type PanelKind = 'settings' | 'plugins' | 'nav' | 'search' | 'user' | null;

interface DockItemConfig {
  id: string;
  kind: PanelKind;
  icon: IconName;
  label: string;
  // 有 to：点一次直接跳转（高频入口）；无 to：走 kind 伞面板（设置/插件等低频）
  to?: string;
  // 路由前缀匹配（用于 active 高亮，如 /docs 匹配 /docs/intro）
  matchPrefix?: string;
}

// 高频页面直接上 dock，点一次到位；设置/插件为伞按钮（低频，弹面板）
const DEFAULT_DOCK_ORDER: DockItemConfig[] = [
  { id: 'home', kind: null, icon: 'book-marked', label: '首页', to: '/', matchPrefix: '/' },
  {
    id: 'tools',
    kind: null,
    icon: 'bar-chart',
    label: '分析工具',
    to: '/tools',
    matchPrefix: '/tools',
  },
  {
    id: 'single-cell',
    kind: null,
    icon: 'dna',
    label: '单细胞',
    to: '/single-cell',
    matchPrefix: '/single-cell',
  },
  {
    id: 'spatial',
    kind: null,
    icon: 'sparkles',
    label: '空间组学',
    to: '/spatial',
    matchPrefix: '/spatial',
  },
  {
    id: 'figcode',
    kind: null,
    icon: 'image',
    label: 'FigCode',
    to: '/figcode',
    matchPrefix: '/figcode',
  },
  {
    id: 'skills',
    kind: null,
    icon: 'study',
    label: 'Skills 库',
    to: '/skills',
    matchPrefix: '/skills',
  },
  {
    id: 'algorithms',
    kind: null,
    icon: 'brain',
    label: '算法卡片',
    to: '/algorithms',
    matchPrefix: '/algorithms',
  },
  { id: 'settings', kind: 'settings', icon: 'settings', label: '设置' },
  { id: 'plugins', kind: 'plugins', icon: 'puzzle', label: '插件商店' },
];

const DOCK_ORDER_KEY = 'biof3-dock-order';

function readDockOrder(): DockItemConfig[] {
  try {
    const raw = localStorage.getItem(DOCK_ORDER_KEY);
    if (!raw) return DEFAULT_DOCK_ORDER;
    const ids: string[] = JSON.parse(raw);
    if (!Array.isArray(ids) || ids.length === 0) return DEFAULT_DOCK_ORDER;
    const map = new Map(DEFAULT_DOCK_ORDER.map((i) => [i.id, i]));
    const ordered = ids.map((id) => map.get(id)).filter(Boolean) as DockItemConfig[];
    const missing = DEFAULT_DOCK_ORDER.filter((i) => !ids.includes(i.id));
    return [...ordered, ...missing];
  } catch {
    return DEFAULT_DOCK_ORDER;
  }
}

const THEME_STORAGE_KEY = 'biof3-theme';

function DesktopToolbarInner(): React.ReactElement {
  const [activePanel, setActivePanel] = useState<PanelKind>(null);
  const [panelWidths, setPanelWidths] = useState<Record<ResizablePanel, number>>(readPanelWidths);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [dockOrder, setDockOrder] = useState<DockItemConfig[]>(readDockOrder);
  const [colorMode, setColorMode] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {}
    return 'light';
  });

  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;
  const isProjectWorkspace = currentPath.startsWith('/project/');

  // dock 项是否处于 active：直接跳转类看路由前缀，伞类看 activePanel
  const isDockActive = (item: DockItemConfig): boolean => {
    if (item.kind) return activePanel === item.kind;
    if (item.to === '/') return currentPath === '/';
    return item.matchPrefix ? currentPath.startsWith(item.matchPrefix) : false;
  };

  // 跟随系统主题
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (!localStorage.getItem(THEME_STORAGE_KEY)) {
        const sys = mql.matches ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', sys);
        setColorMode(sys);
      }
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // 应用主题
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', colorMode);
  }, [colorMode]);

  // dock 收缩
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('biof3-desktop');
    html.classList.remove('biof3-desktop-dock-collapsed');
    document.body.style.paddingLeft = '0';
    document.body.style.boxSizing = 'border-box';
  }, [dockCollapsed, isProjectWorkspace]);

  // 拖拽排序状态
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const resizingRef = useRef(false);
  const resizeKindRef = useRef<ResizablePanel | null>(null);
  const startXRef = useRef(0);
  const startWRef = useRef(0);

  const togglePanel = (kind: PanelKind) => {
    setActivePanel((prev) => (prev === kind ? null : kind));
  };

  const onResizeStart = useCallback(
    (e: React.MouseEvent, kind: ResizablePanel) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = true;
      resizeKindRef.current = kind;
      startXRef.current = e.clientX;
      startWRef.current = panelWidths[kind];
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [panelWidths]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current || !resizeKindRef.current) return;
      const kind = resizeKindRef.current;
      const dx = e.clientX - startXRef.current;
      const cfg = PANEL_WIDTH_CONFIG[kind];
      const newW = Math.min(cfg.max, Math.max(cfg.min, startWRef.current + dx));
      setPanelWidths((prev) => ({ ...prev, [kind]: newW }));
    };
    const onUp = () => {
      if (resizingRef.current) {
        resizingRef.current = false;
        resizeKindRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try {
          localStorage.setItem(PANEL_WIDTHS_KEY, JSON.stringify(panelWidths));
        } catch {}
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [panelWidths]);

  // ESC 关闭
  useEffect(() => {
    if (!activePanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActivePanel(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activePanel]);

  // 点击外部关闭
  useEffect(() => {
    if (!activePanel) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const dock = document.querySelector('.biof3-desktop-dock');
      const insideDock = dock && dock.contains(target);
      const workareas = document.querySelectorAll('.biof3-desktop-workarea');
      let insideWorkarea = false;
      workareas.forEach((w) => {
        if (w.contains(target)) insideWorkarea = true;
      });
      if (!insideDock && !insideWorkarea) {
        setActivePanel(null);
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', onClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onClick);
    };
  }, [activePanel]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (draggingId && draggingId !== id) setDragOverId(id);
  };
  const handleDrop = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (!draggingId || draggingId === id) return;
    const order = [...dockOrder];
    const fromIdx = order.findIndex((i) => i.id === draggingId);
    const toIdx = order.findIndex((i) => i.id === id);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = order.splice(fromIdx, 1);
    order.splice(toIdx, 0, moved);
    setDockOrder(order);
    try {
      localStorage.setItem(DOCK_ORDER_KEY, JSON.stringify(order.map((i) => i.id)));
    } catch {}
  };
  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverId(null);
  };

  const toggleTheme = () => {
    const next = colorMode === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    setColorMode(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {}
  };

  if (isProjectWorkspace) return <></>;

  return (
    <>
      <div className={`biof3-desktop-dock ${dockCollapsed ? 'biof3-desktop-dock--collapsed' : ''}`}>
        <div className="biof3-desktop-dock__bar">
          {dockOrder.map((item) => {
            const isDragging = draggingId === item.id;
            const isOver = dragOverId === item.id;
            return (
              <div
                key={item.id}
                className={`biof3-desktop-dock__draggable ${isDragging ? 'dragging' : ''} ${isOver ? 'drag-over' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, item.id)}
                onDragOver={(e) => handleDragOver(e, item.id)}
                onDrop={(e) => handleDrop(e, item.id)}
                onDragEnd={handleDragEnd}
              >
                <button
                  ref={(el) => {
                    itemRefs.current[item.id] = el;
                  }}
                  type="button"
                  className={`biof3-desktop-dock__btn ${isDockActive(item) ? 'active' : ''}`}
                  onClick={() => {
                    if (item.to) {
                      navigate(item.to);
                      setActivePanel(null); // 跳转时关掉任何打开的伞面板
                    } else if (item.kind) {
                      togglePanel(item.kind);
                    }
                  }}
                  aria-label={item.label}
                  title={item.label}
                >
                  <Icon name={item.icon} size={22} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="biof3-desktop-dock__footer">
          <button
            type="button"
            className="biof3-desktop-dock__btn biof3-desktop-dock__theme-toggle"
            onClick={toggleTheme}
            aria-label={colorMode === 'dark' ? '切换到浅色' : '切换到深色'}
            title={colorMode === 'dark' ? '切换到浅色' : '切换到深色'}
          >
            <Icon name={colorMode === 'dark' ? 'sun' : 'moon'} size={22} />
          </button>
          <button
            type="button"
            className="biof3-desktop-dock__toggle"
            onClick={() => setDockCollapsed((c) => !c)}
            aria-label={dockCollapsed ? '展开' : '收缩'}
            title={dockCollapsed ? '展开' : '收缩'}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>{dockCollapsed ? '›' : '‹'}</span>
          </button>
        </div>
      </div>

      {activePanel === 'nav' && (
        <div
          className="biof3-desktop-workarea biof3-desktop-workarea--narrow"
          style={{ width: `${panelWidths.nav}px` }}
        >
          <DesktopNavPanel onClose={() => setActivePanel(null)} />
          <div
            className="biof3-desktop-workarea__resize-handle"
            onMouseDown={(e) => onResizeStart(e, 'nav')}
            aria-hidden="true"
          />
        </div>
      )}
      {activePanel === 'settings' && (
        <div
          className="biof3-desktop-workarea biof3-desktop-workarea--narrow"
          style={{ width: `${panelWidths.settings}px` }}
        >
          <DesktopSettingsPanel onClose={() => setActivePanel(null)} />
          <div
            className="biof3-desktop-workarea__resize-handle"
            onMouseDown={(e) => onResizeStart(e, 'settings')}
            aria-hidden="true"
          />
        </div>
      )}
      {activePanel === 'plugins' && (
        <div
          className="biof3-desktop-workarea biof3-desktop-workarea--xwide"
          style={{ width: `${panelWidths.plugins}px` }}
        >
          <PluginStorePanel onClose={() => setActivePanel(null)} />
          <div
            className="biof3-desktop-workarea__resize-handle"
            onMouseDown={(e) => onResizeStart(e, 'plugins')}
            aria-hidden="true"
          />
        </div>
      )}
    </>
  );
}

export function DesktopToolbar(): React.ReactElement {
  return <DesktopToolbarInner />;
}

export default DesktopToolbar;
