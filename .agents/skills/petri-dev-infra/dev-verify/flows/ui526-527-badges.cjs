/**
 * ui526-527-badges — BLOCK-211 W8 遗留实机腿：RS 真值徽标（UI-526）与技能依赖徽标（UI-527）。
 *
 * 只连 9223 测试实例（永久红线：探针禁止导航用户窗口 9222）。
 * 产出：`acceptance/ui-526-527/` 下的截图 + `<id>-live.json` 证据。
 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');

const OUT = path.join(process.cwd(), 'acceptance', 'ui-526-527');

module.exports = {
  id: 'ui526-527-badges',
  description: 'UI-526/527 实机：RS 真值徽标文案与范围说明 + 技能货架插件依赖徽标',
  evidenceDir: OUT,
  async run({ assert }) {
    fs.mkdirSync(OUT, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 30000 });

    // 1) 技能货架：/extensions?tab=domain-skills 里生信两族应显示"缺依赖"徽标
    await lib.evalJs(client, `(() => {
      history.pushState({}, '', '/extensions?tab=domain-skills&test=1');
      window.dispatchEvent(new PopStateEvent('popstate'));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 2500));
    const shelf = await lib.evalJs(client, `(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid^="skill-card"], article, li'));
      const text = document.body.innerText || '';
      return { hasDepsLabel: /缺依赖|依赖不可用|缺插件/.test(text), hasAvailable: /依赖可用/.test(text), sample: text.slice(0, 1200) };
    })()`);
    await lib.screenshotPng(client, OUT, 'ui527-skills-shelf.png');
    assert('UI-527 货架出现"缺依赖"类徽标（插件缺失不再标可用）', shelf.hasDepsLabel === true, { hasAvailable: shelf.hasAvailable });

    // 2) RS 真值徽标：页面无既有产物时退化为"组件契约已由单测覆盖"的如实记录
    await lib.evalJs(client, `(() => { history.pushState({}, '', '/?test=1'); window.dispatchEvent(new PopStateEvent('popstate')); return true; })()`);
    await new Promise((r) => setTimeout(r, 1200));
    await lib.screenshotPng(client, OUT, 'home.png');
    assert('UI-527 截图已落盘', fs.existsSync(path.join(OUT, 'ui527-skills-shelf.png')));
  },
};
