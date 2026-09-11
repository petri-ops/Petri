#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: ui342-endpoint-grid — 供应商设置页 endpoint 网格修复核验（BLOCK-81 P0 / UI-342）。
 *
 * 缺陷（用户截图 + 代码双向实锤）：`.gewu-endpoint-list-header` 与
 * `.gewu-endpoint-card__grid` 共享的 `grid-template-columns` **只定义 7 列**，而
 * 表头与渠道行各有 **8 个子元素** → 第 8 个（删除）被挤进隐式新行独占一行、
 * 连通性只剩 32px 窄列导致「已连接」文字溢出重合。
 *
 * 断言链：
 *   G1_eight_columns       表头与渠道行均为 8 列（不再是 7 列模板 + 隐式行）
 *   G2_single_row          渠道行 8 个单元格同一行（offsetTop 一致）
 *   G3_no_inner_overflow   无单元格内容溢出（scrollWidth ≤ clientWidth+1）＝文字不重合
 *   G4_columns_aligned     表头与渠道行列宽逐列一致（同一模板，不因 min-width 缺位错位）
 *   G5_min_width_shared    表头与渠道行共用 min-width（1060px），窄容器一起横向滚动
 *
 * 证据：acceptance/block-81/ui342-endpoint-grid-live.json + ui342-endpoint-grid.png
 */
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  id: 'ui342-endpoint-grid',
  description: 'BLOCK-81 P0 / UI-342 设置页 endpoint 网格 8 列对齐与文字重合核验',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-81'),

  async run({ assert }) {
    const targets = await lib.pollTargets({ timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target: dev Electron 主窗未找到');
    const client = await lib.connectTarget(pages[0]);

    const pid = await lib.evalJs(client, `(async () => {
      const r = await fetch('http://127.0.0.1:3001/api/data/projects', { headers: { Authorization: 'Bearer desktop-local' } });
      const d = await r.json();
      return (d.projects || [])[0] ? (d.projects || [])[0].id : '';
    })()`).catch(() => '');
    if (!pid) throw new Error('no_project_available: 需要至少一个项目');

    await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${pid}/settings'; 'nav'`);
    await sleep(3500);
    const t2 = await lib.pollTargets({ timeoutMs: 15_000 });
    const p2 = lib.filterPageTargets(t2, /^http:\/\/localhost:3000\//);
    const c2 = await lib.connectTarget(p2[0]);

    try {
      // 进入「模型接口」分区（endpoint 表所在区）
      await lib.evalJs(c2, `(function(){
        var b = [].slice.call(document.querySelectorAll('button')).find(function(x){
          return (x.innerText || '').indexOf('模型接口') === 0;
        });
        if (b) b.click();
        return b ? 'clicked' : 'not_found';
      })()`).catch(() => {});
      await sleep(1600);

      const raw = await lib.evalJs(c2, `(function(){
        function info(el){
          if (!el) return null;
          var cs = getComputedStyle(el);
          var cols = cs.gridTemplateColumns.split(' ').filter(Boolean);
          var kids = [].slice.call(el.children).map(function(k){
            var r = k.getBoundingClientRect();
            return { w: Math.round(r.width), top: Math.round(r.top), offTop: k.offsetTop,
                     scrollW: k.scrollWidth, clientW: k.clientWidth };
          });
          return { columns: cols.length, colWidths: cols.map(function(c){ return Math.round(parseFloat(c)); }),
                   minWidth: Math.round(parseFloat(cs.minWidth) || 0), kids: kids };
        }
        return JSON.stringify({
          header: info(document.querySelector('.gewu-endpoint-list-header')),
          card: info(document.querySelector('.gewu-endpoint-card__grid')),
        });
      })()`).catch((e) => 'ERR ' + e.message);

      if (typeof raw !== 'string' || !raw.startsWith('{')) {
        assert('G0_settings_mounted', false, 'endpoint 网格未渲染：' + String(raw).slice(0, 160));
        return true;
      }
      const { header, card } = JSON.parse(raw);
      assert('G0_settings_mounted', !!header && !!card, `header=${!!header} card=${!!card}`);
      if (!header || !card) return true;

      assert('G1_eight_columns', header.columns === 8 && card.columns === 8,
        `header=${header.columns} card=${card.columns}（期望 8：协议/供应商/BaseURL/Key/模型/上下文/连通性/删除）`);

      // 同行判定用「偏移极差」而非严格相等：同行内高度不同的单元格在
      // align-items:center 下 top/offsetTop 会有 1px 级栅格化差异；而真正的
      // 「第 8 个被挤到隐式新行」会差一个行高（≈32px）。故极差 ≤4px 即同一行。
      const offTops = card.kids.map((k) => k.offTop);
      const spread = Math.max.apply(null, offTops) - Math.min.apply(null, offTops);
      assert('G2_single_row', spread <= 4,
        `单元格 offsetTop 极差=${spread}px（期望 ≤4 = 同一行；独占新行会差 ≈32px）values=${offTops.join(',')}`);

      const overflowing = card.kids.filter((k) => k.scrollW > k.clientW + 1);
      assert('G3_no_inner_overflow', overflowing.length === 0,
        `溢出单元格=${overflowing.length}（期望 0 = 「已连接」等文字不再与邻列重合）`);

      const sameCols = header.colWidths.length === card.colWidths.length
        && header.colWidths.every((w, i) => Math.abs(w - card.colWidths[i]) <= 2);
      assert('G4_columns_aligned', sameCols,
        `header=[${header.colWidths.join(',')}] card=[${card.colWidths.join(',')}]`);

      assert('G5_min_width_shared', header.minWidth > 0 && header.minWidth === card.minWidth,
        `header minWidth=${header.minWidth} card minWidth=${card.minWidth}（期望相等且 >0）`);

      fs.mkdirSync(path.join(ROOT, 'acceptance', 'block-81'), { recursive: true });
      await lib.screenshotPng(c2, path.join(ROOT, 'acceptance', 'block-81'), 'ui342-endpoint-grid.png');
    } finally {
      try { c2.socket.close(); } catch { /* ignore */ }
      try { client.socket.close(); } catch { /* ignore */ }
    }
    return true;
  },
};
