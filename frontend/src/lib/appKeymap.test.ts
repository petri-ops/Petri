// BLOCK-200 P1 键位编解码契约测：语法、规范化、冲突、显示与派发的同源关系。
import { describe, it, expect } from 'vitest';
import {
  KEYMAP_COMMANDS,
  parseCombo,
  serializeCombo,
  normalizeCombo,
  comboFromEvent,
  matchesCombo,
  resolveKeymap,
  findConflicts,
  formatCombo,
} from './appKeymap';

function keyEvent(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    key: init.key,
    ctrlKey: !!init.ctrlKey,
    metaKey: !!init.metaKey,
    altKey: !!init.altKey,
    shiftKey: !!init.shiftKey,
    repeat: !!init.repeat,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as KeyboardEvent;
}

describe('appKeymap 组合串语法', () => {
  it('解析并规范化修饰键顺序与键名大小写', () => {
    expect(normalizeCombo('shift+mod+b')).toBe('Mod+Shift+B');
    expect(normalizeCombo('Mod+k')).toBe('Mod+K');
    expect(normalizeCombo('Mod+shift')).toBeNull(); // 缺主键
    expect(normalizeCombo('Mod+F10')).toBe('Mod+F10');
    expect(normalizeCombo('Mod+Space')).toBe('Mod+Space');
    expect(normalizeCombo('Mod+Meta')).toBeNull(); // 修饰键不能当主键
  });

  it('裸键一律拒（会劫持输入框打字），至少一个修饰键才成立', () => {
    expect(parseCombo('K')).toBeNull();
    expect(parseCombo('1')).toBeNull();
    expect(parseCombo('Escape')).toBeNull();
    expect(parseCombo('Mod+K')).not.toBeNull();
  });

  it('畸形串拒：重复修饰键 / 空段 / 未知修饰键 / 非白名单主键', () => {
    expect(parseCombo('Mod+Mod+K')).toBeNull();
    expect(parseCombo('Mod++K')).toBeNull();
    expect(parseCombo('Super+K')).toBeNull();
    expect(parseCombo('Mod+£')).toBeNull();
  });

  it('往返稳定：规范化串的 parse→serialize 必须恒等', () => {
    for (const command of KEYMAP_COMMANDS) {
      const parsed = parseCombo(command.defaultCombo);
      expect(parsed, command.id).not.toBeNull();
      expect(serializeCombo(parsed)).toBe(command.defaultCombo);
    }
  });
});

describe('appKeymap 事件侧', () => {
  it('comboFromEvent 与 matchesCombo 对同一事件互逆（派发与录制同源）', () => {
    const win = keyEvent({ key: 'k', ctrlKey: true });
    const combo = comboFromEvent(win);
    expect(combo).toBe('Mod+K'); // 非 mac 平台 Ctrl 即 Mod
    expect(matchesCombo(combo, win)).toBe(true);
    const shifted = keyEvent({ key: 'B', ctrlKey: true, shiftKey: true });
    expect(comboFromEvent(shifted)).toBe('Mod+Shift+B');
    expect(matchesCombo('Mod+Shift+B', shifted)).toBe(true);
    // 少了 Shift 必须不匹配（否则「显示 B 实际按 b」又会回来）
    expect(matchesCombo('Mod+Shift+B', keyEvent({ key: 'b', ctrlKey: true }))).toBe(false);
  });

  it('未按修饰键返回 null，不抢裸键', () => {
    expect(comboFromEvent(keyEvent({ key: 'a' }))).toBeNull();
    expect(matchesCombo(null, keyEvent({ key: 'a' }))).toBe(false);
  });

  it('Shift 下移位标点无法还原键位 → 如实拒绑而不是错绑成别的键', () => {
    expect(comboFromEvent(keyEvent({ key: '!', ctrlKey: true, shiftKey: true }))).toBeNull();
    // 但显式声明的组合仍可匹配自身
    expect(matchesCombo('Mod+Shift+/', keyEvent({ key: '/', ctrlKey: true, shiftKey: true }))).toBe(true);
  });
});

describe('appKeymap 生效与冲突', () => {
  it('覆盖优先、null=解绑、非法覆盖回落默认（不静默采纳坏值）', () => {
    const resolved = resolveKeymap({ 'nav-home': 'Mod+Shift+N', 'nav-projects': null, 'nav-review': 'not-a-combo' });
    expect(resolved['nav-home']).toBe('Mod+Shift+N');
    expect(resolved['nav-projects']).toBeNull();
    expect(resolved['nav-review']).toBe('Mod+Shift+R');
  });

  it('冲突检测点名共用同一组合的命令；解绑不参与冲突', () => {
    const conflicts = findConflicts(resolveKeymap({ 'nav-projects': 'Mod+K' }));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].combo).toBe('Mod+K');
    expect(conflicts[0].commandIds.sort()).toEqual(['nav-projects', 'palette.toggle']);
    expect(findConflicts(resolveKeymap({ 'nav-home': null, 'nav-settings': null }))).toHaveLength(0);
  });

  it('默认键位集合自身零冲突（出厂即可用，不是配完就红）', () => {
    expect(findConflicts(resolveKeymap({}))).toHaveLength(0);
  });

  it('命令清单 id 唯一且 scope 只允许 app/local', () => {
    const ids = KEYMAP_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of KEYMAP_COMMANDS) expect(['app', 'local']).toContain(command.scope);
  });
});

describe('appKeymap 显示文本', () => {
  it('同一组合在 mac/非 mac 各出一种写法，未知串出空串（不显示假徽章）', () => {
    expect(formatCombo('Mod+Shift+B', true)).toBe('⌘⇧B');
    expect(formatCombo('Mod+Shift+B', false)).toBe('Ctrl+Shift+B');
    expect(formatCombo('garbage', true)).toBe('');
    expect(formatCombo(null, true)).toBe('');
  });
});
