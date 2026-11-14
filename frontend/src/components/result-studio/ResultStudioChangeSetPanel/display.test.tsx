import { describe, expect, it } from 'vitest';
import { displayValue, publicDisplayText, INTERNAL_ID_LABEL } from './display';

/**
 * BLOCK-448 — 公开投影脱敏（前端展示层单源）。
 *
 * 事故面：`ResultStudioChangeSetPanel` 的「参数与结构变化」把 jsonDiffs 的字段 diff
 * 交给 `displayValue`（同时写进 `<code>` 与 `title`），当被改字段是 `toolJobId` 一类
 * 时 `job_…` 直接出现在版本面板上 —— P6 `publicProjectionClean` 断言实测命中 3 次
 * （`CODE. @Result Studio 版本与变更 :: job_…`）。
 */
describe('publicDisplayText 公开投影脱敏（BLOCK-448）', () => {
  it('内部任务/主键标识替换为统一文案', () => {
    expect(publicDisplayText('toolJobId: job_3ce8d7f68a8e4285')).toBe(
      `toolJobId: ${INTERNAL_ID_LABEL}`,
    );
    expect(publicDisplayText('rev_a1b2c3d4e5 → rev_f6g7h8i9j0')).toBe(
      `${INTERNAL_ID_LABEL} → ${INTERNAL_ID_LABEL}`,
    );
    expect(publicDisplayText('p_mwg2oghc_jl85')).toBe(INTERNAL_ID_LABEL);
  });

  it('路径脱敏既有行为不变（回归护栏）', () => {
    expect(publicDisplayText('/Users/alice/work/result.png')).toBe('[project file]');
  });

  it('普通文本与短缩写不被误伤', () => {
    const keep = '原始分析结果 · 3 个版本 · 影响待确认';
    expect(publicDisplayText(keep)).toBe(keep);
    expect(publicDisplayText('p_1 说明与 table_1')).toBe('p_1 说明与 table_1');
  });

  it('displayValue 对对象走 JSON 后同样脱敏（覆盖 title 属性面）', () => {
    const rendered = displayValue({ toolJobId: 'job_abcdef123456' });
    expect(rendered).toContain(INTERNAL_ID_LABEL);
    expect(rendered).not.toContain('job_abcdef123456');
  });
});
