/**
 * block214-pack-skills — Q-DOMAIN P1：领域包 skills 货架实机腿。
 *
 * 只连 9223 测试实例（永久红线：探针禁止导航用户主窗 9222）。
 * 用法：
 *   BLOCK214_EXPECT=pack  npm run verify -- block214-pack-skills   # pack 已安装
 *   BLOCK214_EXPECT=absent npm run verify -- block214-pack-skills  # pack 未安装
 * 证据：acceptance/block-214/
 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');

const OUT = path.join(process.cwd(), 'acceptance', 'block-214');
const EXPECT = () => process.env.BLOCK214_EXPECT === 'absent' ? 'absent' : 'pack';

const BIO_SKILLS = ['标准差异表达分析', 'GO 富集分析', '标准单细胞分析'];

async function waitForText(client, predicate, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = await lib.evalJs(client, 'document.body ? (document.body.innerText || "") : ""');
    if (predicate(text)) return text;
    await new Promise((r) => setTimeout(r, 500));
  }
  return lib.evalJs(client, 'document.body ? (document.body.innerText || "") : ""');
}

module.exports = {
  id: 'block214-pack-skills',
  description: 'Q-DOMAIN P1：领域包 skills 在货架的来源标签/消失三态',
  evidenceDir: OUT,
  async run({ assert }) {
    fs.mkdirSync(OUT, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 30000 });

    const url = `http://localhost:3000/extensions?tab=domain-skills&test=${EXPECT() === 'pack' ? '1' : '2'}`;
    await lib.evalJs(client, `(() => { location.href = ${JSON.stringify(url)}; return true; })()`);
    const text = await waitForText(client, (t) => t.includes('搜索领域技能') || t.includes('扩展中心'));

    const screenshot = EXPECT() === 'pack' ? 'ui-pack-skills-installed.png' : 'ui-pack-skills-absent.png';
    await lib.screenshotPng(client, OUT, screenshot);

    if (EXPECT() === 'pack') {
      assert('pack 在位：货架出现「领域包」来源标签', text.includes('领域包'));
      for (const name of BIO_SKILLS) {
        assert(`pack 在位：货架出现「${name}」`, text.includes(name));
      }
    } else {
      assert('pack 缺失/卸载：货架不再出现三个生信 skill', BIO_SKILLS.every((name) => !text.includes(name)));
      assert('pack 缺失/卸载：领域技能货架为空态', text.includes('暂无匹配的领域技能') || text.includes('0 项'));
    }
  },
};
