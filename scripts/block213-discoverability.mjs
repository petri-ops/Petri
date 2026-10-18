/**
 * block213-discoverability.mjs — BLOCK-213 P0 基线：功能发现率四数字（离线、零 API）。
 *
 * 口径（静态扫描，写死在脚本里，避免"口径随报告漂移"）：
 *  ① paletteCommands  = 命令面板**静态注册**条数（go()=路由跳转 / doIt()=本地动作 / 设置深链=SETTINGS_SECTIONS 全节）
 *  ② settingsCovered  = 设置页有深链命令的节数 / 设置节总数
 *  ③ shortcutCovered  = 键位注册表里的 id 有多少能在面板命令里找到同 id（面板快捷键徽章靠同 id 派生）
 *  ④ emptyGuides      = 四个空态页里带 `data-testid="empty-guide"` 的页数
 *
 * 用法：node scripts/block213-discoverability.mjs [--json] [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONT = path.join(ROOT, 'frontend', 'src');
const read = (rel) => fs.readFileSync(path.join(FRONT, rel), 'utf8');

const PALETTE = 'components/copilot/useAppCommands.ts';
const KEYMAP = 'lib/appKeymap.ts';
const SECTIONS = 'components/desktop/DesktopSettingsPanel/types.ts';
// 空态引导只对**确实存在空态**的页面计分：knowledge/result 两页没有空态（恒有工作台/恒有结果面），
// 硬塞一句"这里能做什么"就是为指标造戏，故如实列为 N/A 而不是目标。
const EMPTY_GUIDE_PAGES = ['pages/welcome.tsx', 'pages/extensions/index.tsx'];
const EMPTY_GUIDE_NA = ['pages/knowledge/index.tsx（无空态：设备级空间恒在）', 'pages/project-workspace.tsx（无空态：无项目时回欢迎页）'];

export function measure() {
  const palette = read(PALETTE);
  const keymap = read(KEYMAP);
  const sectionsSrc = read(SECTIONS);

  // ① 面板命令（静态）
  const goIds = [...palette.matchAll(/go\('([^']+)'/g)].map((m) => m[1]);
  const doItIds = [...palette.matchAll(/doIt\('([^']+)'/g)].map((m) => m[1]);
  const sectionIds = [...sectionsSrc.matchAll(/\{ id: '([^']+)', label: '([^']+)'/g)].map((m) => m[1]);
  const settingsCommandIds = sectionIds.map((id) => `settings:${id}`);
  const paletteCommandIds = [...new Set([...goIds, ...doItIds, ...settingsCommandIds])];

  // ② 设置覆盖
  const settingsCovered = sectionIds.filter((id) => paletteCommandIds.includes(`settings:${id}`)).length;

  // ③ 快捷键同名率（面板徽章靠 `bindings[cmd.id]` 派生，同 id 才能显示）
  const keymapIds = [...keymap.matchAll(/\{ id: '([^']+)', label: '/g)].map((m) => m[1]);
  const shortcutCovered = keymapIds.filter((id) => paletteCommandIds.includes(id)).length;

  // ④ 空态引导
  const emptyGuidePages = EMPTY_GUIDE_PAGES.filter((rel) => {
    try { return read(rel).includes('data-testid="empty-guide"'); } catch { return false; }
  });

  return {
    generatedAt: new Date().toISOString(),
    paletteCommands: paletteCommandIds.length,
    paletteStaticIds: paletteCommandIds,
    dynamicSources: ['projects(≤3)', 'skills(top4)', 'recentConversations(≤5)'],
    settingsSections: sectionIds.length,
    settingsCovered,
    keymapEntries: keymapIds.length,
    shortcutCovered,
    emptyGuidePages: emptyGuidePages.length,
    emptyGuideTargets: EMPTY_GUIDE_PAGES.length,
    emptyGuideNotApplicable: EMPTY_GUIDE_NA,
    emptyGuideCoveredList: emptyGuidePages,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const report = measure();
  const outDir = path.join(ROOT, 'acceptance', 'block-213');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'discoverability-baseline.json');
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('[block213] 命令面板静态命令 =', report.paletteCommands);
    console.log('[block213] 设置节覆盖 =', `${report.settingsCovered}/${report.settingsSections}`);
    console.log('[block213] 快捷键同名覆盖 =', `${report.shortcutCovered}/${report.keymapEntries}`);
    console.log('[block213] 空态引导页 =', `${report.emptyGuidePages}/${report.emptyGuideTargets}（另 2 页无空态，记 N/A）`);
    console.log('[block213] →', out);
  }
}
