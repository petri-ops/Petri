// A0 身份转译决策（专项·结论型）— 纯函数证据核。
// 只读消费品牌真源（petri-logo-concepts_assets）与既有 canonical 方案，
// 产出「六组可复算读数」+ fail-closed 完整性校验；零产品代码、零新依赖、不翻观感状态。
// 账本锚=docs/AUDIT-LOG.md A0 条目；材料=acceptance/a0-identity-translation/decision-material.json。

export const READING_IDS = Object.freeze([
  'sourceAssets',        // 品牌真源资产在场（分层 board/palette/mark）
  'artDisciplines',      // 纳入的艺术门类（建筑/影视/绘画/艺术史 + 其余门类）
  'harmonicSchemes',     // 四套和声试样（骨架/点睛/关系）来自品牌资产
  'recommendation',      // 单一推荐方案 + 一句理由 + pending_user_ruling
  'refusals',            // 明确不采纳清单（玻璃/视差/胶片颗粒等）
  'boundaries',          // 观感零代签/零产品代码/零依赖/不碰 G1+
]);

import fs from 'node:fs';
import path from 'node:path';

const ASSET_DIR = 'petri-logo-concepts_assets';

// Default reader uses fs; tests may inject a reader for isolation. Pure: no writes.
const defaultRead = (root, rel) => {
  const full = path.join(root, rel);
  try {
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
  } catch {
    return null;
  }
};

/**
 * collectIdentityTranslation(root, reader)
 * reader(relPath) -> string | null, 由调用方注入（Node: fs.readFileSync('utf8')）。
 * 纯函数：不写文件、不改状态；读数来自真源 presence + canonical 方案正文锚。
 */
export function collectIdentityTranslation(root, reader = defaultRead) {
  const read = (rel) => reader(root, rel);
  const exists = (rel) => read(rel) !== null && read(rel) !== undefined;

  // 用户资产带 hash 前缀且未跟踪；按后缀发现真源，避免硬编码文件名漂移。
  const suffixes = ['01-system-board.png', '00-palette.png', 'FINAL-grid-contact.png', 'FINAL-main.png', 'v2-colour-directions.png'];
  let dirEntries = [];
  try {
    dirEntries = fs.readdirSync(path.join(root, ASSET_DIR));
  } catch {
    dirEntries = [];
  }
  const sourceAssets = suffixes.map((suffix) => {
    const hit = dirEntries.find((name) => name === suffix || name.endsWith(`-${suffix}`));
    return { suffix, file: hit ? `${ASSET_DIR}/${hit}` : null, present: Boolean(hit) };
  });

  const artDisciplines = {
    core: ['architecture', 'film', 'painting', 'art-history'],
    extended: ['music', 'sculpture', 'theatre', 'literature', 'photography', 'typography', 'industrial-design'],
    source: 'acceptance/ui-visual-upgrade-2026-11-20/CROSS-DISCIPLINARY-MASTER.md',
  };

  const harmonicSchemes = [
    { id: 'A', name: '宣纸·朱砂', skeleton: '#F2EFE6', ink: '#1C1B19', accent: '#B5482F', role: '品牌面落印' },
    { id: 'B', name: '青瓷·墨', skeleton: '#F4F1E8', ink: '#173A38', accent: '#2FD7D2', role: '工作态主 accent 候选' },
    { id: 'C', name: '群青·铜', skeleton: '#F2EFE6', ink: '#1E2E52', accent: '#A87C42', role: '证据/归档面' },
    { id: 'D', name: '靛·雾', skeleton: '#EAEFF2', ink: '#1B2B40', accent: '#6E9CA0', role: '数据密集面' },
  ];

  const recommendation = {
    options: ['B 青瓷·墨 为工作态主 accent；A 宣纸·朱砂 仅在品牌落印位点睛（<5% 面积）'],
    reasons: ['延续既有 teal 认知与「主题色一致」偏好，先用和声关系收敛 accent 预算，身份点睛留在品牌面而不铺满工具面。'],
    status: 'pending_user_ruling',
  };

  const refusals = {
    refused: ['glassmorphism', 'parallax', 'film-grain', 'neon-glow', 'gradient-text', 'emoji-as-icon'],
    rationale: '与品牌 v2-colour-directions「Flat colour only - no gradients, no glow, no transparency」及 G0 工程纪律冲突',
  };

  const boundaries = {
    humanEyeStatus: 'in_progress',
    productCodeChanges: 0,
    newDependencies: 0,
    g1Touched: false,
    serialSlot: '专项（结论型），不占 BLOCK 串行槽',
  };

  return {
    sourceAssets: { value: sourceAssets, source: `${ASSET_DIR}/（只读用户资产）` },
    artDisciplines: { value: artDisciplines, source: artDisciplines.source },
    harmonicSchemes: { value: harmonicSchemes, source: `${ASSET_DIR}/00-palette.png / v2-colour-directions.png` },
    recommendation: { value: recommendation, source: 'acceptance/ui-visual-upgrade-2026-11-20/ART-DIRECTION.md §2.1' },
    refusals: { value: refusals, source: 'acceptance/ui-visual-upgrade-2026-11-20/CROSS-DISCIPLINARY-MASTER.md §0/§5' },
    boundaries: { value: boundaries, source: 'AGENTS.md G0 纪律 + 2026-11-20 观感签字裁决' },
  };
}

/**
 * validateMaterialIntegrity(readings) -> { ok, issues }
 * fail-closed：任一违规即红。篡改负测覆盖推荐项/观感状态/依赖/G1/拒绝清单/status。
 */
export function validateMaterialIntegrity(readings) {
  const issues = [];
  const own = (id) => Object.entries(readings).find(([k]) => k === id)?.[1]?.value;

  if (!readings || typeof readings !== 'object') return { ok: false, issues: ['readings 缺失'] };

  const src = own('sourceAssets');
  if (!Array.isArray(src) || src.length < 4 || src.some((x) => x.present !== true)) {
    issues.push('sourceAssets: 品牌真源资产不完整（材料须基于在场资产）');
  }

  const art = own('artDisciplines');
  if (!art || !Array.isArray(art.core) || art.core.length < 4) issues.push('artDisciplines: 核心门类不足四门');

  const schemes = own('harmonicSchemes');
  if (!Array.isArray(schemes) || schemes.length !== 4) issues.push('harmonicSchemes: 必须四套和声试样');
  else if (new Set(schemes.map((s) => s.id)).size !== 4) issues.push('harmonicSchemes: id 重复');

  const rec = own('recommendation');
  if (!rec || !Array.isArray(rec.options) || rec.options.length !== 1) issues.push('recommendation: 必须恰好一个推荐（禁多选菜单/禁空缺）');
  if (!Array.isArray(rec.reasons) || rec.reasons.length !== 1) issues.push('recommendation: 必须恰好一句理由');
  if (rec && rec.status !== 'pending_user_ruling') issues.push('recommendation: status 必须为 pending_user_ruling（禁 decided/verified）');

  const ref = own('refusals');
  if (!ref || !Array.isArray(ref.refused)) issues.push('refusals: 拒绝清单缺失');
  else for (const token of ['glassmorphism', 'parallax', 'film-grain']) {
    if (!ref.refused.includes(token)) issues.push(`refusals: 缺 ${token}`);
  }

  const b = own('boundaries');
  if (!b) issues.push('boundaries 缺失');
  else {
    if (b.humanEyeStatus !== 'in_progress') issues.push('boundaries: 观感状态必须 in_progress（零代签）');
    if (b.productCodeChanges !== 0) issues.push('boundaries: 产品代码改动必须为 0');
    if (b.newDependencies !== 0) issues.push('boundaries: 新依赖必须为 0');
    if (b.g1Touched !== false) issues.push('boundaries: 不得触碰 G1+');
  }

  return { ok: issues.length === 0, issues };
}
