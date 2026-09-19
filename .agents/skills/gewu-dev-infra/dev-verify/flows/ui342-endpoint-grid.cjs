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
 *   G5_min_width_shared    表头与渠道行共用 min-width（1060px），宽容器下列宽一致
 *
 * UI-344（D8）两行式自适应（容器 < 1058px 时同一 flow 改验 N 组）：
 *   N1_header_hidden       表头隐藏（列名语义由每格自身标签承载）
 *   N2_two_line_columns    渠道行切换为「标签 | 控件」两列
 *   N3_labels_visible      每格标签显形（宽容器下 display:none 不占网格项）
 *   N4_no_horizontal_scroll 不再横向滚动（scrollWidth ≤ clientWidth）
 *   N5_label_control_pairs 每个控件的前一个兄弟都是标签（成对，不错位）
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
    const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target: dev Electron 主窗未找到');
    const client = await lib.connectTarget(pages[0]);

    // UI-366 独立页化后设置页迁移至 /settings（/project/:id/settings 路由已裁撤，
    // 2026-09-19 迁移测试实例时抓真）——直接导航独立设置页，无需项目 id。
    await lib.evalJs(client, `location.href = 'http://localhost:3000/settings'; 'nav'`);
    await sleep(3500);
    const t2 = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 15_000 });
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
          // 排除 UI-344 的标签 span（宽容器 display:none → 不是 grid item，也不参与对齐判定）
          var kids = [].slice.call(el.children).filter(function(k){
            return !k.classList.contains('gewu-endpoint-field-label');
          }).map(function(k){
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

      // 容器宽度决定形态：≥1058 为 8 列表格（G 组），<1058 为两行式堆叠（N 组）
      const listRaw = await lib.evalJs(c2, `(function(){
        var el = document.querySelector('.gewu-model-list');
        if (!el) return 'null';
        return JSON.stringify({ clientW: el.clientWidth, scrollW: el.scrollWidth });
      })()`).catch(() => 'null');
      const list = listRaw && listRaw !== 'null' ? JSON.parse(listRaw) : { clientW: 0, scrollW: 0 };
      // 形态判据用**实测轨道数**而非宽度阈值：窄态下 min-width 被置 0（阈值会回落到
      // 兜底值 → 中间宽度区间会误判形态）；轨道数 2 = 两行式、>2 = 多列表格，直接反映
      // 当前生效的布局。宽度仅作日志。
      const narrow = card.columns <= 2;
      lib.log(`container width=${list.clientW}, tracks=${card.columns} → ${narrow ? '两行式（窄）' : '多列表格（宽）'}`);

      if (!narrow) {
        // 列数自洽：表头与渠道行同为 N 列（模板显式定义，不再有隐式行）——N 随功能演进
        // （当前 9：协议/供应商/BaseURL/Key/模型/上下文/思考/连通性/删除）
        assert('G1_columns_explicit', header.columns >= 8 && header.columns === card.columns,
          `header=${header.columns} card=${card.columns}（期望相等且 ≥8）`);

        // 同行判定：极差须显著小于一个行高。同行内高度不同的单元格在 align-items:center
        // 下 offsetTop 有数 px 差异（列增多/控件高矮不一时变大，实测 1–6px），
        // 而「被挤到隐式新行」会差整整一个行高（≥32px）。
        const offTops = card.kids.map((k) => k.offTop);
        const spread = Math.max.apply(null, offTops) - Math.min.apply(null, offTops);
        assert('G2_single_row', spread <= 16,
          `单元格 offsetTop 极差=${spread}px（期望 ≤16 = 同一行；独占新行会差 ≥32px）`);

        const overflowing = card.kids.filter((k) => k.scrollW > k.clientW + 1);
        assert('G3_no_inner_overflow', overflowing.length === 0,
          `溢出单元格=${overflowing.length}（期望 0 = 文字不重合）`);

        const sameCols = header.colWidths.length === card.colWidths.length
          && header.colWidths.every((w, i) => Math.abs(w - card.colWidths[i]) <= 2);
        assert('G4_columns_aligned', sameCols,
          `header=[${header.colWidths.join(',')}] card=[${card.colWidths.join(',')}]`);

        assert('G5_min_width_shared', header.minWidth > 0 && header.minWidth === card.minWidth,
          `header minWidth=${header.minWidth} card minWidth=${card.minWidth}`);
      } else {
        const n = JSON.parse(await lib.evalJs(c2, `(function(){
          var grid = document.querySelector('.gewu-endpoint-card__grid');
          var head = document.querySelector('.gewu-endpoint-list-header');
          var labels = [].slice.call(grid.querySelectorAll('.gewu-endpoint-field-label'));
          var controls = [].slice.call(grid.children).filter(function(k){
            return !k.classList.contains('gewu-endpoint-field-label');
          });
          return JSON.stringify({
            headerDisplay: head ? getComputedStyle(head).display : 'none',
            cols: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
            labelsVisible: labels.filter(function(l){ return getComputedStyle(l).display !== 'none'; }).length,
            labelsTotal: labels.length,
            pairs: controls.every(function(k){
              var prev = k.previousElementSibling;
              return !!prev && prev.classList.contains('gewu-endpoint-field-label');
            }),
            minWidth: Math.round(parseFloat(getComputedStyle(grid).minWidth) || 0),
          });
        })()`));
        const listW = JSON.parse(await lib.evalJs(c2, `(function(){
          var el = document.querySelector('.gewu-model-list');
          return JSON.stringify({ clientW: el.clientWidth, scrollW: el.scrollWidth });
        })()`));

        assert('N1_header_hidden', n.headerDisplay === 'none', `header display=${n.headerDisplay}`);
        assert('N2_two_line_columns', n.cols === 2, `grid 轨道数=${n.cols}（期望 2 = 标签|控件）`);
        // 标签数由 DOM 实测（当前 9 个字段），要求全部显形
        assert('N3_labels_visible', n.labelsVisible === n.labelsTotal && n.labelsTotal >= 8,
          `标签显形 ${n.labelsVisible}/${n.labelsTotal}（期望全显形且 ≥8）`);
        assert('N5_label_control_pairs', n.pairs === true, `每个控件前一个兄弟均为标签=${n.pairs}`);
        assert('N4_no_horizontal_scroll', listW.scrollW <= listW.clientW + 1,
          `列表 scrollWidth=${listW.scrollW} clientWidth=${listW.clientW}（期望不再横向滚动）`);
      }

      fs.mkdirSync(path.join(ROOT, 'acceptance', 'block-81'), { recursive: true });
      await lib.screenshotPng(c2, path.join(ROOT, 'acceptance', 'block-81'), 'ui342-endpoint-grid.png');
    } finally {
      try { c2.socket.close(); } catch { /* ignore */ }
      try { client.socket.close(); } catch { /* ignore */ }
    }
    return true;
  },
};
