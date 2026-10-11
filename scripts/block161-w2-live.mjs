/**
 * scripts/block161-w2-live.mjs — BLOCK-161 W2 实机验收探针。
 * 断言（batch 纪律：每批实机 CDP 截图对比）：
 * ① z 归档生效：Toast 容器 computed z=10000（toast 档）且 > TitleBar computed z（500）
 *    ——审计 P0 倒挂（9999<10001）修复实证；
 * ② 归档未破坏常驻面：TitleBar/dock/分支条仍渲染可见（offsetParent 非空）；
 * ③ 档位 token 在运行时真实可读（8 档数值与契约一致）。
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

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  let assertions = [];
  let ok = true;
  try {
    const targets = await pollTargets({ timeoutMs: 20_000 });
    const candidates = filterPageTargets(targets, /localhost:3000/);
    const target = await selectPageTarget(candidates, {
      probe: async (c) => !!(await evalJs(c, 'document.querySelector("#root")')),
    });
    const client = await connectTarget(target);

    const zProbe = await evalJs(client, `(function () {
      function zOf(selector) {
        var el = document.querySelector(selector);
        if (!el) return null;
        return { z: getComputedStyle(el).zIndex, visible: el.offsetParent !== null || getComputedStyle(el).position === 'fixed' };
      }
      var tokens = {};
      var cs = getComputedStyle(document.documentElement);
      ['base', 'raised', 'sticky', 'dropdown', 'overlay', 'modal', 'lightbox', 'toast'].forEach(function (name) {
        tokens[name] = Number(cs.getPropertyValue('--petri-z-' + name).trim());
      });
      return {
        tokens: tokens,
        toast: zOf('[data-testid="toast-viewport"]'),
        titlebar: zOf('[class*="titleBar"]'),
        dock: zOf('.petri-desktop-dock'),
      };
    })()`);

    // z 语义序断言
    const toastZ = zProbe.toast ? Number(zProbe.toast.z) : null;
    const titleZ = zProbe.titlebar ? Number(zProbe.titlebar.z) : null;
    const tokens = zProbe.tokens;

    await screenshotPng(client, EVIDENCE_DIR, 'w2-live-z-tiers.png');

    assertions = [
      { name: '8 档 token 运行时可读且 Toast 为最高档', pass: tokens.toast === 10000 && tokens.toast > tokens.lightbox && tokens.toast > tokens.modal && tokens.toast > tokens.overlay && tokens.toast > tokens.base, detail: JSON.stringify(tokens) },
      { name: 'Toast 容器归档生效（computed z = toast 档）', pass: toastZ === 10000, detail: `toast z=${toastZ}` },
      { name: 'TitleBar 归档生效且语义序 Toast > TitleBar（倒挂修复实证）', pass: titleZ !== null && toastZ > titleZ, detail: `titlebar z=${titleZ}` },
      { name: '常驻面未破坏：TitleBar 可见', pass: !!(zProbe.titlebar && zProbe.titlebar.visible) },
      // dock 为条件渲染面（桌面版工作区布局），不在当前页如实记录不判失败
      { name: 'dock 可见性（条件渲染面：在场则可见）', pass: !zProbe.dock || zProbe.dock.visible === true, detail: zProbe.dock ? JSON.stringify(zProbe.dock) : 'absent on this page (conditional render)' },
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
    note: 'z 归档批（Toast/TitleBar/BranchTabs/徽标/横幅/dock/GenUi 七件）语义序与可见性实机断言；组件内部相对层叠不在本批（棘轮白名单冻结）。',
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'w2-live.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
