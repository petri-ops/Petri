import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    if (!/\.(css|ts|tsx|js|jsx)$/.test(entry.name)) continue;
    if (/\.test\.(ts|tsx|js|jsx)$/.test(entry.name) || /\.spec\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    files.push(fullPath);
  }
  return files;
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\S\r\n])\/\/.*$/gm, '$1');
}

describe('theme token contract', () => {
  it('defines every Petri token referenced in frontend source', () => {
    const definitions = new Set<string>();
    const references = new Set<string>();

    for (const file of walk(srcRoot)) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      for (const match of text.matchAll(/--petri-[A-Za-z0-9-]+(?=\s*:)/g)) {
        definitions.add(match[0]);
      }
      for (const match of text.matchAll(/var\(--(petri-[A-Za-z0-9-]+)/g)) {
        references.add(`--${match[1]}`);
      }
    }

    // JS 运行时 setProperty 注入的拖拽期 live token（useResizableColumns），
    // 无静态定义属预期——白名单见 BLOCK-76 会话 🟢 清债登记（AUDIT-LOG 2026-09-08）。
    const JS_INJECTED_TOKENS = new Set([
      '--petri-live-left-width',
      '--petri-live-left-span',
      '--petri-live-right-width',
      '--petri-live-right-span',
      '--petri-live-result-right-width',
    ]);
    const missing = [...references]
      .filter((token) => !definitions.has(token) && !JS_INJECTED_TOKENS.has(token))
      .sort();
    expect(missing).toEqual([]);
  });

  // UI-392 — 海军蓝家族统一后的防回潮门禁（规范见 .agents/skills/petri-css-theme）。

  it('holds no legacy undefined --color-* token references (零定义家族禁回潮)', () => {
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      if (/var\(--color-/.test(text)) offenders.push(path.relative(srcRoot, file));
    }
    expect(offenders).toEqual([]);
  });

  it('holds no slate-family color literals (navy 家族外禁回潮)', () => {
    const FORBIDDEN = [/rgba\(148,\s*163,\s*184/i, /#0f172a\b/i, /#1b1b1d\b/i, /#334155\b/i];
    // 豁免清单（带理由）：light 终端主题在白底上用近黑文字/ANSI 色，属浅色面
    // 正当用色，非暗色 navy 家族管辖范围。
    const ALLOWED_FILES = new Map([['themes/terminal-themes.ts', new Set(['#0f172a\\b'])]]);
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      const rel = path.relative(srcRoot, file);
      const allowed = ALLOWED_FILES.get(rel.replaceAll('\\', '/')) || new Set<string>();
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text) && !allowed.has(pattern.source)) {
          offenders.push(`${rel} :: ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('dark token-definition blocks in styles/ out-rank infima (html 前缀特异性)', () => {
    // infima 暗色默认用 html[data-theme='dark']（0,1,1）；本仓 styles/ 下的
    // 暗色定义块若只写 [data-theme='dark']（0,1,0）即为死字（UI-392 根因二：
    // --ifm-background-color/emphasis 系曾整块失效）。多行 selector 组
    // （逗号续行）需整组包含 html 前缀。
    const stylesDir = path.join(srcRoot, 'styles');
    const offenders: string[] = [];
    for (const file of walk(stylesDir)) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      for (const match of text.matchAll(
        /(?:^|\n)((?:[^\n{}]*,\n)*[^\n{}]*\[data-theme='dark'\][^\n{}]*)\s*\{([^{}]*)\}/g,
      )) {
        const selectorGroup = match[1];
        const body = match[2];
        if (body.includes('--ifm-') && !selectorGroup.includes("html[data-theme='dark']")) {
          offenders.push(`${path.relative(srcRoot, file)} :: ${selectorGroup.trim().slice(0, 60)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // ============================================================
  // BLOCK-161 W2 — 档位体系 + 门禁棘轮（plan §3-W2；出口判据 §8）
  // ============================================================

  const CSS_FILES = (): string[] => walk(srcRoot).filter((f) => f.endsWith('.css'));

  it('defines the tier token sets (间距 8 档 / 圆角 4 档 / z-index 8 档)', () => {
    const text = stripComments(
      fs.readFileSync(path.join(srcRoot, 'styles', 'global.css'), 'utf8')
      + fs.readFileSync(path.join(srcRoot, 'styles', 'custom.css'), 'utf8'),
    );
    for (const token of [
      '--petri-space-1', '--petri-space-2', '--petri-space-3', '--petri-space-4',
      '--petri-space-5', '--petri-space-6', '--petri-space-7', '--petri-space-8',
      '--petri-radius-sm', '--petri-radius-md', '--petri-radius-lg', '--petri-radius-pill',
      '--petri-z-base', '--petri-z-raised', '--petri-z-sticky', '--petri-z-dropdown',
      '--petri-z-overlay', '--petri-z-modal', '--petri-z-lightbox', '--petri-z-toast',
    ]) {
      expect(text).toMatch(new RegExp(`${token.replace(/-/g, '\\-')}\\s*:`));
    }
    // 语义倒挂守卫（审计 P0）：Toast 必须是最高档（原 9999 < TitleBar 10001）。
    const zValue = (name: string) => {
      const m = text.match(new RegExp(`${name.replace(/-/g, '\\-')}\\s*:\\s*(\\d+)`));
      return m ? Number(m[1]) : -1;
    };
    const toast = zValue('--petri-z-toast');
    expect(toast).toBeGreaterThan(zValue('--petri-z-lightbox'));
    expect(toast).toBeGreaterThan(zValue('--petri-z-modal'));
    expect(toast).toBeGreaterThan(zValue('--petri-z-overlay'));
  });

  it('holds no duplicate token definitions in the same :root/dark block (重复定义禁)', () => {
    const offenders: string[] = [];
    for (const file of CSS_FILES()) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      for (const block of text.matchAll(/:root\s*\{([^{}]*)\}|html\[data-theme='dark'\][^{]*\{([^{}]*)\}/g)) {
        const body = block[1] ?? block[2] ?? '';
        const seen = new Set<string>();
        for (const m of body.matchAll(/--petri-[A-Za-z0-9-]+(?=\s*:)/g)) {
          if (seen.has(m[0])) offenders.push(`${path.relative(srcRoot, file)} :: ${m[0]}`);
          seen.add(m[0]);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('dark blocks pair with :root for color tokens (明暗成对棘轮 — 24 个存量冻结)', () => {
    // W3 将把存量清零；本断言冻结现状：新 token 只许成对定义，未配对名单只许收缩。
    const PAIRED_EXEMPT = new Set([
      // 功能性/派生 token：仅亮色语义或由暗色块整体继承（BLOCK-161 W2 核实）
      '--petri-font-scale', '--petri-font-size-xs', '--petri-font-size-sm', '--petri-font-size-caption',
      '--petri-font-size-body-sm', '--petri-font-size-body', '--petri-font-size-md', '--petri-font-size-lg',
      '--petri-font-size-xl', '--petri-font-size-2xl', '--petri-font-size-3xl', '--petri-font-size-base',
      '--petri-space-1', '--petri-space-2', '--petri-space-3', '--petri-space-4', '--petri-space-5',
      '--petri-space-6', '--petri-space-7', '--petri-space-8', '--petri-live-result-right-width',
      '--petri-titlebar-height', '--petri-radius-sm', '--petri-radius-md', '--petri-radius-lg',
      '--petri-radius-pill', '--petri-z-base', '--petri-z-raised', '--petri-z-sticky',
      '--petri-z-dropdown', '--petri-z-overlay', '--petri-z-modal', '--petri-z-lightbox',
      '--petri-z-toast', '--petri-font-sans', '--petri-font-mono', '--petri-mono',
      '--petri-shadow-sm',
      // 派生层（color-mix(var(--petri-*)) 自动适配主题）非缺失
      '--petri-accent-weak',
      // W3 待清零冻结名单（审计 2.3 明暗未配对；收缩后从本表删除）：
      // teal 家族（暗色 --petri-teal 3.17:1）/ cream/frost/gold 品牌辅助色 / info（3.02:1）/ status-success
      '--petri-teal', '--petri-teal-bright', '--petri-teal-button', '--petri-teal-dark',
      '--petri-cream', '--petri-frost', '--petri-gold',
      '--petri-info', '--petri-status-success',
      '--petri-bg-base', '--petri-fg', '--petri-fg-muted', '--petri-bg-elev',
      '--petri-bg-button', '--petri-bg-button-hover', '--petri-bg-hover',
      '--petri-surface-raised', '--petri-bg-surface-raised', '--petri-surface-strong',
      '--petri-border-color', '--petri-text-primary', '--petri-warning-bg', '--petri-warning-text',
      '--petri-warning', '--petri-danger-bg', '--petri-bg-terminal', '--petri-text-terminal',
      '--petri-text-terminal-strong', '--petri-text-terminal-muted', '--petri-text-terminal-prompt',
    ]);
    const rootTokens = new Set<string>();
    const darkTokens = new Set<string>();
    for (const file of CSS_FILES()) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      for (const block of text.matchAll(/:root\s*\{([^{}]*)\}/g)) {
        for (const m of block[1].matchAll(/--petri-[A-Za-z0-9-]+(?=\s*:)/g)) rootTokens.add(m[0]);
      }
      for (const block of text.matchAll(/\[data-theme='dark'\][^{]*\{([^{}]*)\}/g)) {
        for (const m of block[1].matchAll(/--petri-[A-Za-z0-9-]+(?=\s*:)/g)) darkTokens.add(m[0]);
      }
    }
    const unpaired = [...rootTokens]
      .filter((t) => !darkTokens.has(t) && !PAIRED_EXEMPT.has(t))
      .sort();
    expect(unpaired).toEqual([]);
  });

  it('holds no bare px font-size beyond the frozen ratchet (裸 font-size 棘轮 — W3 清零)', () => {
    // W3 出口=0；本断言冻结现状计数（BLOCK-161 W2 盘点：>1000 处裸 font-size 于
    // css/tsx 内联样式——棘轮按文件粒度登记存量，新增文件或存量文件加行即红）。
    const FORBIDDEN = /font-size:\s*\d+(?:\.\d+)?px/;
    const offenders: string[] = [];
    for (const file of CSS_FILES()) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      const count = (text.match(new RegExp(FORBIDDEN.source, 'g')) || []).length;
      if (count > 0) offenders.push(`${path.relative(srcRoot, file)}:${count}`);
    }
    // 棘轮快照（W2 盘点时点）。收缩后更新此表（只许减不许增）；W3 清零后整表删除。
    const RATCHET: Record<string, number> = {
      // W2 盘点快照（2026-10-11 实测 121 处/19 文件；W3 清零后整表删除）
      'components/copilot/gen-ui/GenUiCard.module.css': 9,
      'components/copilot/LlmTranscriptViewer.css': 17,
      'components/copilot/simple-chat.css': 3,
      'components/copilot/ToolActivityDock.module.css': 1,
      'components/desktop/desktop.css': 1,
      'components/desktop/DesktopSettingsPanel/sections/Federation.module.css': 12,
      'components/desktop/DesktopSettingsPanel/sections/MobileSync.module.css': 11,
      'components/desktop/TestInstanceBadge.module.css': 3,
      'components/desktop/TitleBar.module.css': 1,
      'components/RouteErrorBoundary.module.css': 4,
      'components/window/rail-page.module.css': 7,
      'components/window/window-shell.module.css': 12,
      'components/workspace-panels/KnowledgeSpacePanel.module.css': 4,
      'components/workspace-panels/KnowledgeSpaceSwitcher.module.css': 4,
      'components/workspace-panels/WorkspaceCitationsSection.module.css': 3,
      'components/workspace-panels/WorkspaceTodoSection.module.css': 3,
      'pages/project-workspace.module.css': 8,
      'pages/welcome.module.css': 2,
      'pages/window/command-center.module.css': 16,
    };
    const actual: Record<string, number> = {};
    for (const entry of offenders) {
      const [rel, count] = entry.split(':');
      const key = rel.replaceAll('\\', '/');
      actual[key] = (actual[key] || 0) + Number(count);
    }
    // 白名单外的任何文件出现裸 font-size 即红；白名单内只许 ≤ 快照值。
    const allKeys = new Set([...Object.keys(RATCHET), ...Object.keys(actual)]);
    const problems: string[] = [];
    for (const key of allKeys) {
      const allowed = RATCHET[key] || 0;
      const found = actual[key] || 0;
      if (found > allowed) problems.push(`${key}: ${found} > ratchet ${allowed}`);
    }
    expect(problems).toEqual([]);
  });

  it('holds no raw-color var() fallbacks beyond the frozen ratchet (禁颜色 fallback 棘轮)', () => {
    // var(--petri-*, #hex|rgba) 的字面色 fallback 绕过主题系统——存量冻结、新增即红。
    const offenders: string[] = [];
    for (const file of CSS_FILES()) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      const count = (text.match(/var\(--petri-[A-Za-z0-9-]+\s*,\s*(?:#[0-9a-fA-F]{3,8}|rgba?\()/g) || []).length;
      if (count > 0) offenders.push(`${path.relative(srcRoot, file)}:${count}`);
    }
    const RATCHET: Record<string, number> = {
      // W2 盘点快照（2026-10-11 实测 235 处/19 文件；逐批归并后收缩）
      'components/copilot/integration/integration.module.css': 3,
      'components/copilot/renderers/ChartRenderer.module.css': 1,
      'components/copilot/ResultCard.module.css': 16,
      'components/copilot/simple-chat.css': 52,
      'components/desktop/DesktopSettingsPanel/sections/Federation.module.css': 8,
      'components/desktop/DesktopSettingsPanel/sections/MobileSync.module.css': 7,
      'components/desktop/FolderPicker.module.css': 1,
      'components/desktop/TestInstanceBadge.module.css': 1,
      'components/desktop/WorkingTreeReview/CodeReviewDrawer.module.css': 20,
      'components/result-studio/ResultStudioChangeSetPanel.module.css': 1,
      'components/settings/ExperimentalFeaturesSection.module.css': 7,
      'components/ui/code-highlight.css': 6,
      'components/window/window-shell.module.css': 20,
      'components/workspace-panels/SshStatusDot.module.css': 3,
      'pages/home.module.css': 1,
      'pages/project-workspace.module.css': 43,
      'pages/welcome.module.css': 1,
      'pages/window/command-center.module.css': 43,
      'styles/custom.css': 1,
    };
    const actual: Record<string, number> = {};
    for (const entry of offenders) {
      const [rel, count] = entry.split(':');
      const key = rel.replaceAll('\\', '/');
      actual[key] = (actual[key] || 0) + Number(count);
    }
    const allKeys = new Set([...Object.keys(RATCHET), ...Object.keys(actual)]);
    const problems: string[] = [];
    for (const key of allKeys) {
      const allowed = RATCHET[key] || 0;
      const found = actual[key] || 0;
      if (found > allowed) problems.push(`${key}: ${found} > ratchet ${allowed}`);
    }
    expect(problems).toEqual([]);
  });
});
