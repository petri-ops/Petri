// BLOCK-246 C16/C17 — 文件夹整体引用 / 应用快照 / 跨会话摘要：形状与上限。
import { describe, expect, it } from 'vitest';
import {
  FOLDER_EXPAND_LIMIT,
  buildConversationCandidates,
  buildConversationDigest,
  buildFileCandidates,
  buildSnapshotCandidates,
} from './contextSources';

const tree = [
  { name: 'analysis', type: 'dir' as const, path: 'analysis' },
  { name: 'qc.py', type: 'file' as const, path: 'analysis/qc.py', size: 2048 },
  { name: 'norm.py', type: 'file' as const, path: 'analysis/norm.py', size: 1024 },
  { name: 'README.md', type: 'file' as const, path: 'README.md', size: 512 },
  { name: 'empty', type: 'dir' as const, path: 'empty' },
];

describe('buildFileCandidates — 文件夹整体引用', () => {
  it('expands a folder into its descendant files with an honest count', () => {
    const dir = buildFileCandidates(tree).candidates.find((candidate) => candidate.id === 'file:analysis');
    expect(dir).toBeTruthy();
    expect(dir!.item.kind).toBe('folder');
    expect(dir!.detail).toContain('2 个文件');
    const text = dir!.item.lines.join('\n');
    expect(text.startsWith('【引用文件夹 analysis/】')).toBe(true);
    expect(text).toContain('> 共 2 个文件');
    expect(text).toContain('> analysis/qc.py');
    expect(text).toContain('> analysis/norm.py');
    // 兄弟目录的文件不得混进来
    expect(text).not.toContain('README.md');
  });

  it('says so when a folder has no listable files instead of pretending it is empty-by-design', () => {
    const dir = buildFileCandidates(tree).candidates.find((candidate) => candidate.id === 'file:empty');
    expect(dir!.item.lines.join('\n')).toContain('这个目录下没有可列出的文件');
  });

  it('caps the listing and reports how many were hidden', () => {
    const many = Array.from({ length: FOLDER_EXPAND_LIMIT + 5 }, (_, i) => ({
      name: `f${i}.R`,
      type: 'file' as const,
      path: `big/f${i}.R`,
      size: 10,
    }));
    const folder = buildFileCandidates([{ name: 'big', type: 'dir' as const, path: 'big' }, ...many])
      .candidates.find((candidate) => candidate.id === 'file:big')!;
    const text = folder.item.lines.join('\n');
    expect(text).toContain(`共 ${FOLDER_EXPAND_LIMIT + 5} 个文件`);
    expect(text).toContain(`已列前 ${FOLDER_EXPAND_LIMIT}`);
  });

  it('keeps plain files as file-kind candidates (no behaviour drift)', () => {
    const file = buildFileCandidates(tree).candidates.find((candidate) => candidate.id === 'file:README.md')!;
    expect(file.item.kind).toBe('file');
    expect(file.item.lines).toEqual(['【引用文件】', '> path：README.md']);
  });
});

describe('buildSnapshotCandidates', () => {
  it('produces one snapshot candidate with the fields it actually knows', () => {
    const result = buildSnapshotCandidates({
      projectId: 'proj_1',
      projectName: '单细胞入门',
      conversationId: 'conv_9',
      surfaceLabel: '项目工作区',
      runningTasks: 2,
    });
    expect(result.candidates).toHaveLength(1);
    const item = result.candidates[0].item;
    expect(item.kind).toBe('snapshot');
    const text = item.lines.join('\n');
    expect(text).toContain('【引用应用快照】');
    expect(text).toContain('> 项目：单细胞入门');
    expect(text).toContain('> 会话：conv_9');
    expect(text).toContain('> 在跑任务：2');
  });

  it('writes 未接入 for unknown runtime facts instead of inventing them', () => {
    const result = buildSnapshotCandidates({ projectId: 'proj_1' });
    const text = result.candidates[0].item.lines.join('\n');
    expect(text).toContain('> 在跑任务：未接入');
    expect(text).toContain('> 当前面：未接入');
    expect(text).toContain('（未开始会话）');
  });

  it('explains why there is nothing to snapshot without a project', () => {
    const result = buildSnapshotCandidates({});
    expect(result.candidates).toHaveLength(0);
    expect(result.note).toContain('未选择项目');
  });
});

describe('buildConversationDigest', () => {
  const messages = Array.from({ length: 12 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `第 ${i} 条消息，内容是${'很长的说明'.repeat(20)}`,
  }));

  it('keeps the tail, clips per message, and marks truncation', () => {
    const digest = buildConversationDigest(messages, { maxMessages: 3, maxCharsPerMessage: 20 });
    expect(digest.total).toBe(12);
    // used = 摘要实际占用字符数（不是消息条数）
    expect(digest.used).toBeGreaterThan(0);
    expect(digest.used).toBe(digest.lines.reduce((sum, line) => sum + line.length, 0));
    expect(digest.truncated).toBe(true);
    expect(digest.lines).toHaveLength(3);
    expect(digest.lines[0]).toMatch(/^> (用户|助手)：/);
    expect(digest.lines[0]).toContain('…');
    expect(digest.lines.join('\n')).toContain('第 9 条');
  });

  it('stops at the total char budget with an explicit note', () => {
    const digest = buildConversationDigest(messages, { maxMessages: 12, maxCharsPerMessage: 100, maxTotalChars: 120 });
    expect(digest.lines.join('\n')).toContain('摘要已达字符上限');
    expect(digest.truncated).toBe(true);
  });

  it('reports no truncation when everything fits', () => {
    const digest = buildConversationDigest([{ role: 'user', content: '短' }], {});
    expect(digest.truncated).toBe(false);
    expect(digest.lines).toEqual(['> 用户：短']);
  });
});

describe('buildConversationCandidates — 带摘要', () => {
  it('appends the digest block only when a digest exists', () => {
    const withDigest = buildConversationCandidates([
      { id: 'c1', title: '昨天的分析', message_count: 12, digest: ['> 用户：跑一下 QC'] },
    ]).candidates[0];
    const text = withDigest.item.lines.join('\n');
    expect(text).toContain('> 摘要（末尾若干条，已裁剪）：');
    expect(text).toContain('> 用户：跑一下 QC');
    expect(withDigest.detail).toContain('含摘要');

    const without = buildConversationCandidates([{ id: 'c2', title: '空会话' }]).candidates[0];
    expect(without.item.lines.join('\n')).not.toContain('摘要');
  });

  it('never offers the current conversation to itself', () => {
    const result = buildConversationCandidates([{ id: 'c1', title: '自己' }], 'c1');
    expect(result.candidates).toHaveLength(0);
  });
});
