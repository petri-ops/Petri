import { describe, expect, it } from 'vitest';

/**
 * BLOCK-245 P3 — `@` 候选同源聚合（纯层）契约。
 *
 * 冻结四件事：
 *   ① 八类候选里由菜单提供的七类**同形**——都只产 `ComposerContextItem`（不产文本模板）；
 *   ② 每个源有逐项上限，且超限**报条数**（`truncated`）而不是静默截断；
 *   ③ 源不可用必须留可读原因（`unavailableReason`），零结果与不可用**可区分**；
 *   ④ 引用头一律全角【】——服务端 cleanContent 剥行首半角 `[...]`（P1 基线纪律）。
 */

import { composeContextMessage } from './contextItems';
import {
  CONTEXT_SOURCE_CAPS,
  CONTEXT_SOURCE_LABELS,
  CONTEXT_SOURCE_ORDER,
  buildAgentCandidates,
  buildConnectorCandidates,
  buildConversationCandidates,
  buildFileCandidates,
  buildKnowledgeCandidates,
  buildResultCandidates,
  buildSkillCandidates,
  countContextCandidates,
  filterContextSources,
  flattenContextCandidates,
  listUnavailableSources,
  matchContextCandidate,
  parseMentionTrigger,
  removeMentionToken,
  unavailableContextSource,
  type ContextSourceResult,
} from './contextSources';

describe('BLOCK-245 P3 `@` 候选源：形状与上限单源', () => {
  it('七类来源固定次序与标签（键盘导航与分组顺序不随装载完成先后漂移）', () => {
    // BLOCK-246 C16：新增第八类「应用快照」，固定排在最后
    expect(CONTEXT_SOURCE_ORDER).toEqual([
      'file', 'skill', 'connector', 'agent', 'artifact', 'knowledge', 'conversation', 'snapshot',
    ]);
    expect(CONTEXT_SOURCE_LABELS.file).toBe('文件');
    expect(CONTEXT_SOURCE_LABELS.conversation).toBe('会话');
  });

  it('每类都有正数逐项上限（无源可无界）', () => {
    for (const id of CONTEXT_SOURCE_ORDER) {
      expect(CONTEXT_SOURCE_CAPS[id]).toBeGreaterThan(0);
    }
  });

  it('候选一律落在 reference 组且引用头是全角【】（半角会被服务端 cleanContent 剥掉）', () => {
    const sources = [
      buildFileCandidates([{ name: 'a.R', type: 'file', size: 2048 }]),
      buildSkillCandidates([{ kind: 'skill', id: 'sk-1', label: '技能一', description: '说明' }]),
      buildConnectorCandidates([{ id: 'mcp-1', status: 'connected', toolCount: 3 }]),
      buildAgentCandidates([{ name: 'reviewer', role: 'code-review' }]),
      buildResultCandidates([{ id: 'job-1', tool_id: 'scanpy', status: 'done' }]),
      buildKnowledgeCandidates([{ id: 'ks-1', name: '空间一', documents: 2 }]),
      buildConversationCandidates([{ id: 'c-1', title: '上一个会话' }], 'c-current'),
    ];
    const candidates = flattenContextCandidates(sources);
    expect(candidates.length).toBe(7);
    for (const candidate of candidates) {
      expect(candidate.item.group).toBe('reference');
      expect(candidate.item.lines[0].startsWith('【引用')).toBe(true);
      for (const line of candidate.item.lines) {
        if (/^[[]/.test(line) && line.includes('引用')) {
          throw new Error(`引用头漂回半角方括号：${line}`);
        }
      }
      // 上行形状仍是正文内引用块，模型可读（不是第二份结构化真相）。
      const composed = composeContextMessage('问题', [candidate.item]);
      expect(composed.endsWith('问题')).toBe(true);
      expect(composed.startsWith('【')).toBe(true);
    }
  });
});

describe('BLOCK-245 P3 文件 / 文件夹源', () => {
  it('隐藏项不进候选（.chat-attachments 是内部落点，不是用户的上下文）', () => {
    const result = buildFileCandidates([
      { name: 'src', type: 'dir' },
      { name: '.chat-attachments', type: 'dir' },
      { name: 'a.R', type: 'file', size: 2048 },
    ]);
    expect(result.candidates.map((c) => c.label)).toEqual(['src', 'a.R']);
    expect(result.unavailableReason).toBeNull();
  });

  it('目录与文件给不同的引用头；文件带大小', () => {
    const [dir, file] = buildFileCandidates([
      { name: 'src', type: 'dir', path: 'src' },
      { name: 'a.R', type: 'file', size: 2048, path: 'a.R' },
    ]).candidates;
    // BLOCK-246 C16：目录从「条目引用」升级为「文件夹整体引用」（递归列出子文件）
    expect(dir.item.kind).toBe('folder');
    expect(dir.item.lines[0]).toBe('【引用文件夹 src/】');
    expect(dir.item.lines.join('\n')).toContain('这个目录下没有可列出的文件');
    expect(file.item.lines).toEqual(['【引用文件】', '> path：a.R']);
    expect(file.item.lines.join('\n')).not.toContain('2.0KB');
    expect(file.detail).toBe('2.0KB');
  });

  it('递归树行自带的 path 优先于 prefix 拼接；无 path 时按 prefix+name 补', () => {
    const result = buildFileCandidates(
      [
        { name: 'b.R', type: 'file', path: 'deep/dir/b.R', size: 0 },
        { name: 'c.R', type: 'file', size: 0 },
      ],
      { prefix: 'root/' },
    );
    expect(result.candidates.map((c) => c.label)).toEqual(['deep/dir/b.R', 'root/c.R']);
  });

  it('服务端树被截断 → 保留候选但如实给提示（不谎称全量）', () => {
    const truncated = buildFileCandidates([{ name: 'a.R', type: 'file', size: 0 }], { treeTruncated: true });
    expect(truncated.candidates.length).toBe(1);
    expect(truncated.note).toContain('500');
    expect(buildFileCandidates([{ name: 'a.R', type: 'file', size: 0 }]).note).toBeNull();
  });
});

describe('BLOCK-245 P3 其余六源：只收对应形状', () => {
  it('技能源只认 kind=skill（模板不进 `@` 菜单，属斜杠通道）', () => {
    const result = buildSkillCandidates([
      { kind: 'skill', id: 'sk-1', label: '技能一（质控）', description: '质控说明' },
      { kind: 'template', id: 'tpl-1', label: '模板', description: '' },
    ]);
    expect(result.candidates.map((c) => c.label)).toEqual(['技能一（质控）']);
    expect(result.candidates[0].item.kind).toBe('skill');
  });

  it('连接器源把状态码译成中文并带工具数', () => {
    const result = buildConnectorCandidates([
      { id: 'filesystem', status: 'connected', toolCount: 5, transport: 'stdio' },
      { id: 'remote', status: 'auth_required', toolCount: 0 },
    ]);
    expect(result.candidates[0].detail).toBe('已连接 · 5 个工具');
    expect(result.candidates[0].item.lines).toContain('> 传输：stdio');
    expect(result.candidates[1].detail).toBe('需授权 · 0 个工具');
  });

  it('智能体源：零 profile = 未配置（给原因，不给看起来像"没有匹配"的空）', () => {
    const empty = buildAgentCandidates([]);
    expect(empty.candidates).toEqual([]);
    expect(empty.unavailableReason).toContain('尚未配置');
    const filled = buildAgentCandidates([{ name: 'reviewer', role: 'code-review', model: 'gpt-5.6-sol' }]);
    expect(filled.unavailableReason).toBeNull();
    expect(filled.candidates[0].detail).toBe('code-review · gpt-5.6-sol');
    expect(filled.candidates[0].item.lines).toContain('> profile：reviewer');
  });

  it('结果产物源只收已完成 job（进行中/失败不是可引用产物）', () => {
    const result = buildResultCandidates([
      { id: 'job-1', tool_id: 'scanpy', status: 'done', name: '聚类结果' },
      { id: 'job-2', tool_id: 'scanpy', status: 'running' },
      { id: 'job-3', tool_id: 'scanpy', status: 'failed' },
    ]);
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].label).toBe('聚类结果');
    expect(result.candidates[0].item.lines).toContain('> jobId：job-1');
  });

  it('知识空间源停用空间仍可见但标状态（不静默丢）', () => {
    const result = buildKnowledgeCandidates([
      { id: 'ks-1', name: '空间一', documents: 3, enabled: true },
      { id: 'ks-2', name: '空间二', documents: 0, enabled: false },
    ]);
    expect(result.candidates.length).toBe(2);
    expect(result.candidates[0].detail).toBe('已启用 · 3 个文档');
    expect(result.candidates[1].detail).toBe('已停用 · 0 个文档');
  });

  it('会话源排除当前会话自身', () => {
    const result = buildConversationCandidates(
      [
        { id: 'c-1', title: '上一个会话', message_count: 12 },
        { id: 'c-current', title: '当前会话', message_count: 3 },
      ],
      'c-current',
    );
    expect(result.candidates.map((c) => c.label)).toEqual(['上一个会话']);
  });
});

describe('BLOCK-245 P3 过滤 / 上限 / 不可用', () => {
  function fileSource(count: number): ContextSourceResult {
    return buildFileCandidates(
      Array.from({ length: count }, (_, i) => ({ name: `f${i}.R`, type: 'file' as const, size: 0 })),
    );
  }

  it('空 query = 全源展示，但按逐项上限截断并报被藏条数', () => {
    const cap = CONTEXT_SOURCE_CAPS.file;
    const filtered = filterContextSources([fileSource(cap + 3)], '');
    expect(filtered[0].candidates.length).toBe(cap);
    expect(filtered[0].truncated).toBe(3);
  });

  it('过滤先于截断：上限藏的是命中结果，不是前 N 条原始行', () => {
    const filtered = filterContextSources([fileSource(CONTEXT_SOURCE_CAPS.file + 5)], 'f13');
    expect(filtered.length).toBe(1);
    expect(filtered[0].candidates.map((c) => c.label)).toEqual(['f13.R']);
    expect(filtered[0].truncated).toBe(0);
  });

  it('有 query 时无命中的可用源不出行，但不可用源永远出行（原因本身就是信息）', () => {
    const sources = [fileSource(3), unavailableContextSource('agent', '尚未配置子智能体 profile')];
    const filtered = filterContextSources(sources, 'zzz-不存在');
    expect(filtered.map((s) => s.sourceId)).toEqual(['agent']);
    expect(listUnavailableSources(filtered).length).toBe(1);
  });

  it('零结果与不可用可区分：可用源零候选=无原因，不可用源零候选=有原因', () => {
    const okEmpty = buildSkillCandidates([]);
    const broken = unavailableContextSource('conversation', '会话列表请求失败（500）');
    expect(okEmpty.candidates.length).toBe(0);
    expect(okEmpty.unavailableReason).toBeNull();
    expect(broken.unavailableReason).toContain('500');
    expect(countContextCandidates([okEmpty, broken])).toBe(0);
  });

  it('命中面覆盖 label / detail / sourceId（大小写不敏感）', () => {
    const [candidate] = buildConnectorCandidates([{ id: 'Filesystem', status: 'connected', toolCount: 1 }]).candidates;
    expect(matchContextCandidate(candidate, 'filesys')).toBe(true);
    expect(matchContextCandidate(candidate, '已连接')).toBe(true);
    expect(matchContextCandidate(candidate, 'connector')).toBe(true);
    expect(matchContextCandidate(candidate, 'nope')).toBe(false);
  });

  it('扁平序 = 源次序 × 组内次序（键盘上下与视觉分组一致）', () => {
    const sources = [
      buildSkillCandidates([{ kind: 'skill', id: 'sk-1', label: 'A', description: '' }]),
      buildFileCandidates([{ name: 'b.R', type: 'file', size: 0 }]),
    ];
    expect(flattenContextCandidates(sources).map((c) => c.id)).toEqual(['skill:sk-1', 'file:b.R']);
  });
});

describe('BLOCK-245 P3 `@` 触发解析（光标处 token）', () => {
  it('行首 @ 与空白后的 @ 触发；紧贴文字的不触发（邮箱/路径不弹菜单）', () => {
    expect(parseMentionTrigger('@src', 4)).toMatchObject({ active: true, query: 'src', start: 0, end: 4 });
    expect(parseMentionTrigger('看下 @src', 7)).toMatchObject({ active: true, query: 'src', start: 3, end: 7 });
    expect(parseMentionTrigger('a@src', 5).active).toBe(false);
    expect(parseMentionTrigger('没有 @ 之外', 2).active).toBe(false);
  });

  it('@ 之后出现空白即结束 token；query 过长视为普通文本', () => {
    expect(parseMentionTrigger('@src foo', 8).active).toBe(false);
    expect(parseMentionTrigger(`@${'x'.repeat(41)}`, 42).active).toBe(false);
    expect(parseMentionTrigger('@', 1)).toMatchObject({ active: true, query: '' });
  });

  it('光标越界 / 负数一律不触发（受控 textarea 的边界防御）', () => {
    expect(parseMentionTrigger('@src', 99).active).toBe(false);
    expect(parseMentionTrigger('@src', -1).active).toBe(false);
  });

  it('选中候选后把 @token 从正文摘掉，光标落在原 token 起点', () => {
    const trigger = parseMentionTrigger('看下 @src', 7);
    expect(removeMentionToken('看下 @src', trigger)).toEqual({ text: '看下 ', caret: 3 });
    expect(removeMentionToken('abc', { active: false, query: '', start: -1, end: -1 }))
      .toEqual({ text: 'abc', caret: 3 });
  });
});
