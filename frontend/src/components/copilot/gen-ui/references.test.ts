/**
 * BLOCK-166 [A 层] 解析器单测（plan P0 门禁 ≥15 用例）：
 * 三种指令形态 / 代码围栏排除 / pending 隐藏 / invalid 占位 / 路径归一化去重 / schema 拒绝分支。
 */

import { describe, expect, it } from 'vitest';
import { projectGenUiReferences, dedupeGenUiParts } from './references';
import { isGenUiPath, parseGenUiReference } from './schema';

const WIN = 'C:/ws/.petri/gen-ui/conv1/chart-a.html';
const POSIX = '/ws/.petri/gen-ui/conv1/chart-b.html';

describe('schema isGenUiPath', () => {
  it('接受 Windows 盘符绝对路径', () => {
    expect(isGenUiPath(WIN)).toBe(true);
  });
  it('接受 POSIX 绝对路径', () => {
    expect(isGenUiPath(POSIX)).toBe(true);
  });
  it('拒绝相对路径', () => {
    expect(isGenUiPath('relative/x.html')).toBe(false);
  });
  it('拒绝含 .. 的穿越路径', () => {
    expect(isGenUiPath('/ws/../etc/passwd.html')).toBe(false);
  });
  it('拒绝 NUL / 换行', () => {
    expect(isGenUiPath('/ws/a\0b.html')).toBe(false);
    expect(isGenUiPath('/ws/a\nb.html')).toBe(false);
  });
  it('拒绝非小写连字符文件名（大写/下划线/中文）', () => {
    expect(isGenUiPath('/ws/Chart_A.html')).toBe(false);
    expect(isGenUiPath('/ws/图.html')).toBe(false);
  });
  it('拒绝超长路径（>4096）', () => {
    expect(isGenUiPath('/' + 'a'.repeat(5000) + '.html')).toBe(false);
  });
});

describe('schema parseGenUiReference', () => {
  it('接受 {path,title,mode} 并拒绝多余键', () => {
    expect(parseGenUiReference({ path: WIN, title: 't', mode: 'wide' })).toEqual({
      path: WIN, title: 't', mode: 'wide',
    });
    expect(parseGenUiReference({ path: WIN, extra: 1 })).toBeNull();
  });
  it('拒绝 title 超长与非字符串', () => {
    expect(parseGenUiReference({ path: WIN, title: 'x'.repeat(251) })).toBeNull();
    expect(parseGenUiReference({ path: WIN, title: 3 })).toBeNull();
  });
  it('拒绝 mode 非 wide', () => {
    expect(parseGenUiReference({ path: WIN, mode: 'normal' })).toBeNull();
  });
});

describe('projectGenUiReferences', () => {
  it('JSON 形态：正文切分为 text + ui + text', () => {
    const parts = projectGenUiReferences(`前文\n::visualize{"path":"${WIN}","title":"图"}\n后文`, true);
    expect(parts.map((p) => p.kind)).toEqual(['text', 'ui', 'text']);
    expect(parts[1]).toMatchObject({ kind: 'ui', reference: { path: WIN, title: '图' } });
  });
  it('key=value 旧式形态', () => {
    const parts = projectGenUiReferences(`::visualize{path="${WIN}" mode="wide"}`, true);
    expect(parts[0]).toMatchObject({ kind: 'ui', reference: { path: WIN, mode: 'wide' } });
  });
  it('未完成消息：指令位置输出 pending 且半截 JSON 之后正文隐藏', () => {
    const parts = projectGenUiReferences(`前\n::visualize{"path":"${WIN}`, false);
    expect(parts).toEqual([{ kind: 'text', text: '前\n' }, { kind: 'pending' }]);
  });
  it('未完成消息：文末指令名前缀（::vis）隐藏防闪烁', () => {
    const parts = projectGenUiReferences('正文若干::vis', false);
    expect(parts).toEqual([{ kind: 'text', text: '正文若干' }]);
  });
  it('代码围栏内的指令是普通文本（防注入）', () => {
    const fenced = '```\n::visualize{"path":"' + WIN + '"}\n```';
    const parts = projectGenUiReferences(fenced, true);
    expect(parts.every((p) => p.kind === 'text')).toBe(true);
  });
  it('行内 code 内的指令同样忽略', () => {
    const parts = projectGenUiReferences('`::visualize{"path":"' + WIN + '"}`', true);
    expect(parts.every((p) => p.kind === 'text')).toBe(true);
  });
  it('完成后 schema 失败输出 invalid 占位', () => {
    const parts = projectGenUiReferences('::visualize{"path":"not/relative.html"}', true);
    expect(parts).toEqual([{ kind: 'invalid' }]);
  });
  it('纯文本快路径原样返回', () => {
    expect(projectGenUiReferences('你好世界', true)).toEqual([{ kind: 'text', text: '你好世界' }]);
  });
  it('未闭合大括号且非参数前缀时保留原文', () => {
    const parts = projectGenUiReferences('::visualize{oops 普通正文', true);
    expect(parts.every((p) => p.kind === 'text')).toBe(true);
  });
});

describe('dedupeGenUiParts', () => {
  it('Windows 分隔符归一化后去重（坑 8）', () => {
    const parts = projectGenUiReferences(
      `::visualize{"path":"${WIN}"}\n::visualize{"path":"${WIN.replace(/\//g, '\\\\')}"}`,
      true,
    );
    const deduped = dedupeGenUiParts(parts);
    expect(deduped.filter((p) => p.kind === 'ui')).toHaveLength(1);
  });
  it('不同路径不去重', () => {
    const parts = projectGenUiReferences(
      `::visualize{"path":"${WIN}"}\n::visualize{"path":"${POSIX}"}`,
      true,
    );
    expect(dedupeGenUiParts(parts).filter((p) => p.kind === 'ui')).toHaveLength(2);
  });
});
