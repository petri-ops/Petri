import { describe, expect, it } from 'vitest';
import { isQuietTime, normalizeQuietHours, parseQuietHours, validateQuietHoursInput } from './quiet-hours';

function at(hour: number, minute = 0): Date {
  return new Date(2026, 0, 1, hour, minute, 0);
}

describe('quiet-hours', () => {
  it('空串=关闭；非法值归一为空', () => {
    expect(parseQuietHours('')).toBeNull();
    expect(isQuietTime('', at(12))).toBe(false);
    expect(normalizeQuietHours('22:00-08:0')).toBe('');
    expect(validateQuietHoursInput('22:00-08:0')).toContain('HH:MM-HH:MM');
  });

  it('普通窗口（09:00-18:00）边界：含起点、不含终点', () => {
    expect(isQuietTime('09:00-18:00', at(8, 59))).toBe(false);
    expect(isQuietTime('09:00-18:00', at(9, 0))).toBe(true);
    expect(isQuietTime('09:00-18:00', at(17, 59))).toBe(true);
    expect(isQuietTime('09:00-18:00', at(18, 0))).toBe(false);
  });

  it('跨午夜（22:00-08:00）覆盖两侧', () => {
    expect(isQuietTime('22:00-08:00', at(23))).toBe(true);
    expect(isQuietTime('22:00-08:00', at(3))).toBe(true);
    expect(isQuietTime('22:00-08:00', at(12))).toBe(false);
  });

  it('起止相同=空窗口（不误伤全天）', () => {
    expect(isQuietTime('08:00-08:00', at(8))).toBe(false);
  });

  it('合法格式通过校验并原样归一', () => {
    expect(validateQuietHoursInput('22:00-08:00')).toBeNull();
    expect(normalizeQuietHours(' 22:00-08:00 ')).toBe('22:00-08:00');
  });
});
