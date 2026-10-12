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
      // BLOCK-167 W0 — 宪章派生 token：border 三语义引用主题变量按元素解析；
      // duration/ease 为非色功能 token（同 space/z 豁免理由）。
      '--petri-border-input', '--petri-border-card', '--petri-divider',
      '--petri-duration-fast', '--petri-duration-base', '--petri-duration-slow',
      '--petri-ease-standard', '--petri-ease-emphasized',
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
    const RATCHET: Record<string, number> = {}; // W3 已清零（2026-10-11）：121 处全部归档 --petri-font-size-* 档
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

  // ============================================================
  // BLOCK-167 — 产品质感提升（设计宪章用法门禁；docs/design-charter.md §7）
  // 棘轮形态与 BLOCK-161 一致：冻结基线快照，波次收缩时只许下调快照值。
  // 口径=全 CSS 面（module.css + 普通 css），为 plan §3 数字的 canonical 计数器。
  // ============================================================

  const stripCss = (file: string): string => stripComments(fs.readFileSync(file, 'utf8'));

  /** 每文件计数快照（相对 frontend/src 的 posix 路径 → 次数）。 */
  function countPerFile(re: RegExp, transform: (css: string) => string = (css) => css): Record<string, number> {
    const actual: Record<string, number> = {};
    for (const file of CSS_FILES()) {
      const count = (transform(stripCss(file)).match(new RegExp(re.source, 'g')) || []).length;
      if (count > 0) actual[path.relative(srcRoot, file).replaceAll('\\', '/')] = count;
    }
    return actual;
  }

  /** 棘轮对账：actual 超出快照即红；收缩后下调快照（只许减不许增）。 */
  function expectRatchet(ratchet: Record<string, number>, actual: Record<string, number>) {
    const allKeys = new Set([...Object.keys(ratchet), ...Object.keys(actual)]);
    const problems: string[] = [];
    for (const key of allKeys) {
      // 误报豁免：key 来自同两对象的 Object.keys 并集，非外部输入（security/detect-object-injection）。
      // eslint-disable-next-line security/detect-object-injection
      const allowed = ratchet[key] || 0;
      // eslint-disable-next-line security/detect-object-injection
      const found = actual[key] || 0;
      if (found > allowed) problems.push(`${key}: ${found} > ratchet ${allowed}`);
    }
    expect(problems).toEqual([]);
  }

  it('defines charter motion tiers and border semantics (宪章 token 存在性)', () => {
    const text =
      stripCss(path.join(srcRoot, 'styles', 'custom.css'))
      + stripCss(path.join(srcRoot, 'styles', 'global.css'));
    for (const token of [
      '--petri-duration-fast', '--petri-duration-base', '--petri-duration-slow',
      '--petri-ease-standard', '--petri-ease-emphasized',
      '--petri-border-input', '--petri-border-card', '--petri-divider',
    ]) {
      expect(text).toMatch(new RegExp(`${token.replace(/-/g, '\\-')}\\s*:`));
    }
    // duration 档值守卫（宪章 §4：150/200/300ms）
    const duration = (name: string) => {
      const m = text.match(new RegExp(`${name.replace(/-/g, '\\-')}\\s*:\\s*([\\d.]+)ms`));
      return m ? Number(m[1]) : -1;
    };
    expect(duration('--petri-duration-fast')).toBeLessThan(duration('--petri-duration-base'));
    expect(duration('--petri-duration-base')).toBeLessThan(duration('--petri-duration-slow'));
  });

  it('defines ::selection exactly once (选中色全局唯一·accent 派生)', () => {
    const hits: string[] = [];
    for (const file of CSS_FILES()) {
      const count = (stripCss(file).match(/::selection/g) || []).length;
      if (count > 0) hits.push(`${path.relative(srcRoot, file).replaceAll('\\', '/')}:${count}`);
    }
    expect(hits).toEqual(['styles/global.css:1']);
    expect(stripCss(path.join(srcRoot, 'styles', 'global.css'))).toMatch(
      /::selection\s*\{[^}]*var\(--petri-accent\)/,
    );
  });

  it('small font usage holds the frozen ratchet (小字号棘轮 450→W1≤110→终态≤40)', () => {
    // xs(10px)+sm(11px) 引用——宪章 §1：xs 终态仅徽标域；W1 收缩后下调快照。
    const RATCHET: Record<string, number> = {
      'pages/project-workspace.module.css': 125,
      'components/copilot/simple-chat.css': 54,
      'components/workspace-panels/KnowledgeSpacePanel.module.css': 31,
      'components/desktop/WorkingTreeReview/ReviewMode.css': 24,
      'components/result-studio/ResultStudioChangeSetPanel.module.css': 23,
      'components/desktop/desktop.css': 19,
      'pages/extensions/styles.module.css': 15,
      'components/result-studio/ScientificInteractionViewer.module.css': 14,
      'components/result-studio/ResultStudioSurface.module.css': 12,
      'styles/custom.css': 11,
      'components/copilot/renderers/ChartRenderer.module.css': 7,
      'components/result-studio/ResultEditPanel.module.css': 7,
      'components/workspace-panels/WorkspaceFileIcon.module.css': 7,
      'components/desktop/TitleBar.module.css': 6,
      'components/desktop/WorkingTreeReview/WorkingTreeReview.css': 6,
      'components/copilot/LlmTranscriptViewer.css': 5,
      'components/knowledge/KnowledgeConsoleChat.module.css': 5,
      'components/result-studio/CompactResultNavigator.module.css': 5,
      'components/window/rail-page.module.css': 5,
      'pages/window/command-center.module.css': 5,
      'components/copilot/renderers/TableRenderer.module.css': 4,
      'components/desktop/FolderPicker.module.css': 4,
      'components/result-studio/ResultAgentComposer.module.css': 4,
      'pages/home.module.css': 4,
      'components/branch/BranchTabs.module.css': 3,
      'components/copilot/gen-ui/GenUiCard.module.css': 3,
      'components/copilot/renderers/ImageRenderer.module.css': 3,
      'components/desktop/DesktopSettingsPanel/sections/Federation.module.css': 3,
      'components/desktop/DesktopSettingsPanel/sections/MobileSync.module.css': 3,
      'components/desktop/TestInstanceBadge.module.css': 3,
      'components/desktop/WorkingTreeReview/CodeReviewDrawer.module.css': 3,
      'components/result-studio/ContinueAnalysisMenu.module.css': 3,
      'components/workspace-panels/ArtifactPinPane.module.css': 3,
      'components/workspace-panels/SideChatDock.module.css': 3,
      'components/result-studio/LineageGraph.module.css': 2,
      'components/result-studio/LineageStrip.module.css': 2,
      'components/window/window-shell.module.css': 2,
      'components/workspace-panels/WorkspaceCitationsSection.module.css': 2,
      'components/workspace-panels/WorkspaceTodoSection.module.css': 2,
      'components/copilot/ResultCard.module.css': 1,
      'components/knowledge/KnowledgeConsoleDock.module.css': 1,
      'components/result-studio/LineageViewSwitch.module.css': 1,
      'components/result-studio/RevisionCodeView.module.css': 1,
      'components/ui/Lightbox.css': 1,
      'components/ui/WorkbenchEmpty.module.css': 1,
      'components/workspace-panels/KnowledgeSpaceSwitcher.module.css': 1,
      'pages/welcome.module.css': 1,
    };
    expectRatchet(RATCHET, countPerFile(/var\(--petri-font-size-(?:xs|sm)\)/));
  });

  it('accent usage holds the frozen ratchet (accent 棘轮 371→W1≤200→终态≤130)', () => {
    // 宪章 §2 色彩预算：accent 本体引用只减不增；W1/W2 收缩后下调快照。
    // global.css:1 = ::selection（W0 宪章批落地，属五类合法语义之一，仍占预算）。
    const RATCHET: Record<string, number> = {
      'styles/global.css': 1,
      'pages/project-workspace.module.css': 101,
      'components/copilot/simple-chat.css': 35,
      'components/desktop/desktop.css': 33,
      'pages/extensions/styles.module.css': 23,
      'components/desktop/WorkingTreeReview/ReviewMode.css': 21,
      'components/workspace-panels/KnowledgeSpacePanel.module.css': 19,
      'pages/home.module.css': 19,
      'components/desktop/TitleBar.module.css': 10,
      'components/result-studio/ResultStudioChangeSetPanel.module.css': 8,
      'styles/custom.css': 8,
      'components/copilot/ToolActivityDock.module.css': 7,
      'components/result-studio/ScientificInteractionViewer.module.css': 7,
      'pages/extensions/extensions.module.css': 7,
      'components/branch/BranchTabs.module.css': 6,
      'components/result-studio/LineageStrip.module.css': 5,
      'pages/welcome.module.css': 5,
      'components/copilot/integration/integration.module.css': 4,
      'components/desktop/WorkingTreeReview/WorkingTreeReview.css': 4,
      'components/result-studio/CompactResultNavigator.module.css': 4,
      'components/result-studio/ResultEditPanel.module.css': 4,
      'components/result-studio/ResultStudioSurface.module.css': 4,
      'components/copilot/LlmTranscriptViewer.css': 3,
      'components/knowledge/KnowledgeConsoleChat.module.css': 3,
      'components/result-studio/LineageGraph.module.css': 3,
      'components/result-studio/ResultAgentComposer.module.css': 3,
      'components/window/rail-page.module.css': 3,
      'components/workspace-panels/WorkspaceTodoSection.module.css': 3,
      'components/copilot/MessageRail.module.css': 2,
      'components/knowledge/KnowledgeConsoleDock.module.css': 2,
      'components/result-studio/LineageViewSwitch.module.css': 2,
      'components/RouteErrorBoundary.module.css': 2,
      'components/workspace-panels/FloatCardResizer.module.css': 2,
      'components/workspace-panels/MarkdownResultViewer.module.css': 2,
      'components/workspace-panels/SpreadsheetResultViewer.module.css': 2,
      'components/copilot/renderers/TableRenderer.module.css': 1,
      'components/copilot/ResultCard.module.css': 1,
      'components/result-studio/RevisionCodeView.module.css': 1,
      'pages/global-page.module.css': 1,
      'pages/window/command-center.module.css': 1,
    };
    expectRatchet(RATCHET, countPerFile(/var\(--petri-accent\)/));
  });

  it('non-semantic 1px borders hold the frozen ratchet (无语义细线棘轮 533→W1≤285→终态0)', () => {
    // 宪章 §3：所有 1px solid 必须用 border-input/border-card/divider 三语义之一；
    // 本计数器只统计「值不含三语义 token」的裸细线——迁移即降、终态 0。
    const BORDER_SEMANTIC = /border[^:{}]*:\s*[^;{}]*\b1px\s+solid[^;}]*var\(--petri-(?:border-input|border-card|divider)\)/;
    const ALL_1PX = /border[^:{}]*:\s*[^;{}]*\b1px\s+solid[^;}]*(:?;|\}|$)/;
    const actual: Record<string, number> = {};
    for (const file of CSS_FILES()) {
      const css = stripCss(file);
      const all = (css.match(new RegExp(ALL_1PX.source, 'g')) || []).filter(
        (decl) => !BORDER_SEMANTIC.test(decl),
      ).length;
      if (all > 0) actual[path.relative(srcRoot, file).replaceAll('\\', '/')] = all;
    }
    const RATCHET: Record<string, number> = {
      'pages/project-workspace.module.css': 129,
      'components/copilot/simple-chat.css': 78,
      'components/desktop/desktop.css': 29,
      'components/desktop/WorkingTreeReview/ReviewMode.css': 21,
      'components/workspace-panels/KnowledgeSpacePanel.module.css': 20,
      'pages/extensions/styles.module.css': 16,
      'pages/home.module.css': 13,
      'components/result-studio/ResultStudioChangeSetPanel.module.css': 12,
      'components/knowledge/KnowledgeConsoleChat.module.css': 11,
      'components/copilot/LlmTranscriptViewer.css': 10,
      'styles/custom.css': 10,
      'components/desktop/WorkingTreeReview/WorkingTreeReview.css': 9,
      'components/result-studio/ScientificInteractionViewer.module.css': 9,
      'pages/window/command-center.module.css': 9,
      'components/desktop/TitleBar.module.css': 8,
      'components/result-studio/ResultStudioSurface.module.css': 8,
      'components/copilot/ToolActivityDock.module.css': 7,
      'components/desktop/DesktopSettingsPanel/sections/Federation.module.css': 7,
      'components/desktop/DesktopSettingsPanel/sections/MobileSync.module.css': 7,
      'components/desktop/WorkingTreeReview/CodeReviewDrawer.module.css': 7,
      'pages/extensions/extensions.module.css': 7,
      'pages/welcome.module.css': 7,
      'components/copilot/gen-ui/GenUiCard.module.css': 6,
      'components/result-studio/CompactResultNavigator.module.css': 6,
      'components/result-studio/ResultEditPanel.module.css': 6,
      'components/window/window-shell.module.css': 6,
      'components/workspace-panels/ArtifactPinPane.module.css': 6,
      'components/result-studio/RevisionCodeView.module.css': 5,
      'components/window/rail-page.module.css': 4,
      'components/workspace-panels/MarkdownResultViewer.module.css': 4,
      'components/workspace-panels/SpreadsheetResultViewer.module.css': 4,
      'components/branch/BranchTabs.module.css': 3,
      'components/copilot/renderers/TableRenderer.module.css': 3,
      'components/copilot/ResultCard.module.css': 3,
      'components/desktop/FolderPicker.module.css': 3,
      'components/knowledge/KnowledgeConsoleDock.module.css': 3,
      'components/result-studio/ResultAgentComposer.module.css': 3,
      'components/RouteErrorBoundary.module.css': 3,
      'components/workspace-panels/KnowledgeSpaceSwitcher.module.css': 3,
      'components/workspace-panels/SideChatDock.module.css': 3,
      'components/copilot/renderers/ChartRenderer.module.css': 2,
      'components/desktop/TestInstanceBadge.module.css': 2,
      'components/desktop/theme-control.css': 2,
      'components/result-studio/ContinueAnalysisMenu.module.css': 2,
      'components/result-studio/LineageGraph.module.css': 2,
      'components/result-studio/LineageStrip.module.css': 2,
      'components/settings/ExperimentalFeaturesSection.module.css': 2,
      'pages/global-page.module.css': 2,
      'components/common/ToastProvider.module.css': 1,
      'components/copilot/integration/integration.module.css': 1,
      'components/copilot/MessageRail.module.css': 1,
      'components/copilot/renderers/ImageRenderer.module.css': 1,
      'components/desktop/titlebar/ColumnizedTitleBar.module.css': 1,
      'components/desktop/_ProjectionLinkBanner.module.css': 1,
      'components/result-studio/LineageViewSwitch.module.css': 1,
      'components/workspace-panels/SshStatusDot.module.css': 1,
      'components/workspace-panels/WorkspaceCitationsSection.module.css': 1,
    };
    expectRatchet(RATCHET, actual);
  });

  it('charter counters catch synthetic violations (红证据自检)', () => {
    // 合成违例必须被计数器抓住——棘轮「新增即红」的机制证明（HK-04 精确红先例）。
    const count = (css: string, re: RegExp) => (css.match(new RegExp(re.source, 'g')) || []).length;
    const smallHit = count(
      '.x { font-size: var(--petri-font-size-xs); }',
      /var\(--petri-font-size-(?:xs|sm)\)/,
    );
    const accentHit = count('.x { color: var(--petri-accent); }', /var\(--petri-accent\)/);
    const bare = '.x { border: 1px solid var(--petri-border); }';
    const semantic = '.x { border: 1px solid var(--petri-border-input); }';
    const ALL_1PX = /border[^:{}]*:\s*[^;{}]*\b1px\s+solid[^;}]*(:?;|\}|$)/;
    const BORDER_SEMANTIC = /border[^:{}]*:\s*[^;{}]*\b1px\s+solid[^;}]*var\(--petri-(?:border-input|border-card|divider)\)/;
    const bareHit = (bare.match(new RegExp(ALL_1PX.source, 'g')) || []).filter(
      (d) => !BORDER_SEMANTIC.test(d),
    ).length;
    const semanticHit = (semantic.match(new RegExp(ALL_1PX.source, 'g')) || []).filter(
      (d) => !BORDER_SEMANTIC.test(d),
    ).length;
    expect(smallHit).toBe(1);
    expect(accentHit).toBe(1);
    expect(bareHit).toBe(1);
    expect(semanticHit).toBe(0);
  });
});
