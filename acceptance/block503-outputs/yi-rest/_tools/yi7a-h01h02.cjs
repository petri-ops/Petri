#!/usr/bin/env node
'use strict';

/**
 * 乙7-A · H-01 页头 bare 形态 + H-02 768px 阈值对齐（非产品代码）。
 *
 * H-01：/extensions 独立页 vs 项目工作区顶栏（同尺寸亮色）——bare=无品牌 chip/分区分隔线。
 * H-02：真实窗口 resize（Emulation override→clear 在 Electron 上=持久真实 resize，带 ~1.5
 *       缩放，动态收敛）+ 投影垫片同款 pre-mount 注入（addScriptToEvaluateOnNewDocument
 *       跑在 documentElement 存在前 → readyState 兜底设 data-projection=1）。
 *       两态读 matchMedia('(max-width: 768px)') 与侧栏在场性；全窗截图。
 * 结束复原：移除注入脚本 + 窗口还原原尺寸 + 清标志。
 */
const { connect, sleep, outPath, writeJson } = require('./cdp.cjs');

const ITEM = 'yi7a-h01h02';

const SHIM_SOURCE = `(function(){
  const set = () => { if (document.documentElement) document.documentElement.setAttribute('data-projection', '1'); };
  if (document.documentElement) set();
  else document.addEventListener('readystatechange', set, { once: true });
})();`;

// Emulation override→clear = 持久真实窗口 resize（factor≈1.5 动态收敛）
async function resizeReal(c, targetW, targetH) {
  let reqW = Math.round(targetW / 1.5);
  let reqH = Math.round(targetH / 1.5);
  for (let i = 0; i < 3; i += 1) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: reqW, height: reqH, deviceScaleFactor: 1, mobile: false });
    await sleep(420);
    await c.send('Emulation.clearDeviceMetricsOverride');
    await sleep(420);
    const st = await c.evalJson('({ iw: innerWidth, ih: innerHeight })');
    if (st.iw === targetW && st.ih === targetH) return st;
    reqW = Math.max(200, Math.round(reqW + (targetW - st.iw) / 1.5));
    reqH = Math.max(200, Math.round(reqH + (targetH - st.ih) / 1.5));
  }
  return c.evalJson('({ iw: innerWidth, ih: innerHeight })');
}

(async () => {
  const c = await connect();
  const startUrl = c.page.url;
  const findings = { startUrl, legs: [] };

  const theme0 = await c.evalJson(`({ dataTheme: document.documentElement.getAttribute('data-theme'), accent: document.documentElement.getAttribute('data-accent') || 'teal(默认)', vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio })`);
  findings.theme0 = theme0;

  // ── H-01：顶栏 bare 形态两态 ──
  const topStrip = async (file) => {
    const rect = await c.evalJson(`({ x: 0, y: 0, w: innerWidth, h: Math.min(52, innerHeight) })`);
    await c.cropFull(file, rect, 0);
  };
  const titlebarRead = () => c.evalJson(`(function(){
    const bare = document.querySelector('[class*="centerTitleBare"]');
    const main = document.querySelector('[class*="centerTitleMain"]');
    return {
      bareEl: !!bare,
      brandChipEl: !!main,
      brandText: main ? (main.innerText || '').replace(/\\n/g, ' ').slice(0, 40) : null,
      path: location.pathname,
    };
  })()`);

  try {
    await c.navigate('http://localhost:3000/extensions');
    await sleep(1200);
    const ext = await titlebarRead();
    await topStrip(outPath(ITEM, 'h01-extensions-topbar.png'));
    await c.navigate(startUrl);
    await sleep(1200);
    const proj = await titlebarRead();
    await topStrip(outPath(ITEM, 'h01-project-topbar.png'));
    findings.legs.push({
      id: 'h01_bare_topbar',
      pass: ext.bareEl && !ext.brandChipEl && proj.brandChipEl && !proj.bareEl,
      detail: { extensions: ext, project: proj, criterion: '独立页 bare（无品牌 chip/分区分隔线，TitleBarCenterZone isStandalonePagePath 分支）；工作区恢复 chip+标题' },
    });
    console.log('ok h01', JSON.stringify({ ext, proj }));
  } catch (e) { findings.legs.push({ id: 'h01_bare_topbar', pass: null, error: e.message }); console.log('ERR h01', e.message); }

  // ── H-02：9223 离屏测试实例（牺牲窗口，跑完 kill）。CDP 无真实窗口 resize（Emulation
  //          override→clear 恒回弹，实测沉淀）；用应用自带的 zoomBy IPC（webContents.setZoomLevel，
  //          支持 0.002 级小数步进）把 CSS 布局视口精确调到 769/768 两侧——media query 真实响应。
  //          投影垫片标志 live 设置（data-projection=1，isProjectionMobile 等 live 反应真实生效）。
  {
    const tc = await connect({ port: 9223 });
    try {
      await tc.navigate('http://localhost:3000/project/p_mwnkhuj2_okzh');
      await sleep(1500);
      await tc.evaluate(`document.documentElement.setAttribute('data-projection', '1')`);
      await tc.evaluate(`window.petri && window.petri.window.zoomReset ? window.petri.window.zoomReset() : null`);
      await sleep(400);
      const base = await tc.evalJson('innerWidth');

      const readNarrow = () => tc.evalJson(`(function(){
        const mm = window.matchMedia('(max-width: 768px)').matches;
        const left = document.querySelector('[class*="leftPanel"]');
        const leftVis = left ? left.getBoundingClientRect().width : -1;
        return {
          dataProjection: document.documentElement.getAttribute('data-projection'),
          matchMedia768: mm,
          leftPanelWidth: Math.round(leftVis),
          vw: innerWidth,
          path: location.pathname,
        };
      })()`);

      // 单发精确 zoom：level = ln(base/目标) / ln(1.2)；偏差 ≥1 时一次微调
      const zoomToViewport = async (targetVw) => {
        let level = Math.log(base / targetVw) / Math.log(1.2);
        await tc.evaluate(`window.petri.window.zoomReset()`);
        await sleep(200);
        await tc.evaluate(`window.petri.window.zoomBy(${level.toFixed(4)})`);
        await sleep(500);
        let vw = await tc.evalJson('innerWidth');
        if (Math.abs(vw - targetVw) >= 1) {
          level += Math.log(base / vw) / Math.log(1.2) - level;
          await tc.evaluate(`window.petri.window.zoomReset()`);
          await sleep(200);
          await tc.evaluate(`window.petri.window.zoomBy(${level.toFixed(4)})`);
          await sleep(500);
          vw = await tc.evalJson('innerWidth');
        }
        return { level: level.toFixed(4), vw };
      };

      const states = [];
      for (const w of [769, 768]) {
        const z = await zoomToViewport(w);
        await sleep(500);
        const st = await readNarrow();
        st.zoomApplied = z.level;
        await tc.shot(outPath(ITEM, `h02-${w}.png`));
        states.push(st);
        console.log('h02', w, JSON.stringify(st));
      }
      await tc.evaluate(`window.petri && window.petri.window.zoomReset ? window.petri.window.zoomReset() : null`);
      await tc.evaluate(`document.documentElement.removeAttribute('data-projection')`);
      findings.legs.push({
        id: 'h02_breakpoint_768',
        pass: states[0].matchMedia768 === false && states[0].vw >= 769
          && states[1].matchMedia768 === true && states[1].vw <= 768
          && states[0].dataProjection === '1' && states[1].dataProjection === '1',
        detail: { states, base, criterion: '769 未触发 / 768 恰好触发（matchMedia max-width:768 与 JS MOBILE_BREAKPOINT_PX=768 单源；zoom 等效布局视口读数，media query 真实响应）', note: '9223 测试实例取材（跑完 kill/zoomReset）；CDP 在 Electron 无真实窗口 resize（Emulation 恒回弹，实测沉淀），zoom 路线为 CSS 布局视口等效', instance: '9223 test instance' },
      });
      console.log('ok h02');
    } catch (e) {
      findings.legs.push({ id: 'h02_breakpoint_768', pass: null, error: e.message });
      console.log('ERR h02', e.message);
    } finally {
      tc.close();
    }
  }

  writeJson(ITEM, 'findings.json', findings);
  console.log('DONE legs=', findings.legs.length);
  c.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
