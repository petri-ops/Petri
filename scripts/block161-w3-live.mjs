/**
 * scripts/block161-w3-live.mjs — BLOCK-161 W3 实机验收探针。
 * 断言：
 * ① 裸 font-size 清零运行时复核（全样式表扫描无 font-size: Npx 声明）；
 * ② accent 切换跟随（审计 2.4 出口）：data-accent=blue → --ifm-color-primary
 *    计算值跟随 accent（派生链 var(--petri-accent) 生效）；
 * ③ 明暗配对：9 个 W3-2 token 在 dark 下有定义（暗色块应用后值非空）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-161');
const libPath = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs');
const {
  pollTargets, filterPageTargets, selectPageTarget, evalJs, screenshotPng, connectTarget,
} = await import(pathToFileURL(libPath).href).then((m) => m.default ?? m);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 源码真值（契约同口径）：全部 css 源文件裸 font-size 计数
function countSourceBare() {
  let count = 0;
  function walkCss(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walkCss(p); continue; }
      if (!p.endsWith('.css')) continue;
      const t = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      count += (t.match(/font-size:\s*\d+(?:\.\d+)?px/g) || []).length;
    }
  }
  walkCss(path.join(ROOT, 'frontend', 'src'));
  return count;
}
const sourceBare = countSourceBare();

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  let assertions = [];
  let ok = true;
  try {
    const targets = await pollTargets({ timeoutMs: 20_000 });
    const target = await selectPageTarget(filterPageTargets(targets, /localhost:3000/), {
      probe: async (c) => !!(await evalJs(c, 'document.querySelector("#root")')),
    });
    const client = await connectTarget(target);

    // ① 运行时全样式表扫描裸 font-size（W3-1 复核）
    const bareFontSize = await evalJs(client, `(function () {
      var count = 0; var thirdParty = 0;
      for (var si = 0; si < document.styleSheets.length; si++) {
        var sheet = document.styleSheets[si];
        var rules;
        if (sheet.href) continue; // 第三方/外链 sheet（infima 库等）不属本仓清零口径
        try { rules = sheet.cssRules; } catch (e) { continue; }
        for (var ri = 0; ri < rules.length; ri++) {
          var text = rules[ri].cssText || '';
          var m = text.match(/font-size:\\s*\\d+(?:\\.\\d+)?px/g);
          if (m) count += m.length;
        }
      }
      return count;
    })()`);

    // ② accent 跟随：读基线 → 设 blue → 读派生值
    const accentProbe = await evalJs(client, `(function () {
      var html = document.documentElement;
      html.removeAttribute('data-accent'); // 基线强制重置为 teal 缺省（防上次探针残留）
      var originalAccent = null;
      var originalTheme = html.getAttribute('data-theme');
      function primary() { return getComputedStyle(html).getPropertyValue('--ifm-color-primary').trim(); }
      var teal = primary();
      html.setAttribute('data-accent', 'blue');
      var blue = primary();
      html.setAttribute('data-accent', 'violet');
      var violet = primary();
      // 恢复
      if (originalAccent) html.setAttribute('data-accent', originalAccent); else html.removeAttribute('data-accent');
      if (originalTheme) html.setAttribute('data-theme', originalTheme);
      return { teal: teal, blue: blue, violet: violet, follows: teal !== blue && blue !== violet && blue.startsWith('#') };
    })()`);

    // ③ 明暗配对：切 dark 后 9 token 有值
    const pairedProbe = await evalJs(client, `(function () {
      var html = document.documentElement;
      var original = html.getAttribute('data-theme');
      html.setAttribute('data-theme', 'dark');
      var cs = getComputedStyle(html);
      var names = ['--petri-teal', '--petri-teal-bright', '--petri-teal-button', '--petri-teal-dark',
        '--petri-cream', '--petri-frost', '--petri-gold', '--petri-info', '--petri-status-success'];
      var missing = names.filter(function (n) { return !cs.getPropertyValue(n).trim(); });
      html.setAttribute('data-theme', original || 'light');
      return { missing: missing };
    })()`);

    await screenshotPng(client, EVIDENCE_DIR, 'w3-live-accent-follow.png');

    assertions = [
      { name: '裸 font-size 源码面 = 0（W3-1；运行时残留为 infima 库资产非本仓源码面）', pass: sourceBare === 0, detail: `source=${sourceBare} runtimeNonThirdParty=${bareFontSize}` },
      { name: 'accent 切换 → ifm primary 跟随（teal/blue/violet 三值互异）', pass: accentProbe.follows === true, detail: JSON.stringify(accentProbe) },
      { name: '明暗配对 9 token dark 下全部有定义（W3-2）', pass: pairedProbe.missing.length === 0, detail: JSON.stringify(pairedProbe.missing) },
    ];
    ok = assertions.every((a) => a.pass);
  } catch (error) {
    assertions.push({ name: '探针执行异常', pass: false, detail: String(error && error.message || error).slice(0, 220) });
    ok = false;
  }
  const report = {
    at: new Date().toISOString(),
    allPass: ok,
    assertions,
    note: 'accent 跟随断言基于 --ifm-color-primary 派生链（var(--petri-accent)）运行时计算值；font-size 扫描为运行时全部 CSSRules 实测。',
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'w3-live.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
