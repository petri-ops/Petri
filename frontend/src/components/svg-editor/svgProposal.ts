/**
 * BLOCK-342 W4 — 改动清单与逐元素取舍（幽灵叠加的判定层）。
 *
 * 输入是「磁盘真值」与「当前未保存视图」两份 markup，输出逐元素差异；
 * 每个差异可折算成一组把该元素恢复为磁盘形态的 op（逐元素拒绝），
 * 或保留（逐元素接受）。不解析第二真值：恢复值直接取自磁盘文本。
 */
import type { SvgOp } from './svgEditorModel';

export interface AttrChange {
  name: string;
  before: string | null;
  after: string | null;
}

export interface ElementChange {
  key: string;
  label: string;
  tag: string;
  kind: 'attr' | 'text' | 'added' | 'removed';
  path: number[];
  attrs: AttrChange[];
  textBefore?: string;
  textAfter?: string;
}

interface Flat {
  key: string;
  path: number[];
  tag: string;
  id: string | null;
  attrs: Map<string, string>;
  text: string;
  childCount: number;
  parent: Element | null;
}

function parse(markup: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return null;
    return doc;
  } catch {
    return null;
  }
}

function flatten(root: Element): Flat[] {
  const out: Flat[] = [];
  const walk = (el: Element, path: number[]) => {
    const id = el.getAttribute('id');
    out.push({
      key: id ? `id:${id}` : `path:${path.join('.')}`,
      path,
      tag: el.tagName.toLowerCase(),
      id,
      attrs: new Map(Array.from(el.attributes).map((a) => [a.name, a.value])),
      text: el.children.length === 0 ? (el.textContent || '').trim() : '',
      childCount: el.children.length,
      parent: el.parentElement,
    });
    Array.from(el.children).forEach((child, index) => walk(child, [...path, index]));
  };
  walk(root, []);
  return out;
}

/** 逐元素差异：属性并集比较 + 纯文本元素比较 + 增删。 */
export function diffElements(beforeMarkup: string, afterMarkup: string): ElementChange[] {
  const beforeDoc = parse(beforeMarkup);
  const afterDoc = parse(afterMarkup);
  if (!beforeDoc || !afterDoc) return [];
  const before = new Map(flatten(beforeDoc.documentElement).map((f) => [f.key, f]));
  const after = flatten(afterDoc.documentElement);
  const seen = new Set<string>();
  const changes: ElementChange[] = [];

  for (const next of after) {
    seen.add(next.key);
    const prev = before.get(next.key);
    if (!prev) {
      changes.push({ key: next.key, label: labelOf(next), tag: next.tag, kind: 'added', path: next.path, attrs: [] });
      continue;
    }
    const names = new Set([...prev.attrs.keys(), ...next.attrs.keys()]);
    const attrs: AttrChange[] = [];
    for (const name of names) {
      const a = prev.attrs.get(name) ?? null;
      const b = next.attrs.get(name) ?? null;
      if (a !== b) attrs.push({ name, before: a, after: b });
    }
    if (attrs.length > 0) {
      changes.push({ key: next.key, label: labelOf(next), tag: next.tag, kind: 'attr', path: next.path, attrs });
      continue;
    }
    if (next.childCount === 0 && prev.text !== next.text) {
      changes.push({
        key: next.key,
        label: labelOf(next),
        tag: next.tag,
        kind: 'text',
        path: next.path,
        attrs: [],
        textBefore: prev.text,
        textAfter: next.text,
      });
    }
  }

  for (const [key, prev] of before) {
    if (seen.has(key)) continue;
    changes.push({ key, label: labelOf(prev), tag: prev.tag, kind: 'removed', path: prev.path, attrs: [] });
  }
  return changes;
}

function labelOf(item: { id: string | null; tag: string; path: number[] }): string {
  return item.id ? `#${item.id}` : `<${item.tag}> [${item.path.join(',')}]`;
}

/** 逐元素拒绝：把该元素恢复成磁盘形态（新增元素 → 删除；属性 → 恢复/删；文本 → 还原）。 */
export function revertElementOps(change: ElementChange): { ops: SvgOp[]; reason?: string } {
  const locator = change.key.startsWith('id:') ? { id: change.key.slice(3) } : { path: change.path };
  if (change.kind === 'added') {
    return { ops: [{ op: 'remove', target: locator }] };
  }
  if (change.kind === 'removed') {
    return { ops: [], reason: '该元素在磁盘版本存在、当前视图已删除；恢复需要原始片段，暂不支持一键撤销' };
  }
  if (change.kind === 'text') {
    return { ops: [{ op: 'set_text', target: locator, text: change.textBefore || '' }] };
  }
  const ops: SvgOp[] = [];
  for (const attr of change.attrs) {
    if (attr.before === null) {
      ops.push({ op: 'remove_attr', target: locator, name: attr.name });
    } else {
      ops.push({ op: 'set_attr', target: locator, name: attr.name, value: attr.before });
    }
  }
  return { ops };
}

/** 全部拒绝：把所有差异折算回磁盘形态（removed 类如实跳过并给出原因）。 */
export function revertAllOps(changes: ReadonlyArray<ElementChange>): { ops: SvgOp[]; skipped: number } {
  const ops: SvgOp[] = [];
  let skipped = 0;
  for (const change of changes) {
    const result = revertElementOps(change);
    if (result.ops.length === 0) {
      skipped += 1;
      continue;
    }
    ops.push(...result.ops);
  }
  return { ops, skipped };
}

/** 改动摘要（列表标题用）：按 kind 计数。 */
export function summarizeChanges(changes: ReadonlyArray<ElementChange>): string {
  const counts = { attr: 0, text: 0, added: 0, removed: 0 };
  for (const change of changes) counts[change.kind] += 1;
  const parts = [
    counts.attr ? `${counts.attr} 个属性改动` : '',
    counts.text ? `${counts.text} 处文字改动` : '',
    counts.added ? `${counts.added} 个新增` : '',
    counts.removed ? `${counts.removed} 个删除` : '',
  ].filter(Boolean);
  return parts.length === 0 ? '无改动' : parts.join(' · ');
}
