// BLOCK-200 跨端对账：键位命令源（前端真相）与配置注册表（写侧守卫）不得漂移；
// 以及组合串语法在两侧的接受/拒绝集合必须一致。
// 沿用本仓 `src/ipc/channels.js` ↔ `preload.js` 字面量副本 + 双向守护测的先例——
// 两处必须各持一份字面量时，用测钉住等价，而不是让运行时互相 require。
import { describe, it, expect } from 'vitest';
// CJS 单源语法/注册表，只在测试里跨语言对账（生产构建不引 CJS，故不为它手写 .d.ts）。
// @ts-expect-error 无声明文件；vitest 走 CJS 互操作可用
import * as rawSchema from '../../../core/packages/shared-config/config-schema.js';

// 在测试边界显式收窄（不是绕过检查）：无 .d.ts 的 CJS 模块不这样收窄会整文件落在 error-typed 上
interface RegistryEntry { key: string; family: string; path: string; domain?: { pattern?: string } }
const { KEYMAP_COMBO_RE, CONFIG_KEYS, findEntryByPath, validateValue } = rawSchema as unknown as {
  KEYMAP_COMBO_RE: RegExp;
  CONFIG_KEYS: RegistryEntry[];
  findEntryByPath: (family: string, path: string) => RegistryEntry | null;
  validateValue: (entry: RegistryEntry | null | undefined, raw: unknown) => { ok: boolean; code?: string; message?: string };
};
import { KEYMAP_COMMANDS, normalizeCombo, parseCombo } from './appKeymap';

const registryKeymapIds = CONFIG_KEYS.filter((entry) => entry.family === 'keymap').map((entry) => entry.path);
const sampleEntry = CONFIG_KEYS.find((entry) => entry.key === 'keymap.palette.toggle');

describe('键位命令源 ↔ 注册表集合对账', () => {
  it('两侧命令 id 集合**完全相等**（少一侧=漂移：注册表缺则垃圾能进盘，命令源缺则改了没人执行）', () => {
    expect(registryKeymapIds.slice().sort()).toEqual(KEYMAP_COMMANDS.map((command) => command.id).slice().sort());
  });

  it('每个命令 id 都能按族+存储路径查到声明（占位形已排除，未知 id 必须查不到）', () => {
    for (const command of KEYMAP_COMMANDS) {
      expect(findEntryByPath('keymap', command.id), command.id).toBeTruthy();
    }
    expect(findEntryByPath('keymap', 'nav-typo')).toBeNull();
    expect(findEntryByPath('keymap', '../../etc/passwd')).toBeNull();
  });
});

describe('键位语法跨端对账', () => {
  it('注册表确实声明了 keymap 族且写侧守卫就是那条正则（不是另造一份）', () => {
    expect(sampleEntry, 'keymap.palette.toggle 必须在注册表里').toBeTruthy();
    expect(sampleEntry?.domain?.pattern).toBe(KEYMAP_COMBO_RE.source);
  });

  it('每个出厂默认键位都能过后端写侧守卫（默认值不得是后端会拒的值）', () => {
    for (const command of KEYMAP_COMMANDS) {
      const check = validateValue(sampleEntry, command.defaultCombo);
      expect(check.ok, `${command.id}=${command.defaultCombo} 被注册表拒：${check.message}`).toBe(true);
    }
  });

  it('编解码器的**规范化产物**一律过后端守卫（存储侧只可能是规范化产物，含乱序输入）', () => {
    const messy = ['shift+mod+b', 'Alt+Mod+K', 'Shift+Ctrl+Alt+M', 'Mod+k', 'mod+f1', ' Command +K'];
    for (const raw of messy) {
      const normalized = normalizeCombo(raw);
      expect(normalized, raw).not.toBeNull();
      const check = validateValue(sampleEntry, normalized);
      expect(check.ok, `规范化产物被后端拒：${normalized}（${check.message}）`).toBe(true);
    }
  });

  it('两侧拒绝集合一致：编解码器拒的畸形串后端也必须拒（后端不得松到能收垃圾）', () => {
    // 注意 `Alt+Mod+K` **不在**此列：它是合法但非规范序的输入，编解码器会规范化成
    // `Mod+Alt+K`（上面 messy 用例正查这条），两侧都接受是对的。
    const rejected = ['K', 'Mod+', 'Mod+Mod+K', 'Mod+Shift+Shift+K', 'Super+K', 'Mod+£', ''];
    for (const raw of rejected) {
      expect(parseCombo(raw), raw).toBeNull();
      const check = validateValue(sampleEntry, raw);
      expect(check.ok, `后端放行了编解码器拒的串：${raw}`).toBe(false);
    }
  });
});
