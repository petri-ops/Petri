import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scoreSus, scoreUmuxLite, parseParticipants, buildReport } from '../scripts/e03-score.mjs';

// E-03 机械核算契约（BLOCK-503 甲3 口径锚定）：
// ① SUS 标准计分向量 ② UMUX-Lite 主分只取前两题 ③ CSV 解析 fail-closed
// ④ <8 人不出总体分 ⑤ 老/新与持续意愿读数在案。

describe('E-03 SUS / UMUX-Lite 机械核算（甲3 口径）', () => {
  const head = 'pid,veteran,tasks,sus1,sus2,sus3,sus4,sus5,sus6,sus7,sus8,sus9,sus10,umux1,umux2,umux3,date';

  it('SUS 标准向量：全 5→100、全 3→50、全 1→0', () => {
    assert.equal(scoreSus([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]), 100);
    assert.equal(scoreSus([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]), 50);
    assert.equal(scoreSus([1, 5, 1, 5, 1, 5, 1, 5, 1, 5]), 0);
  });

  it('SUS 混合向量与边界：9 题不行 / 0 或 6 选项抛错', () => {
    assert.throws(() => scoreSus([3, 3, 3, 3, 3, 3, 3, 3, 3]), /恰好 10/);
    assert.throws(() => scoreSus([0, 1, 1, 1, 1, 1, 1, 1, 1, 1]), /非法/);
    assert.throws(() => scoreSus([6, 1, 1, 1, 1, 1, 1, 1, 1, 1]), /非法/);
    // 混合: [4,2,4,2,4,2,4,2,4,2] → odd (4-1)*5=15 + even (5-2)*5=15 = 30×2.5=75
    assert.equal(scoreSus([4, 2, 4, 2, 4, 2, 4, 2, 4, 2]), 75);
  });

  it('UMUX-Lite 主分只取前两题；第 3 题单独读数；越界抛错', () => {
    assert.equal(scoreUmuxLite(7, 7, 1).main, 100);
    assert.equal(scoreUmuxLite(4, 4, 4).main, 50);
    assert.equal(scoreUmuxLite(1, 1, 7).main, 0);
    assert.equal(scoreUmuxLite(6, 5, 3).continueIntent, 3);
    assert.throws(() => scoreUmuxLite(8, 5, 5), /非法/);
    assert.throws(() => scoreUmuxLite(5, 0, 5), /非法/);
  });

  it('CSV 解析：缺列/列数不齐/veteran 非法全部 fail-closed', () => {
    const row = (v) => `P1,${v},coding,4,2,4,2,4,2,4,2,4,2,6,5,3,2026-11-20`;
    const good = parseParticipants([head, row('old')].join('\n'));
    assert.equal(good.length, 1);
    assert.equal(good[0].veteran, 'old');
    assert.throws(() => parseParticipants('pid,veteran\nP1,old'), /缺列/);
    assert.throws(() => parseParticipants([head, 'P1,old,coding,1,1'].join('\n')), /列数/);
    assert.throws(() => parseParticipants([head, row('bogus')].join('\n')), /veteran 非法/);
  });

  it('汇总：≥8 人出总体分；<8 人 population=null 只报个案；老/新与持续意愿在案', () => {
    const row = (pid, v, task) => `${pid},${v},${task},4,2,4,2,4,2,4,2,4,2,6,5,4,2026-11-20`;
    const eight = parseParticipants([head, ...Array.from({ length: 8 }, (_, i) => row(`P${i + 1}`, i % 2 === 0 ? 'old' : 'new', i % 3 === 0 ? 'coding' : i % 3 === 1 ? 'review' : 'settings'))].join('\n'));
    const full = buildReport(eight, { source: 'test' });
    assert.equal(full.n, 8);
    assert.equal(full.belowMinimum, false);
    assert.equal(full.population.susMean, 75);
    assert.equal(full.population.umuxMean, ((6 - 1) + (5 - 1)) / 12 * 100);
    assert.equal(full.continueIntentMean, 4);
    assert.equal(full.veterans.old.n, 4);
    assert.equal(full.taskTypes.length, 3);

    const three = parseParticipants([head, row('P1', 'old', 'coding'), row('P2', 'new', 'review'), row('P3', 'old', 'settings')].join('\n'));
    const small = buildReport(three, { source: 'test' });
    assert.equal(small.belowMinimum, true);
    assert.equal(small.population, null);
    assert.match(small.note, /只报个案/);
  });
});
