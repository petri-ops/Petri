// ============================================================
// appKeymap — 应用级命令键位的**单一真相**（BLOCK-200 P0-1）。
//
// 立项事实（plan §0.1，全经实码抽验）：此前键位是**三份互不复用的显示文本 + 零注册表
// 零派发器**——`CommandPalette.tsx:13` 的 `shortcut` 只是自由文本徽章、`:66` 另有一份
// 硬编码 `SHORTCUTS` 清单、`:383-391` 唯一真绑定写死 `e.key==='k'`，而
// `useAppCommands.ts:71` 的 `nav-home` 挂着 `⌘N` 徽章却**全仓没有 Cmd+N 处理器**
// （UI 向用户承诺了一个不存在的快捷键）。本模块把「显示」与「派发」合成一件事：
// 徽章文本由注册表派生，派发器读的也是注册表，二者不可能再漂移。
//
// 组合串语法与本文件的关系：语法的**权威实现就是这里**（只有这里需要解析
// KeyboardEvent）；写侧边界守卫是 `core/packages/shared-config/config-schema.js`
// 的 `KEYMAP_COMBO_PATTERN`，两者由 `appKeymap.drift.test.ts` 对账（串行化产物必须过
// 后端正则、后端正则放过的畸形串必须被这里拒），沿用 `src/ipc/channels.js` ↔
// `preload.js` 字面量副本 + 双向守护测的本仓先例。
//
// 纪律：纯函数、零 React、零网络——状态与副作用一律在 `useAppKeymap`。
// ============================================================

/** 修饰键的规范顺序（`Mod`=macOS 用 Cmd、其余平台用 Ctrl，跨平台唯一可移植写法）。 */
const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift'] as const;
type ModifierName = (typeof MODIFIER_ORDER)[number];

/** 命名键：`Space` 存储、事件里是 `' '`；其余与 `KeyboardEvent.key` 同名。 */
const NAMED_KEYS = [
  'Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 'Home', 'End',
  'PageUp', 'PageDown', 'Space', 'Up', 'Down', 'Left', 'Right',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
] as const;

const PUNCTUATION_KEYS = [',', '.', '/', '-', ';', "'", '=', '`', '[', ']', '\\'] as const;

export interface ParsedCombo {
  modifiers: ModifierName[];
  /** 规范化后的键名：字母大写、命名键原名、标点原样（`Space` 而非 `' '`）。 */
  key: string;
}

type BindableScope = 'app' | 'local';

export interface KeymapCommand {
  /** 稳定 id：应用级命令取 `useAppCommands` 的命令 id，其余取 `域.动作`。 */
  id: string;
  label: string;
  /** 默认组合串；**逐字等于迁移前硬编码值**（D-1：新族默认值=现状）。 */
  defaultCombo: string;
  /**
   * `app`=由 App 级派发器执行（动作在命令源里，可直接派发）；
   * `local`=语义绑定留在组件内（焦点态/路由/capability 门不能上收到全局），
   * 组件只从本注册表读组合串而不再自己写死键名。
   */
  scope: BindableScope;
  description: string;
}

/**
 * 可绑定的应用级命令清单。刻意**不含**那批就近语义绑定（Escape 类 12 处、Cmd+S 保存、
 * Cmd+Enter 提交、Ctrl+Tab 切签、裸键聚焦、原生菜单加速器）——它们的生效条件依赖局部
 * 焦点/路由状态，抽进全局注册表只会把条件搬成全局特例（plan §1「刻意不做的重构」）。
 */
export const KEYMAP_COMMANDS: readonly KeymapCommand[] = Object.freeze([
  { id: 'palette.toggle', label: '命令面板', defaultCombo: 'Mod+K', scope: 'app', description: '打开/关闭命令面板' },
  { id: 'nav-home', label: '欢迎页 · 新对话', defaultCombo: 'Mod+N', scope: 'app', description: '回到欢迎页并开始新对话' },
  { id: 'nav-projects', label: '项目库', defaultCombo: 'Mod+Shift+P', scope: 'app', description: '全部分析项目' },
  { id: 'nav-knowledge', label: '知识空间', defaultCombo: 'Mod+Shift+K', scope: 'app', description: '知识与资料台' },
  { id: 'nav-review', label: '审阅工作区', defaultCombo: 'Mod+Shift+R', scope: 'app', description: '工作树变更审阅' },
  { id: 'nav-settings', label: '设置', defaultCombo: 'Mod+Shift+S', scope: 'app', description: '外观 / 模型 / 诊断' },
  { id: 'command-center.popOut', label: '指挥中心独立窗', defaultCombo: 'Mod+Shift+C', scope: 'app', description: '弹出/聚焦指挥中心单例窗' },
  { id: 'workspace.toggleTerminal', label: '底部终端', defaultCombo: 'Mod+`', scope: 'local', description: '开合工作区底部终端' },
  { id: 'workspace.toggleRight', label: '右侧栏', defaultCombo: 'Mod+Shift+B', scope: 'local', description: '开合工作区右侧栏' },
  { id: 'thinking.cycle', label: '思考档位循环', defaultCombo: 'Mod+T', scope: 'local', description: '在 off/standard/high 间循环（仅声明 reasoning 能力的渠道生效）' },
]);

function isModifierName(value: string): value is ModifierName {
  return (MODIFIER_ORDER as readonly string[]).includes(value);
}

/** `Space` ↔ 事件 `' '` 等映射：存储名 → `KeyboardEvent.key`。 */
function eventKeyOf(storedKey: string): string {
  return storedKey === 'Space' ? ' ' : storedKey;
}

/** `KeyboardEvent.key` → 存储名（字母大写、`' '`→`Space`、F 键与命名键原样）。 */
function storedKeyFromEventKey(raw: string): string {
  if (raw === ' ') return 'Space';
  if (raw.length === 1) return raw.toUpperCase();
  const named = NAMED_KEYS.find((name) => name.toLowerCase() === raw.toLowerCase());
  if (named) return named;
  return /^[A-Z0-9]$|^[,./\-;'`=[\]\\]$/.test(raw) ? raw.toUpperCase() : raw;
}

/**
 * 解析组合串（大小写不敏感、修饰键顺序不敏感）。
 * 返回 `null` = 语法不合法（含**裸键**：无修饰键的组合一律拒，见下方理由）。
 * 至少一个修饰键是刻意的：裸键绑定会在输入框里劫持打字，属不可接受默认。
 */
export function parseCombo(raw: unknown): ParsedCombo | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  const segments = text.split('+').map((segment) => segment.trim());
  if (segments.length < 2) return null; // 无修饰键 → 拒
  const keyToken = segments[segments.length - 1];
  const modTokens = segments.slice(0, -1);
  if (!keyToken) return null;
  const modifiers: ModifierName[] = [];
  for (const token of modTokens) {
    const normalized = token === 'Command' || token === 'Meta' ? 'Mod' : token.length === 1 && token.toLowerCase() === 'm' ? 'Mod' : token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    if (!isModifierName(normalized)) return null;
    if (modifiers.includes(normalized)) return null; // 重复修饰键 = 畸形串
    modifiers.push(normalized);
  }
  const isSingleLetter = /^[A-Za-z]$/.test(keyToken);
  const isDigit = /^[0-9]$/.test(keyToken);
  const named = NAMED_KEYS.find((name) => name.toLowerCase() === keyToken.toLowerCase());
  const isPunct = (PUNCTUATION_KEYS as readonly string[]).includes(keyToken);
  const isFunction = /^F(?:[1-9]|1[0-2])$/i.test(keyToken);
  if (!isSingleLetter && !isDigit && !named && !isPunct && !isFunction) return null;
  return {
    modifiers: MODIFIER_ORDER.filter((name) => modifiers.includes(name)),
    key: isPunct ? keyToken : isFunction ? keyToken.toUpperCase() : isSingleLetter || isDigit ? keyToken.toUpperCase() : (named as string),
  };
}

/** 序列化为规范组合串（修饰键按 `MODIFIER_ORDER` 排序）；解析失败返回 `null`。 */
export function serializeCombo(combo: ParsedCombo | null): string | null {
  if (!combo || !combo.key) return null;
  return [...combo.modifiers, combo.key].join('+');
}

export function normalizeCombo(raw: unknown): string | null {
  return serializeCombo(parseCombo(raw));
}

/** 从键盘事件构造组合串；未按修饰键返回 `null`（不抢裸键）。 */
export function comboFromEvent(event: KeyboardEvent): string | null {
  const modifiers: ModifierName[] = [];
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  if (isMac ? event.metaKey : event.ctrlKey) modifiers.push('Mod');
  // 非 Mac 上 ctrlKey 已经吃进 Mod；显式 Ctrl 只在 Mac 上作为独立修饰键存在
  if (isMac && event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (modifiers.length === 0) return null;
  const stored = storedKeyFromEventKey(event.key);
  if (!stored || stored === 'Unidentified') return null;
  // Shift 按下时字母/数字键的 `e.key` 已是移位后的字符（`b`→`B`、`1`→`!`）；
  // 移位标点无法还原原始键位，故带 Shift 的标点组合在此如实拒绑（不静默错绑成别的键）。
  if (event.shiftKey && /^[^A-Za-z0-9]$/.test(stored) && !(PUNCTUATION_KEYS as readonly string[]).includes(stored)) return null;
  return serializeCombo({ modifiers: MODIFIER_ORDER.filter((name) => modifiers.includes(name)), key: stored });
}

/** 组合串是否命中该事件（派发器与录制态高亮共用，避免两处各写一份比较逻辑）。 */
export function matchesCombo(combo: string | null, event: KeyboardEvent): boolean {
  const parsed = parseCombo(combo);
  if (!parsed || parsed.modifiers.length === 0) return false;
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const modWanted = parsed.modifiers.includes('Mod');
  const actualMod = isMac ? event.metaKey : event.ctrlKey;
  if (modWanted !== actualMod) return false;
  if (isMac && parsed.modifiers.includes('Ctrl') !== event.ctrlKey) return false;
  if (parsed.modifiers.includes('Alt') !== event.altKey) return false;
  if (parsed.modifiers.includes('Shift') !== event.shiftKey) return false;
  return event.key === eventKeyOf(parsed.key) || storedKeyFromEventKey(event.key) === parsed.key;
}

type KeymapOverrides = Record<string, string | null>;

/** 生效键位：用户覆盖优先，`null`/空串=解绑该命令；未覆盖取默认。 */
export function resolveKeymap(overrides: KeymapOverrides | null | undefined): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const command of KEYMAP_COMMANDS) {
    const override = overrides ? overrides[command.id] : undefined;
    if (override === null || override === undefined || override === '') {
      out[command.id] = override === null ? null : command.defaultCombo;
      continue;
    }
    const normalized = normalizeCombo(override);
    out[command.id] = normalized === null ? command.defaultCombo : normalized;
  }
  return out;
}

export interface KeymapConflict {
  combo: string;
  commandIds: string[];
}

/** 冲突检测：同一组合串被两个及以上命令占用即报（解绑与非法值不参与）。 */
export function findConflicts(bindings: Record<string, string | null>): KeymapConflict[] {
  const byCombo = new Map<string, string[]>();
  for (const [id, combo] of Object.entries(bindings)) {
    if (!combo) continue;
    const list = byCombo.get(combo) || [];
    list.push(id);
    byCombo.set(combo, list);
  }
  return [...byCombo.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([combo, ids]) => ({ combo, commandIds: ids }))
    .sort((a, b) => a.combo.localeCompare(b.combo));
}

/** 显示文本：`Mod+Shift+B` → macOS `⌘⇧B` / 其他 `Ctrl+Shift+B`（徽章与派发同源）。 */
export function formatCombo(combo: string | null, isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')): string {
  const parsed = parseCombo(combo);
  if (!parsed) return '';
  const glyph: Record<ModifierName, string> = isMac
    ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }
    : { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
  const keyDisplay = parsed.key === 'Space' ? 'Space' : parsed.key;
  return isMac
    ? parsed.modifiers.map((m) => glyph[m]).join('') + keyDisplay
    : [...parsed.modifiers.map((m) => glyph[m]), keyDisplay].join('+');
}
