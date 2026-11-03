'use strict';

/**
 * helpers/svg-ops.js — BLOCK-342 W1：SVG 编辑引擎核心（纯算法，零新依赖，仅 node:crypto）。
 *
 * 设计：SVG 文件是单真值。引擎对 SVG 原始文本做「定位 → 只改目标字节区间」的 span 改写，
 * 不做解析 → 重序列化整份文档。两条硬不变量：
 *   1) 零操作零 diff：applyOps(text, []) 返回与输入字节完全相同的 text；
 *   2) 局部性：任一操作只改目标元素对应字节区间，区间外逐字节相同。
 * 不认识的东西一律原样保留：XML 声明 / DOCTYPE / 注释 / CDATA / PI / 实体引用（不解码
 * 不重编码）/ 命名空间前缀 / 属性顺序 / 引号风格 / 空白 / 自闭合写法 / 前导 BOM。
 * 所有偏移均为 JS 字符串下标（UTF-16 码元），text.slice(start, end) 即字节区间语义。
 * attr.value 保存原始源码文本（实体原样，如 `&amp;` 保持 `&amp;`）。
 */

const { createHash } = require('node:crypto');

/** 白名单操作（冻结）。 */
const OPS = Object.freeze(['set_attr', 'remove_attr', 'set_style', 'set_text', 'insert', 'remove', 'move']);

/** insert markup 禁用标签（大小写不敏感比对）。 */
const FORBIDDEN_TAGS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed']);
/** raw-text 元素：内部内容不按标签语法解析（CSS/JS 里的 `<` 不得打断解析）。 */
const RAW_TEXT_TAGS = new Set(['script', 'style']);
/** 危险 href 前缀（值去空白 + 小写后比对）。 */
const DANGEROUS_HREF_RE = /^(?:javascript|vbscript):|^data:text\/html/;

// ———— 词法正则（sticky：从指定下标起匹配，避免切片拷贝） ————
const TAG_NAME_RE = /<([A-Za-z_:][A-Za-z0-9_:.-]*)/y;
const ATTR_NAME_RE = /[^\s=/>]+/y;
const UNQUOTED_VALUE_RE = /[^\s>]*/y;
const WS_RE = /\s/;

function isWs(ch) {
  return WS_RE.test(ch);
}

/** 统一错误构造：code + 上下文字段。 */
function svgErr(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  if (extra) Object.assign(err, extra);
  return err;
}

/** sha256 hex（字符串按 UTF-8 编码）。 */
function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

// ———— 解析 ————

/**
 * 解析 SVG 原始文本为 span 索引。
 * @returns {{root: object, byId: Map<string, object>, elements: object[]}}
 *   node = { tag, attrs, start, end, openTagEnd, closeTagStart, selfClosing,
 *            children, parent, textOnly, index, text? }；只有元素进入 children，
 *   文本/注释/CDATA/PI 被跳过但区间被正确跨过；textOnly 元素附带 ≤80 字符内部原文节选 text。
 */
function parseSvg(text) {
  const src = String(text);
  const n = src.length;
  const elements = [];
  const byId = new Map();
  const stack = [];
  let root = null;
  let i = 0;

  const fail = (msg, at = i) => {
    throw svgErr('svg_parse_error', `svg 解析失败：${msg}（位置 ${at}）`, { position: at });
  };

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    i = lt;

    if (src.startsWith('<!--', i)) {
      // 注释：内部 < > 不参与标签语法
      const end = src.indexOf('-->', i + 4);
      if (end < 0) fail('注释未闭合');
      i = end + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      if (end < 0) fail('CDATA 段未闭合');
      i = end + 3;
    } else if (src.startsWith('<!', i)) {
      // DOCTYPE / 其他声明：容忍内部子集 [ ... ] 与引号内的 '>'
      let j = i + 2;
      let depth = 0;
      for (; j < n; j += 1) {
        const ch = src[j];
        if (ch === '"' || ch === "'") {
          const q = src.indexOf(ch, j + 1);
          if (q < 0) fail('声明内引号未闭合', j);
          j = q;
        } else if (ch === '[') depth += 1;
        else if (ch === ']') depth = Math.max(0, depth - 1);
        else if (ch === '>' && depth === 0) break;
      }
      if (j >= n) fail('DOCTYPE/声明未闭合', i);
      i = j + 1;
    } else if (src.startsWith('<?', i)) {
      // 处理指令（XML 声明 / xml-stylesheet 等）
      const end = src.indexOf('?>', i + 2);
      if (end < 0) fail('处理指令未闭合');
      i = end + 2;
    } else if (src.startsWith('</', i)) {
      const gt = src.indexOf('>', i + 2);
      if (gt < 0) fail('闭合标签缺少 >');
      const tag = src.slice(i + 2, gt).trim();
      const top = stack[stack.length - 1];
      if (!top) fail(`闭合标签 </${tag}> 没有对应开标签`);
      if (top.tag !== tag) fail(`闭合标签 </${tag}> 与开标签 <${top.tag}> 不匹配`, i);
      top.closeTagStart = i;
      top.end = gt + 1;
      if (top.children.length === 0) top.text = src.slice(top.openTagEnd, i).trim().slice(0, 80);
      stack.pop();
      i = gt + 1;
    } else {
      // 开标签
      TAG_NAME_RE.lastIndex = i;
      const m = TAG_NAME_RE.exec(src);
      if (!m) fail('< 后不是合法标签名（应为字母/下划线/冒号）');
      const parent = stack.length ? stack[stack.length - 1] : null;
      const childIndex = parent ? parent.children.length : 0;
      const node = {
        tag: m[1],
        attrs: [],
        start: i,
        end: -1,
        openTagEnd: -1,
        closeTagStart: -1,
        selfClosing: false,
        children: [],
        parent,
        textOnly: true,
        index: childIndex,
        path: parent ? parent.path.concat(childIndex) : [],
      };
      if (parent) {
        parent.children.push(node);
        parent.textOnly = false; // 有子元素 ⇒ 不再是纯文本容器（set_text 必须拒绝，不得静默吞结构）
      } else if (!root) root = node;
      elements.push(node);

      let j = i + m[0].length;
      for (;;) {
        while (j < n && isWs(src[j])) j += 1;
        if (j >= n) fail(`标签 <${node.tag}> 未闭合`, node.start);
        if (src[j] === '>') {
          node.openTagEnd = j + 1;
          break;
        }
        if (src[j] === '/') {
          // 自闭合（容忍 `<br / >` 写法）
          let k = j + 1;
          while (k < n && isWs(src[k])) k += 1;
          if (src[k] !== '>') fail(`标签 <${node.tag}> 自闭合斜杠后缺少 >`, j);
          node.selfClosing = true;
          node.openTagEnd = k + 1;
          break;
        }
        ATTR_NAME_RE.lastIndex = j;
        const am = ATTR_NAME_RE.exec(src);
        if (!am || !/^[A-Za-z_:]/.test(am[0])) fail(`标签 <${node.tag}> 属性名非法`, j);
        const name = am[0];
        const nameEnd = j + name.length;
        let k = nameEnd;
        while (k < n && isWs(src[k])) k += 1;
        let attr;
        if (src[k] === '=') {
          k += 1;
          while (k < n && isWs(src[k])) k += 1;
          if (k >= n) fail(`属性 ${name} 值未闭合`, j);
          const q = src[k];
          if (q === '"' || q === "'") {
            const qEnd = src.indexOf(q, k + 1);
            if (qEnd < 0) fail(`属性 ${name} 值引号未闭合`, k);
            attr = { name, value: src.slice(k + 1, qEnd), start: j, end: qEnd + 1, valueStart: k + 1, valueEnd: qEnd, quote: q };
            k = qEnd + 1;
          } else {
            // 无引号值（容错）；`<path d=M0/>` 尾部 `/` 归还为自闭合标记
            UNQUOTED_VALUE_RE.lastIndex = k;
            let v = UNQUOTED_VALUE_RE.exec(src)[0];
            if (v.endsWith('/') && src[k + v.length] === '>') {
              v = v.slice(0, -1);
              node.selfClosing = true;
              node.openTagEnd = k + v.length + 2;
            }
            attr = { name, value: v, start: j, end: k + v.length, valueStart: k, valueEnd: k + v.length, quote: '' };
            k += v.length + (node.selfClosing ? 1 : 0);
          }
        } else {
          // 布尔属性（容错，无值）
          attr = { name, value: '', start: j, end: nameEnd, valueStart: nameEnd, valueEnd: nameEnd, quote: '' };
        }
        node.attrs.push(attr);
        if (node.selfClosing) break;
        j = k;
      }

      const idAttr = node.attrs.find(a => a.name === 'id');
      if (idAttr && idAttr.value) {
        node.id = idAttr.value; // 便捷字段（describeElement/工具层/前端共用）
        if (!byId.has(idAttr.value)) byId.set(idAttr.value, node);
      }
      if (node.selfClosing) {
        node.closeTagStart = node.openTagEnd;
        node.end = node.openTagEnd;
      } else if (RAW_TEXT_TAGS.has(node.tag.toLowerCase())) {
        // raw text：内部原样跨过（不解析 `<`），按最近闭合标签收尾
        const closeAt = src.toLowerCase().indexOf(`</${node.tag.toLowerCase()}`, node.openTagEnd);
        if (closeAt < 0) fail(`标签 <${node.tag}> 未闭合`, node.start);
        const gt = src.indexOf('>', closeAt);
        if (gt < 0) fail(`闭合标签 </${node.tag}> 缺少 >`, closeAt);
        node.text = src.slice(node.openTagEnd, closeAt).trim().slice(0, 80);
        node.closeTagStart = closeAt;
        node.end = gt + 1;
        i = gt + 1;
        continue;
      } else {
        stack.push(node);
      }
      i = node.openTagEnd;
    }
  }

  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    fail(`标签 <${top.tag}> 未闭合`, top.start);
  }
  if (!root) fail('未找到顶层元素', 0);

  return { root, byId, elements };
}

/** node 在父元素子节点中的序号路径（root 为 []）。 */
function pathOf(node) {
  const out = [];
  let cur = node;
  while (cur && cur.parent) {
    out.unshift(cur.index);
    cur = cur.parent;
  }
  return out;
}

function resolveByPath(tree, path) {
  let node = tree.root;
  for (const step of path) {
    node = node && node.children[step];
    if (!node) return null;
  }
  return node;
}

// ———— 目标解析 ————

/**
 * 解析 target：{ id } / { path: number[] }，可附 { tag } 校验。
 * 错误码：svg_target_invalid / svg_target_not_found / svg_target_tag_mismatch。
 */
function resolveTarget(tree, target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw svgErr('svg_target_invalid', 'target 必须是 { id } 或 { path } 形态对象');
  }
  const hasId = Object.prototype.hasOwnProperty.call(target, 'id');
  const hasPath = Object.prototype.hasOwnProperty.call(target, 'path');
  if (hasId === hasPath) {
    throw svgErr('svg_target_invalid', 'target 必须且只能包含 id 或 path 之一');
  }
  let node;
  if (hasId) {
    if (typeof target.id !== 'string' || target.id === '') {
      throw svgErr('svg_target_invalid', 'target.id 必须是非空字符串');
    }
    node = tree.byId.get(target.id);
    if (!node) throw svgErr('svg_target_not_found', `未找到 id="${target.id}" 的元素`, { id: target.id });
  } else {
    const p = target.path;
    // 空 path [] = root 本身，合法
    if (!Array.isArray(p) || p.some(x => !Number.isInteger(x) || x < 0)) {
      throw svgErr('svg_target_invalid', 'target.path 必须是非负整数数组');
    }
    node = tree.root;
    for (let d = 0; d < p.length; d += 1) {
      const next = node.children[p[d]];
      if (!next) throw svgErr('svg_target_not_found', `路径越界：[${p.join(',')}] 第 ${d} 步`, { path: p });
      node = next;
    }
  }
  if (target.tag !== undefined) {
    if (typeof target.tag !== 'string') throw svgErr('svg_target_invalid', 'target.tag 必须是字符串');
    if (node.tag !== target.tag) {
      throw svgErr('svg_target_tag_mismatch', `目标标签为 <${node.tag}>，期望 <${target.tag}>`, { actual: node.tag, expected: target.tag });
    }
  }
  return node;
}

// ———— 安全校验 ————

/**
 * 属性安全校验（set_attr / insert markup 共用）：
 * on* 属性、危险 href（javascript:/vbscript:/data:text/html）、危险 style 表达式。
 */
function checkAttrSafety(name, value) {
  const n = String(name);
  if (/^on/i.test(n)) {
    throw svgErr('svg_unsafe_markup', `拒绝 on* 事件属性：${n}`, { reason: `on* 事件属性被拒绝：${n}` });
  }
  const lower = n.toLowerCase();
  if (lower === 'href' || lower === 'xlink:href') {
    const v = String(value).replace(/\s+/g, '').toLowerCase();
    if (DANGEROUS_HREF_RE.test(v)) {
      throw svgErr('svg_unsafe_markup', `拒绝危险 href：${n}=${String(value).slice(0, 60)}`, { reason: `href 值以 javascript:/vbscript:/data:text/html 开头：${n}` });
    }
  }
  if (lower === 'style') {
    const v = String(value).toLowerCase();
    if (v.includes('expression(') || v.includes('url(javascript:')) {
      throw svgErr('svg_unsafe_markup', 'style 值含危险表达式', { reason: 'style 值含 expression( 或 url(javascript:' });
    }
  }
}

/** insert markup 安全校验：禁用标签 + 全部属性走 checkAttrSafety。 */
function checkMarkupSafety(tree) {
  for (const el of tree.elements) {
    if (FORBIDDEN_TAGS.has(el.tag.toLowerCase())) {
      throw svgErr('svg_unsafe_markup', `拒绝危险标签 <${el.tag}>`, { reason: `markup 含被禁标签 <${el.tag}>` });
    }
    for (const a of el.attrs) checkAttrSafety(a.name, a.value);
  }
}

// ———— 转义与属性改写原语 ————

function escapeXmlText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttrCore(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/** 逻辑值 → 引号内安全值；优先保留偏好引号，冲突时换另一种引号，再冲突用实体转义。 */
function fitQuote(logicalValue, preferredQuote) {
  let s = escapeAttrCore(logicalValue);
  let quote = preferredQuote === "'" ? "'" : '"';
  if (s.includes(quote)) {
    const other = quote === '"' ? "'" : '"';
    if (!s.includes(other)) quote = other;
    else s = s.split(quote).join(quote === '"' ? '&quot;' : '&apos;');
  }
  return { value: s, quote };
}

/** 属性名前导空白起点（连同前导空白删除时用；不越过标签名）。 */
function attrWsStart(src, node, attr) {
  const tagEnd = node.start + 1 + node.tag.length;
  let s = attr.start;
  while (s - 1 > tagEnd && isWs(src[s - 1])) s -= 1;
  return s;
}

/** 在开标签收尾（`>` 或 `/`）前插入 ` name="value"`。 */
function insertAttrRaw(src, node, name, value, quote) {
  let ip = node.openTagEnd - 2; // '>' 前一个字符
  while (ip > node.start && isWs(src[ip])) ip -= 1;
  if (src[ip] === '/') ip -= 1;
  const at = ip + 1;
  return src.slice(0, at) + ` ${name}=${quote}${value}${quote}` + src.slice(at);
}

/** 设置/替换属性：已存在只替换 value 区间（保留原引号风格），不存在则插入。 */
function setAttrRaw(src, node, name, logicalValue, preferredQuote) {
  const attr = node.attrs.find(a => a.name === name);
  const { value, quote } = fitQuote(logicalValue, attr ? attr.quote : (preferredQuote || '"'));
  if (attr) {
    // 引号形态：valueStart 指开引号后一位、valueEnd 指闭引号本身；替换区间须含两侧引号各一字节
    if (attr.quote) return src.slice(0, attr.valueStart - 1) + quote + value + quote + src.slice(attr.valueEnd + 1);
    return src.slice(0, attr.valueStart) + quote + value + quote + src.slice(attr.valueEnd); // 无引号形态补引号
  }
  return insertAttrRaw(src, node, name, value, quote);
}

// ———— style 合并 ————

/** 把 style 属性当 k:v;k:v 映射合并；null 删键、保持原键序、新键追加末尾。 */
function setStyleRaw(src, node, props) {
  const wanted = new Map(); // lower(key) -> { key, value|null }
  for (const [k, v] of Object.entries(props)) {
    if (typeof k !== 'string' || k === '' || /[\s:;]/.test(k)) {
      throw svgErr('svg_op_invalid', `style 属性名非法：${JSON.stringify(k)}`, { key: k });
    }
    if (v === undefined || (v !== null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')) {
      throw svgErr('svg_op_invalid', `style 属性值非法：${k}`, { key: k });
    }
    const lk = k.toLowerCase();
    if (!wanted.has(lk)) wanted.set(lk, { key: k, value: v === null ? null : String(v) });
  }
  const attr = node.attrs.find(a => a.name.toLowerCase() === 'style');
  if (!attr) {
    // 原本没有 style：取非空设键新建；全是删键则 no-op
    const parts = [];
    for (const w of wanted.values()) if (w.value !== null) parts.push(`${w.key}:${w.value}`);
    if (parts.length === 0) return src;
    const joined = parts.join(';');
    checkAttrSafety('style', joined);
    const { value, quote } = fitQuote(joined, '"');
    return insertAttrRaw(src, node, 'style', value, quote);
  }
  const segs = attr.value.split(';').map(seg => {
    const ci = seg.indexOf(':');
    return ci < 0 ? { raw: seg } : { raw: seg, key: seg.slice(0, ci).trim(), val: seg.slice(ci + 1).trim() };
  });
  const seen = new Set();
  const out = [];
  for (const seg of segs) {
    const lk = seg.key !== undefined ? seg.key.toLowerCase() : null;
    const w = lk !== null ? wanted.get(lk) : undefined;
    if (w) {
      seen.add(lk);
      if (w.value === null) continue; // 删键 → 丢弃该段
      if (seg.val === w.value) { out.push(seg.raw); continue; } // 值未变 → 原字节保留
      out.push(`${seg.key}:${w.value}`); // 改值 → 只重写该段
      continue;
    }
    out.push(seg.raw); // 无关段原样保留
  }
  for (const [lk, w] of wanted) {
    if (!seen.has(lk) && w.value !== null) out.push(`${w.key}:${w.value}`);
  }
  const joined = out.join(';');
  checkAttrSafety('style', joined);
  if (joined.trim() === '') {
    // 合并后为空 → 删除 style 属性
    const s = attrWsStart(src, node, attr);
    return src.slice(0, s) + src.slice(attr.end);
  }
  return setAttrRaw(src, node, attr.name, joined, attr.quote);
}

// ———— 文本 / 插入 / 移动 ————

/** set_text：整体替换 textOnly 元素内部内容；自闭合改写为开闭标签对。 */
function setTextRaw(src, node, logicalText) {
  const esc = escapeXmlText(logicalText);
  if (node.selfClosing) {
    return src.slice(node.start, node.openTagEnd - 2) + '>' + esc + `</${node.tag}>`;
  }
  return src.slice(0, node.openTagEnd) + esc + src.slice(node.closeTagStart);
}

/** insert：校验 markup 恰好一个元素 + 安全校验，再插入父元素第 index 个子元素之前。 */
function insertRaw(src, parent, op) {
  const children = parent.children;
  let idx;
  if (op.index === 'end') idx = children.length;
  else if (Number.isInteger(op.index) && op.index >= 0 && op.index <= children.length) idx = op.index;
  else throw svgErr('svg_op_invalid', `insert index 非法：${JSON.stringify(op.index === undefined ? null : op.index)}（父元素子元素数 ${children.length}）`, { index: op.index });
  if (typeof op.markup !== 'string' || op.markup === '') throw svgErr('svg_op_invalid', 'insert markup 必须是非空字符串');
  const frag = parseSvg(op.markup);
  // 安全先于形状：危险 markup 一律 svg_unsafe_markup（不因元素数不符被报成形状错）
  checkMarkupSafety(frag);
  if (frag.elements.length !== 1) {
    throw svgErr('svg_op_invalid', `markup 必须恰好包含一个元素（收到 ${frag.elements.length} 个）`, { reason: 'markup_element_count' });
  }
  const el = frag.elements[0];
  if (op.markup.slice(0, el.start).trim() !== '' || op.markup.slice(el.end).trim() !== '') {
    throw svgErr('svg_op_invalid', 'markup 元素之外只允许空白', { reason: 'markup_stray_content' });
  }
  if (parent.selfClosing) {
    // 父元素自闭合 → 改写为开闭标签对
    if (idx !== 0) throw svgErr('svg_op_invalid', '自闭合父元素没有子元素，index 只能为 0 或 end');
    return src.slice(parent.start, parent.openTagEnd - 2) + '>' + op.markup + `</${parent.tag}>`;
  }
  const pos = idx < children.length ? children[idx].start : parent.closeTagStart;
  return src.slice(0, pos) + op.markup + src.slice(pos);
}

/**
 * move：单次拼接完成「剪切 + 插入」。目标插入点不可能落在被剪切区间 [s,e) 内
 * （移入自身/后代已被拒绝，父元素区间与节点区间要么嵌套要么不相交），故坐标换算安全。
 */
function moveRaw(src, tree, op) {
  const node = resolveTarget(tree, op.target);
  if (!node.parent) throw svgErr('svg_move_root', '禁止移动根元素', { tag: node.tag });
  const parent = resolveTarget(tree, op.parent);
  for (let cur = parent; cur; cur = cur.parent) {
    if (cur === node) throw svgErr('svg_move_into_self', '禁止把元素移动到自身或自身后代内', { tag: node.tag });
  }
  const children = parent.children;
  let ti;
  if (op.index === 'end') ti = children.length;
  else if (Number.isInteger(op.index) && op.index >= 0 && op.index <= children.length) ti = op.index;
  else throw svgErr('svg_op_invalid', `move index 非法：${JSON.stringify(op.index === undefined ? null : op.index)}`, { index: op.index });

  const s = node.start;
  const e = node.end;
  const cut = src.slice(s, e);
  const len = e - s;
  const sameParent = parent === node.parent;
  const ip = ti < children.length ? children[ti].start : parent.closeTagStart;
  let next;
  if (e <= ip) next = src.slice(0, s) + src.slice(e, ip - len) + cut + src.slice(ip - len);
  else next = src.slice(0, ip) + cut + src.slice(ip, s) + src.slice(e);
  // 移动后的新序号（供 after 片段定位）
  let newIdx;
  if (sameParent) newIdx = ti === children.length ? children.length - 1 : (node.index < ti ? ti - 1 : ti);
  else newIdx = ti === children.length ? children.length : ti;
  const newPath = pathOf(parent).concat(newIdx);
  const id = node.attrs.find(a => a.name === 'id');
  const info = { tag: node.tag, path: newPath };
  if (id && id.value) info.id = id.value;
  let after = cut;
  try {
    const t2 = parseSvg(next);
    const n2 = resolveByPath(t2, newPath);
    if (n2) after = next.slice(n2.start, n2.end);
  } catch { /* 改写后解析失败不该发生；after 退回 cut */ }
  return { text: next, info, before: cut.length > 400 ? cut.slice(0, 400) : cut, after: after.length > 400 ? after.slice(0, 400) : after };
}

// ———— op 应用主链 ————

function targetInfo(node) {
  const info = { tag: node.tag, path: pathOf(node) };
  const id = node.attrs.find(a => a.name === 'id');
  if (id && id.value) info.id = id.value;
  return info;
}

/** 公共收尾：重解析新文本，取目标节点改后外层片段（目标被删则空串）。 */
function finishOp(src, node, next) {
  const before = src.slice(node.start, node.end);
  const info = targetInfo(node);
  let after = '';
  try {
    const t2 = parseSvg(next);
    const n2 = resolveByPath(t2, info.path);
    if (n2) after = next.slice(n2.start, n2.end);
  } catch { /* 改写后解析失败不该发生；after 保持空串 */ }
  return { text: next, info, before: before.length > 400 ? before.slice(0, 400) : before, after: after.length > 400 ? after.slice(0, 400) : after };
}

const ATTR_NAME_LEGAL_RE = /^[A-Za-z_:][^\s"'<>=/]*$/;

/** 单步 op 应用：每步对当前文本重新解析（正确性优先，不做偏移修补）。 */
function applyOne(src, op) {
  if (!op || typeof op !== 'object' || Array.isArray(op) || typeof op.op !== 'string' || !OPS.includes(op.op)) {
    throw svgErr('svg_op_not_allowed', `op 不在白名单内：${op && typeof op === 'object' ? JSON.stringify(op.op === undefined ? null : op.op) : String(op)}`, { op: op && op.op });
  }
  const tree = parseSvg(src);
  switch (op.op) {
    case 'set_attr': {
      if (typeof op.name !== 'string' || !ATTR_NAME_LEGAL_RE.test(op.name)) throw svgErr('svg_op_invalid', `set_attr 属性名非法：${JSON.stringify(op.name === undefined ? null : op.name)}`);
      if (typeof op.value !== 'string' && typeof op.value !== 'number' && typeof op.value !== 'boolean') {
        throw svgErr('svg_op_invalid', 'set_attr value 必须是字符串（数字/布尔自动转字符串）');
      }
      checkAttrSafety(op.name, op.value);
      const node = resolveTarget(tree, op.target);
      return finishOp(src, node, setAttrRaw(src, node, op.name, String(op.value)));
    }
    case 'remove_attr': {
      if (typeof op.name !== 'string' || op.name === '') throw svgErr('svg_op_invalid', 'remove_attr 需要非空 name');
      const node = resolveTarget(tree, op.target);
      const attr = node.attrs.find(a => a.name === op.name);
      // 不存在则 no-op（applied 仍记录）
      const next = attr ? src.slice(0, attrWsStart(src, node, attr)) + src.slice(attr.end) : src;
      return finishOp(src, node, next);
    }
    case 'set_style': {
      if (!op.props || typeof op.props !== 'object' || Array.isArray(op.props)) throw svgErr('svg_op_invalid', 'set_style props 必须是对象');
      const node = resolveTarget(tree, op.target);
      return finishOp(src, node, setStyleRaw(src, node, op.props));
    }
    case 'set_text': {
      if (typeof op.text !== 'string' && typeof op.text !== 'number') throw svgErr('svg_op_invalid', 'set_text text 必须是字符串');
      const node = resolveTarget(tree, op.target);
      if (!node.textOnly) {
        throw svgErr('svg_set_text_on_container', `<${node.tag}> 含子元素，禁止 set_text（不允许静默吞掉子结构）`, { tag: node.tag });
      }
      return finishOp(src, node, setTextRaw(src, node, String(op.text)));
    }
    case 'insert': {
      const parent = resolveTarget(tree, op.parent);
      return finishOp(src, parent, insertRaw(src, parent, op));
    }
    case 'remove': {
      const node = resolveTarget(tree, op.target);
      if (!node.parent) throw svgErr('svg_remove_root', '禁止删除根元素', { tag: node.tag });
      const before = src.slice(node.start, node.end);
      return { text: src.slice(0, node.start) + src.slice(node.end), info: targetInfo(node), before: before.length > 400 ? before.slice(0, 400) : before, after: '' };
    }
    case 'move':
      return moveRaw(src, tree, op);
    default: // 不可达（OPS 白名单已校验）
      throw svgErr('svg_op_not_allowed', `op 不在白名单内：${op.op}`);
  }
}

/**
 * 顺序应用 ops；每步应用后重新解析；任一步失败整体抛错、不返回部分结果。
 * @param {string} text SVG 原始文本（单真值）
 * @param {Array<object>} ops 白名单操作序列
 * @param {{expectedSha?: string}} [options] 文本指纹预检
 * @returns {{text: string, beforeSha: string, afterSha: string, applied: Array<{op, target, before, after}>}}
 */
function applyOps(text, ops, { expectedSha } = {}) {
  const src0 = String(text);
  const beforeSha = sha256(src0);
  if (expectedSha !== undefined && expectedSha !== null && expectedSha !== beforeSha) {
    throw svgErr('svg_hash_mismatch', 'expectedSha 与文本实际 sha256 不符', { expected: expectedSha, actual: beforeSha });
  }
  if (!Array.isArray(ops)) throw svgErr('svg_op_invalid', 'ops 必须是数组');
  let cur = src0;
  const applied = [];
  for (const op of ops) {
    const r = applyOne(cur, op);
    cur = r.text;
    applied.push({ op, target: r.info, before: r.before, after: r.after });
  }
  return { text: cur, beforeSha, afterSha: sha256(cur), changed: beforeSha !== sha256(cur), applied };
}

/**
 * 工具层友好包装：核心抛错 → { ok:false, code, message }，成功统一 { ok:true, changed }。
 * 核心保持抛错（纯算法 + 精确 code），工具层与前端一律消费本包装，避免各自 try/catch 样板漂移。
 */
function applyOpsSafe(text, ops, options) {
  try {
    const r = applyOps(text, ops, options);
    return { ok: true, ...r };
  } catch (e) {
    const out = { ok: false, code: (e && e.code) || 'svg_error', message: (e && e.message) || 'SVG 操作失败' };
    if (e && e.position !== undefined) out.position = e.position;
    if (e && e.expected !== undefined) out.expected = e.expected;
    if (e && e.actual !== undefined) out.actual = e.actual;
    return out;
  }
}

// ———— 载入脱敏 ————

/** 危险元素成对/自闭合形态（原始文本层剥离：内容含 `<` 也不打断）。 */
const DANGEROUS_PAIR_RE = /<(script|foreignObject|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const DANGEROUS_SELF_RE = /<(script|foreignObject|iframe|object|embed)\b[^>]*\/\s*>/gi;

/**
 * 编辑器载入前脱敏：移除 script/foreignObject 等危险元素、on* 属性、危险 href；
 * 其余字节原样保留（局部性同样成立）。无需脱敏时返回字节相同的 text 与空 removed。
 *
 * 两级：①原始文本层剥离危险元素（容忍内部任意内容，含 `<`）；②解析后剥属性。
 * 解析仍失败（畸形文档）时 fail-closed 返回 ok:false，绝不把未脱敏文本当已脱敏。
 * @returns {{ok: boolean, text: string, removed: Array<{kind: 'element'|'attribute', detail: string}>, code?: string}}
 */
function sanitizeSvg(text) {
  const src = String(text);
  const removed = [];
  const ranges = [];

  // ① 危险元素：原始文本层剥离（先成对，再自闭合；已被成对区间覆盖的不重复删）
  const pairRe = new RegExp(DANGEROUS_PAIR_RE.source, 'gi');
  let m;
  while ((m = pairRe.exec(src))) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
    removed.push({ kind: 'element', detail: `<${m[1]}>` });
  }
  const selfRe = new RegExp(DANGEROUS_SELF_RE.source, 'gi');
  while ((m = selfRe.exec(src))) {
    const start = m.index;
    const end = start + m[0].length;
    if (ranges.some(r => start >= r.start && end <= r.end)) continue;
    ranges.push({ start, end });
    removed.push({ kind: 'element', detail: `<${m[1]} />` });
  }
  let out = src;
  for (const r of ranges.slice().sort((a, b) => b.start - a.start)) {
    out = out.slice(0, r.start) + out.slice(r.end);
  }

  // ② 属性：解析剥离后的文本（危险元素已不在）
  let tree;
  try {
    tree = parseSvg(out);
  } catch (e) {
    return { ok: false, code: (e && e.code) || 'svg_parse_error', message: (e && e.message) || 'SVG 解析失败', text: out, removed };
  }
  const attrRanges = [];
  for (const el of tree.elements) {
    const id = el.attrs.find(a => a.name === 'id');
    const idPart = id && id.value ? `#${id.value}` : '';
    for (const a of el.attrs) {
      const lower = a.name.toLowerCase();
      const badOn = /^on/.test(lower);
      const badHref = (lower === 'href' || lower === 'xlink:href') && DANGEROUS_HREF_RE.test(a.value.replace(/\s+/g, '').toLowerCase());
      const badStyle = lower === 'style' && /expression\(|url\(\s*javascript:/i.test(a.value);
      if (!badOn && !badHref && !badStyle) continue;
      attrRanges.push({ start: attrWsStart(out, el, a), end: a.end });
      removed.push({ kind: 'attribute', detail: `${a.name} on <${el.tag}${idPart}>` });
    }
  }
  for (const r of attrRanges.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, r.start) + out.slice(r.end);
  }
  return { ok: true, text: out, removed };
}

/** 危险面探测（只报告不修改）：供 svg_inspect 提示 agent 载入前需脱敏。 */
function detectUnsafe(tree) {
  const unsafe = { script: false, foreignObject: false, eventAttrs: 0, dangerousHref: 0, dangerousStyle: 0 };
  for (const el of tree.elements) {
    const lower = el.tag.toLowerCase();
    if (lower === 'script') unsafe.script = true;
    if (lower === 'foreignobject') unsafe.foreignObject = true;
    for (const a of el.attrs) {
      const n = a.name.toLowerCase();
      if (/^on/.test(n)) unsafe.eventAttrs += 1;
      if ((n === 'href' || n === 'xlink:href') && DANGEROUS_HREF_RE.test(a.value.replace(/\s+/g, '').toLowerCase())) unsafe.dangerousHref += 1;
      if (n === 'style' && /expression\(|url\(\s*javascript:/i.test(a.value)) unsafe.dangerousStyle += 1;
    }
  }
  unsafe.any = unsafe.script || unsafe.foreignObject || unsafe.eventAttrs > 0 || unsafe.dangerousHref > 0 || unsafe.dangerousStyle > 0;
  return unsafe;
}

// ———— 查询 ————

/** 元素摘要（path 为从 root 出发的序号数组；text 为 textOnly 元素 ≤80 字符原文节选）。 */
function describeElement(node) {
  const out = { path: pathOf(node), tag: node.tag };
  const id = node.attrs.find(a => a.name === 'id');
  if (id && id.value) out.id = id.value;
  const cls = node.attrs.find(a => a.name === 'class');
  if (cls && cls.value && cls.value.trim()) out.classes = cls.value.trim().split(/\s+/);
  if (node.text) out.text = node.text;
  return out;
}

/** 元素清单（文档序；tag 过滤 / limit 截断 / text 节选开关；附 attrCount）。 */
function listElements(tree, { tag, limit = 200, withText = true } = {}) {
  const out = [];
  for (const el of tree.elements) {
    if (tag !== undefined && el.tag !== tag) continue;
    const d = describeElement(el);
    if (!withText) delete d.text;
    d.attrCount = el.attrs.length;
    out.push(d);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * svg_inspect 的数据源：元素清单 + 危险面标记 + 截断说明。
 * @param {string} text SVG 原始文本
 * @param {{tag?: string, limit?: number}} [options]
 * @returns {{ok: true, rootTag: string, total: number, returned: number, truncated: boolean,
 *            elements: object[], unsafe: object} | {ok: false, code: string, message: string}}
 */
function inspectSvg(text, { tag, limit = 200 } = {}) {
  try {
    const tree = parseSvg(String(text));
    const total = tag === undefined ? tree.elements.length : tree.elements.filter(el => el.tag === tag).length;
    const elements = listElements(tree, { tag, limit }).map((d) => {
      const item = { ...d };
      if (item.text !== undefined) { item.textPreview = item.text; delete item.text; }
      return item;
    });
    return {
      ok: true,
      rootTag: tree.root.tag,
      total,
      returned: elements.length,
      truncated: total > elements.length,
      elements,
      unsafe: detectUnsafe(tree),
    };
  } catch (e) {
    return { ok: false, code: (e && e.code) || 'svg_parse_error', message: (e && e.message) || 'SVG 解析失败' };
  }
}

module.exports = {
  parseSvg,
  resolveTarget,
  applyOps,
  applyOpsSafe,
  sanitizeSvg,
  inspectSvg,
  detectUnsafe,
  listElements,
  describeElement,
  sha256,
  OPS,
  FORBIDDEN_TAGS,
};
