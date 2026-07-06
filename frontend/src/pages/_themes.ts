/**
 * SCI journal color presets for FigCode online plotting.
 *
 * Each preset defines a discrete palette; when a theme is applied,
 * hex colors in the code are remapped in the order they first appear
 * so the same original color always maps to the same theme color.
 */

export interface FigTheme {
  id: string;
  name: string;
  journal: string;
  description: string;
  palette: string[];
  ggplotTheme: string; // ggplot2 theme function suggestion
}

export interface LayoutTheme {
  id: string;
  name: string;
  description: string;
  /** Code snippet to append/replace theme_xxx() call */
  themeCode: string;
  /** Extra ggplot2 theme() overrides */
  themeOverrides: string;
  /**
   * Recommended plot params for this layout. RunModal applies these as the
   * baseline when user switches layout, so font/point/line scale together
   * (instead of overriding only base_size and leaving points tiny).
   */
  recommended: {
    baseSize: number; // ggplot2 base_size (= text size)
    pointSize: number; // geom_point() size
    lineWidth: number; // geom_line() linewidth
    plotWidth: number; // canvas width (px)
    plotHeight: number; // canvas height (px)
  };
}

export const figThemes: FigTheme[] = [
  {
    id: 'default',
    name: 'BioF3',
    journal: '通用',
    description: '清爽的红蓝配色，适合大多数展示场景',
    palette: [
      '#dc2626',
      '#2563eb',
      '#059669',
      '#d97706',
      '#7c3aed',
      '#475569',
      '#0891b2',
      '#be185d',
    ],
    ggplotTheme: 'theme_classic()',
  },
  {
    id: 'npg',
    name: 'Nature',
    journal: 'Nature Publishing Group',
    description: 'NPG 经典十色，ggsci::pal_npg 同款',
    palette: [
      '#E64B35',
      '#4DBBD5',
      '#00A087',
      '#3C5488',
      '#F39B7F',
      '#8491B4',
      '#91D1C2',
      '#7E6148',
    ],
    ggplotTheme: 'theme_classic(base_size = 12)',
  },
  {
    id: 'aaas',
    name: 'Science',
    journal: 'AAAS / Science',
    description: '深紫红蓝配色，严谨稳重',
    palette: [
      '#3B4992',
      '#EE0000',
      '#008B45',
      '#631879',
      '#008280',
      '#BB0021',
      '#5F559B',
      '#A20056',
    ],
    ggplotTheme: 'theme_bw()',
  },
  {
    id: 'nejm',
    name: 'NEJM',
    journal: 'New England Journal of Medicine',
    description: '温和对比色，适合临床类图表',
    palette: [
      '#BC3C29',
      '#0072B5',
      '#E18727',
      '#20854E',
      '#7876B1',
      '#6F99AD',
      '#FFDC91',
      '#EE4C97',
    ],
    ggplotTheme: 'theme_classic()',
  },
  {
    id: 'lancet',
    name: 'Lancet',
    journal: 'The Lancet',
    description: '明快分明的期刊同款配色',
    palette: [
      '#00468B',
      '#ED0000',
      '#42B540',
      '#0099B4',
      '#925E9F',
      '#FDAF91',
      '#AD002A',
      '#ADB6B6',
    ],
    ggplotTheme: 'theme_classic()',
  },
  {
    id: 'jco',
    name: 'JCO',
    journal: 'Journal of Clinical Oncology',
    description: '低饱和灰蓝色调，柔和耐看',
    palette: [
      '#0073C2',
      '#EFC000',
      '#868686',
      '#CD534C',
      '#7AA6DC',
      '#003C67',
      '#8F7700',
      '#3B3B3B',
    ],
    ggplotTheme: 'theme_bw()',
  },
];

export const layoutThemes: LayoutTheme[] = [
  {
    id: 'classic',
    name: '经典',
    description: '白底无网格，SCI 最常用 (单栏 800×600)',
    themeCode: 'theme_classic()',
    themeOverrides: '',
    recommended: { baseSize: 11, pointSize: 1.5, lineWidth: 0.6, plotWidth: 800, plotHeight: 600 },
  },
  {
    id: 'minimal',
    name: '极简',
    description: '无边框无刻度线，干净利落',
    themeCode: 'theme_minimal()',
    themeOverrides: `theme(
    panel.grid.minor = element_blank(),
    axis.line = element_line(linewidth = 0.3))`,
    recommended: { baseSize: 11, pointSize: 1.5, lineWidth: 0.5, plotWidth: 800, plotHeight: 600 },
  },
  {
    id: 'publication',
    name: '出版级',
    description: '加粗轴标题、字号 13，适合直接投稿 (单栏 1000×750)',
    themeCode: 'theme_classic(base_size = 13)',
    themeOverrides: `theme(
    axis.title = element_text(face = "bold"),
    plot.title = element_text(face = "bold", hjust = 0.5),
    legend.position = "bottom")`,
    recommended: { baseSize: 13, pointSize: 2.0, lineWidth: 0.8, plotWidth: 1000, plotHeight: 750 },
  },
  {
    id: 'presentation',
    name: '演示',
    description: '大字号 16 + 大画布 1200×900，适合 PPT / 海报',
    themeCode: 'theme_classic(base_size = 16)',
    themeOverrides: `theme(
    axis.title = element_text(face = "bold", size = 18),
    plot.title = element_text(face = "bold", size = 22, hjust = 0.5),
    legend.text = element_text(size = 14),
    legend.title = element_text(size = 14, face = "bold"))`,
    recommended: { baseSize: 16, pointSize: 3.0, lineWidth: 1.2, plotWidth: 1200, plotHeight: 900 },
  },
  {
    id: 'dark',
    name: '暗色',
    description: '深色背景，适合屏幕展示',
    themeCode: 'theme_dark()',
    themeOverrides: `theme(
    panel.background = element_rect(fill = "#1e293b"),
    plot.background = element_rect(fill = "#0f172a", color = NA),
    text = element_text(color = "#e2e8f0"),
    axis.text = element_text(color = "#94a3b8"),
    legend.background = element_rect(fill = "#1e293b"))`,
    recommended: { baseSize: 12, pointSize: 1.8, lineWidth: 0.7, plotWidth: 900, plotHeight: 700 },
  },
];

/**
 * Apply a theme to R code by remapping hex colors and ggplot theme function.
 *
 * Strategy:
 *  1. Extract all unique hex colors from the source code, in order of first appearance
 *  2. Map each to a color from the theme palette (cycling if more colors than palette)
 *  3. Replace occurrences in code
 *  4. Swap ggplot theme function if present
 *  5. Prepend a marker comment so users know which theme is active
 */
export function applyTheme(baseCode: string, themeId: string): string {
  const theme = figThemes.find((t) => t.id === themeId);
  if (!theme || theme.id === 'default') {
    // For default, return base code as-is (with marker removed)
    return stripThemeMarker(baseCode);
  }

  const stripped = stripThemeMarker(baseCode);

  // 1. Collect unique hex colors
  const hexRegex = /#[0-9a-fA-F]{6}\b/g;
  const seen = new Set<string>();
  const order: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = hexRegex.exec(stripped))) {
    const c = m[0].toUpperCase();
    if (!seen.has(c)) {
      seen.add(c);
      order.push(c);
    }
  }

  // 2. Build mapping: preserve neutral greys (detect low saturation)
  const mapping = new Map<string, string>();
  let paletteIdx = 0;
  for (const orig of order) {
    if (isNeutralGrey(orig)) {
      mapping.set(orig, orig); // keep greys
    } else {
      mapping.set(orig, theme.palette[paletteIdx % theme.palette.length]);
      paletteIdx++;
    }
  }

  // 3. Replace colors (case-insensitive)
  let code = stripped.replace(/#[0-9a-fA-F]{6}\b/g, (match) => {
    const upper = match.toUpperCase();
    return mapping.get(upper) ?? match;
  });

  // 4. Swap top-level ggplot theme if present
  const themeFns = /theme_(?:classic|bw|minimal|light|void|dark|gray)\s*\([^)]*\)/g;
  code = code.replace(themeFns, theme.ggplotTheme);

  // 5. Prepend marker
  return `# Theme preset: ${theme.name} (${theme.journal})\n\n${code}`;
}

function stripThemeMarker(code: string): string {
  return code.replace(/^# Theme preset:.*\n\n?/m, '');
}

function isNeutralGrey(hex: string): boolean {
  // Consider a color neutral if R, G, B are close (covers pure greys and near-grey blue-greys like #9ca3af)
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min <= 24;
}

/**
 * Apply a layout/template theme to R code.
 * Replaces the ggplot theme_xxx() call and appends theme() overrides.
 */
export function applyLayoutTheme(code: string, layoutId: string): string {
  const layout = layoutThemes.find((t) => t.id === layoutId);
  if (!layout || layout.id === 'classic') {
    // classic = just theme_classic(), strip any layout marker
    return stripLayoutMarker(code);
  }

  let result = stripLayoutMarker(code);

  // Replace theme_xxx(...) calls
  const themeFns = /theme_(?:classic|bw|minimal|light|void|dark|gray)\s*\([^)]*\)/g;
  result = result.replace(themeFns, layout.themeCode);

  // Append theme overrides if present (add after last line with + continuation or at end)
  if (layout.themeOverrides) {
    // Find last ggplot chain: look for the last "theme_xxx()" we just inserted
    const lastThemeIdx = result.lastIndexOf(layout.themeCode);
    if (lastThemeIdx !== -1) {
      const insertPos = lastThemeIdx + layout.themeCode.length;
      result =
        result.slice(0, insertPos) + ' +\n  ' + layout.themeOverrides + result.slice(insertPos);
    }
  }

  return `# Layout: ${layout.name}\n${result}`;
}

function stripLayoutMarker(code: string): string {
  return code.replace(/^# Layout:.*\n/m, '');
}

/**
 * Combined: apply both color theme and layout theme.
 */
export function applyBothThemes(
  baseCode: string,
  colorThemeId: string,
  layoutThemeId: string
): string {
  let code = applyTheme(baseCode, colorThemeId);
  code = applyLayoutTheme(code, layoutThemeId);
  return code;
}

/**
 * Get content-aware recommended params for a card.
 *
 * Combines layout theme defaults (presentation / publication / classic / ...) with
 * the card's own figLayout hint (compact / default / complex / wide). The card hint
 * scales canvas + adjusts pointSize for content density:
 *
 *  compact: smaller canvas, slightly smaller text (single-panel scatter / bar)
 *  default: theme defaults
 *  complex: bigger canvas + smaller text/points (heatmap / dotplot of 50 items)
 *  wide:    wider canvas, normal proportions (time series / chord diagram)
 *
 * RunModal calls this when user switches layout to seed the param controls
 * with sensible-for-this-card values, instead of always 11/1.5/0.6/800/600.
 */
export function getRecommendedParams(
  layoutThemeId: string,
  figLayout: 'compact' | 'default' | 'complex' | 'wide' = 'default'
): {
  baseSize: number;
  pointSize: number;
  lineWidth: number;
  plotWidth: number;
  plotHeight: number;
} {
  const layout = layoutThemes.find((l) => l.id === layoutThemeId) ?? layoutThemes[0];
  const base = { ...layout.recommended };

  switch (figLayout) {
    case 'compact':
      // Small charts — keep text legible by shrinking canvas, not text
      base.plotWidth = Math.round(base.plotWidth * 0.75);
      base.plotHeight = Math.round(base.plotHeight * 0.75);
      break;
    case 'complex':
      // Heatmap / dotplot — need more room for tick labels, smaller text per element
      base.plotWidth = Math.round(base.plotWidth * 1.25);
      base.plotHeight = Math.round(base.plotHeight * 1.15);
      base.baseSize = Math.max(8, base.baseSize - 2);
      base.pointSize = Math.max(0.8, base.pointSize * 0.7);
      break;
    case 'wide':
      // Time series / chord — wider canvas, same proportions
      base.plotWidth = Math.round(base.plotWidth * 1.4);
      break;
    case 'default':
    default:
      // No adjustment
      break;
  }

  return base;
}
