/**
 * McpPolicyEditor — UI-547（Q8 深化）MCP 服务级工具治理。
 *
 * 只编辑真正生效的两项：白名单（非空=只投影名单内工具）与阻断（永远优先）。
 * BLOCK-243（Q1）起信任位已生效：ask 时声明 destructiveHint 的工具需审批，
 * allow 时自动批准；审批卡「始终信任此服务」可写该位，本面板只读展示当前值。
 */

import React, { useState } from 'react';
import type {
  McpPolicyDiagnostic,
  McpPolicyPatch,
  McpServerRow,
} from '@/hooks/useMcpServers';
import styles from './McpPolicyEditor.module.css';

const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

function parseToolNames(raw: string): { names: string[]; invalid: string[] } {
  const tokens = raw.split(/[\s,]+/).map((token) => token.trim()).filter(Boolean);
  const names: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (!TOOL_NAME_RE.test(token)) {
      invalid.push(token);
      continue;
    }
    if (seen.has(token)) continue;
    seen.add(token);
    names.push(token);
  }
  return { names, invalid };
}

function diagnosticText(diagnostic: McpPolicyDiagnostic): string {
  const suffix = diagnostic.value
    ? `：${diagnostic.value}`
    : typeof diagnostic.got === 'number' && typeof diagnostic.limit === 'number'
      ? `：${diagnostic.got}/${diagnostic.limit}`
      : '';
  return `${diagnostic.code}${suffix}`;
}

export interface McpPolicyEditorProps {
  server: McpServerRow;
  onSave: (patch: McpPolicyPatch) => Promise<{
    ok: boolean;
    diagnostics: McpPolicyDiagnostic[];
    error?: string;
  }>;
}

export function McpPolicyEditor({ server, onSave }: McpPolicyEditorProps): React.ReactElement {
  const policy = server.policy;
  const [allowText, setAllowText] = useState(() => (policy?.allow ?? []).join(', '));
  const [blockText, setBlockText] = useState(() => (policy?.block ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [diagnostics, setDiagnostics] = useState<McpPolicyDiagnostic[]>([]);

  if (!policy) {
    return (
      <p className={styles.unavailable} data-testid={`mcp-policy-unavailable-${server.id}`}>
        治理信息不可用（后端未返回 policy 摘要）。
      </p>
    );
  }

  const save = async () => {
    const allow = parseToolNames(allowText);
    const block = parseToolNames(blockText);
    const invalid = [...allow.invalid, ...block.invalid];
    if (invalid.length > 0) {
      setError(`工具名不合法：${invalid.join('、')}`);
      setDiagnostics([]);
      return;
    }
    setError('');
    setDiagnostics([]);
    setSaving(true);
    const result = await onSave({ allow: allow.names, block: block.names });
    setSaving(false);
    if (!result.ok) {
      setError(result.error || '保存失败');
      setDiagnostics(result.diagnostics);
      return;
    }
    setDiagnostics(result.diagnostics);
  };

  return (
    <section className={styles.editor} data-testid={`mcp-policy-${server.id}`}>
      <div className={styles.head}>
        <span>工具治理</span>
        <span className={styles.trust} data-testid={`mcp-policy-trust-${server.id}`}>
          信任位 {policy.trust === 'allow' ? 'allow（destructive 工具自动批准）' : 'ask（destructive 工具需确认）'}
          {policy.trust === 'allow' ? (
            <button
              type="button"
              className={`${styles.save} ${styles.revoke}`}
              disabled={saving}
              data-testid={`mcp-policy-trust-revoke-${server.id}`}
              onClick={() => {
                setError('');
                setDiagnostics([]);
                setSaving(true);
                void onSave({ trust: 'ask' }).then((result) => {
                  setSaving(false);
                  if (!result.ok) {
                    setError(result.error || '保存失败');
                    setDiagnostics(result.diagnostics);
                  }
                }).catch(() => {
                  setSaving(false);
                  setError('保存失败');
                });
              }}
            >
              改回 ask
            </button>
          ) : null}
        </span>
      </div>
      <p className={styles.note}>
        白名单非空时只投影名单内工具；阻断优先于白名单。信任位只影响声明 destructiveHint 的变更类工具；
        审批卡「始终信任此服务」可把该位改为 allow。
      </p>
      <span className={styles.metrics} data-testid={`mcp-policy-metrics-${server.id}`}>
        {policy.catalogMode
          ? `目录模式 · ${policy.catalogMode.total} 个工具按需加载 · 生效入口 ${policy.projectedToolCount}`
          : `生效 ${policy.projectedToolCount} · 已连接 ${server.toolCount} · 白名单 ${policy.allowCount} · 阻断 ${policy.blockCount}`}
      </span>
      {policy.catalogMode && (
        <span className={styles.note}>
          目录模式：agent 先读 catalog（list/describe），调用经 call 代理并复核服务级/逐工具策略。
        </span>
      )}
      <label className={styles.field}>
        <span>白名单（逗号/空格分隔；空=全部允许）</span>
        <input
          className={styles.input}
          value={allowText}
          onChange={(event) => setAllowText(event.target.value)}
          aria-label={`${server.id} 白名单工具`}
          data-testid={`mcp-policy-allow-${server.id}`}
        />
      </label>
      <label className={styles.field}>
        <span>阻断（逗号/空格分隔；优先于白名单）</span>
        <input
          className={styles.input}
          value={blockText}
          onChange={(event) => setBlockText(event.target.value)}
          aria-label={`${server.id} 阻断工具`}
          data-testid={`mcp-policy-block-${server.id}`}
        />
      </label>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.save}
          disabled={saving}
          onClick={() => void save()}
          data-testid={`mcp-policy-save-${server.id}`}
        >
          {saving ? '保存中…' : '保存治理'}
        </button>
        <span className={styles.hint}>只写本机策略文件，不改 server 配置</span>
      </div>
      {error && (
        <p className={styles.error} role="alert" data-testid={`mcp-policy-error-${server.id}`}>
          {error}
        </p>
      )}
      {diagnostics.length > 0 && (
        <ul className={styles.diagnostics} data-testid={`mcp-policy-diagnostics-${server.id}`}>
          {diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${index}`}>{diagnosticText(diagnostic)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
