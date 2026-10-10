#!/usr/bin/env node
'use strict';

/**
 * BLOCK-156 D7 实机校验 flow — 第三方技能本地目录导入全链：
 * 临时技能目录（通用类目）→ 测试实例 renderer 调 skills:import-path IPC →
 * 主进程 installSkillFromDir 装载 → /extensions?tab=general-skills 卡片在场 →
 * 清场（uninstallImportedSkill）零残留。
 * 对话框本体（import-directory）属 OS 层 UI，不在合成断言面（如实登记）；
 * import-path 与对话框共用同一安装函数（main.js 同源）。
 * 红线：只连测试实例 9223。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lib = require('../lib.cjs');

const REPO = lib.findRepoRoot(__dirname) || process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SKILL_ID = 'b156-live-general-skill';

async function evalRetry(client, expr, tries = 10) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(400); }
  }
  throw lastErr;
}

module.exports = {
  id: 'block156-skill-import',
  description: 'BLOCK-156 D7：第三方技能本地目录导入 → 通用技能货架可见 → 清场',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'block-156'),

  async run(ctx) {
    const { assert } = ctx;

    // ── S1 宿主侧：临时技能目录 + 预清场 ──
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b156-skill-'));
    fs.writeFileSync(path.join(srcDir, 'skill.json'), JSON.stringify({
      skillManifestVersion: 1,
      id: SKILL_ID,
      name: '实机导入通用技能',
      version: '1.0.0',
      description: 'BLOCK-156 D7 实机导入验证（临时，自动清场）',
      category: 'productivity',
      plugins: { required: [], optional: [] },
      parameters: { required: [], optional: {} },
    }, null, 2));
    // 预清场（幂等）：按测试实例同源路径卸载（未设 PETRI_USER_DATA_DIR → ~/.petri/skills）
    const registry = require(path.join(REPO, 'core', 'shared-backend', 'skill-registry.js'));
    registry.uninstallImportedSkill(SKILL_ID);

    // ── S2 测试实例：renderer 调 import-path IPC（与对话框共用安装函数） ──
    const client = await lib.connectTestTarget({ timeoutMs: ctx.timeoutMs ?? 30_000 });
    try {
      const importResult = JSON.parse(await evalRetry(client,
        `(window.petri ?? window.petriDesktop).skills.importPath(${JSON.stringify(srcDir)}).then(r => JSON.stringify(r))`));
      assert('import_path_ipc_ok',
        importResult && importResult.ok === true && importResult.skillId === SKILL_ID,
        JSON.stringify(importResult).slice(0, 200));

      // ── S3 货架可见（discover→UI 全链） ──
      await lib.evalJs(client, `location.href = 'http://localhost:3000/extensions?tab=general-skills'; 'nav'`);
      await sleep(2500);
      const ui = await evalRetry(client, `(function(){
        const pane = document.querySelector('[data-testid="skill-shelf-general-skills"]');
        if (!pane) return JSON.stringify({ pane: false });
        const text = pane.textContent || '';
        return JSON.stringify({
          pane: true,
          importedVisible: text.includes('实机导入通用技能'),
          importBtn: !!document.querySelector('[data-testid="skill-import-directory"]'),
        });
      })()`, 15);
      const parsed = JSON.parse(ui);
      assert('imported_skill_visible_on_general_shelf',
        parsed.pane && parsed.importedVisible && parsed.importBtn,
        JSON.stringify(parsed));
      await lib.screenshotPng(client, path.join(process.cwd(), 'acceptance', 'block-156'), 'd7-skill-import-visible.png');
    } finally {
      try { client.socket.close(); } catch { /* already closed */ }
    }

    // ── S4 宿主侧清场：卸载 + 零残留 ──
    const removed = registry.uninstallImportedSkill(SKILL_ID);
    assert('cleanup_uninstalled', removed.ok === true, JSON.stringify(removed));
    const skillsDir = path.join(os.homedir(), '.petri', 'skills');
    const leftoverDir = fs.existsSync(path.join(skillsDir, SKILL_ID));
    let manifestClean = true;
    const manifestPath = path.join(skillsDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifestClean = !(m.skills && SKILL_ID in m.skills);
    }
    assert('cleanup_zero_leftover', !leftoverDir && manifestClean,
      `dir=${leftoverDir} manifestClean=${manifestClean}`);
    fs.rmSync(srcDir, { recursive: true, force: true });

    return true;
  },
};
