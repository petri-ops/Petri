/**
 * McpShelfPane — 扩展中心「MCP 服务」货架（BLOCK-156 P2）。
 *
 * 配置/连接第三方 MCP server（stdio 子进程）：清单卡片（状态徽标/工具计数/
 * 连接·断开·移除）+ 添加表单（id / 命令 / 参数）。数据面走 useMcpServers
 * （后端 HTTP）。第三方工具经 P3 投影进 agent 可用集（此处只见连接事实）。
 */

import React, { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { useMcpServers, type McpServerStatus } from '@/hooks/useMcpServers';
import styles from './extensions.module.css';
import skillStyles from './styles.module.css';

const STATUS_LABELS: Record<McpServerStatus, string> = {
  connected: '已连接',
  connecting: '连接中…',
  disconnected: '未连接',
  error: '错误',
};

function parseArgs(raw: string): string[] {
  // 简单空格分参（带引号的复杂场景留给未来；v1 如实按空白切分）
  return raw.trim().length ? raw.trim().split(/\s+/) : [];
}

export function McpShelfPane(): React.ReactElement {
  const {
    servers, loading, error, notice, busyId,
    refresh, addServer, removeServer, connect, disconnect,
  } = useMcpServers();

  const [formOpen, setFormOpen] = useState(false);
  const [draftId, setDraftId] = useState('');
  const [draftCommand, setDraftCommand] = useState('');
  const [draftArgs, setDraftArgs] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const handleAdd = async () => {
    const id = draftId.trim();
    const command = draftCommand.trim();
    if (!id || /[\s/\\]/.test(id)) {
      setFormError('ID 不能为空，且不含空格/斜杠');
      return;
    }
    if (!command) {
      setFormError('命令不能为空（如 node / npx / uvx）');
      return;
    }
    setFormError(null);
    const ok = await addServer({ id, command, args: parseArgs(draftArgs) });
    if (ok) {
      setDraftId('');
      setDraftCommand('');
      setDraftArgs('');
      setFormOpen(false);
    } else {
      setFormError('添加失败（检查 ID 是否重复）');
    }
  };

  return (
    <div className={styles.shelfPane} data-testid="mcp-shelf">
      <div className={styles.mcpHeaderRow}>
        <div className={styles.mcpIntro}>
          <Icon name="zap" size={16} />
          <span>连接第三方 MCP server（stdio 子进程）；已连接 server 的工具自动进入 agent 可用集</span>
        </div>
        <button
          type="button"
          className={styles.mcpAddBtn}
          onClick={() => setFormOpen((v) => !v)}
          data-testid="mcp-add-toggle"
        >
          <Icon name="plus" size={14} />
          <span>{formOpen ? '收起表单' : '添加 server'}</span>
        </button>
      </div>

      {formOpen && (
        <div className={styles.mcpForm} data-testid="mcp-add-form">
          <div className={styles.mcpFormRow}>
            <label className={styles.mcpField}>
              <span>ID</span>
              <input
                value={draftId}
                onChange={(e) => setDraftId(e.target.value)}
                placeholder="如 filesystem（唯一标识）"
                aria-label="server ID"
                data-testid="mcp-form-id"
              />
            </label>
            <label className={`${styles.mcpField} ${styles.mcpFieldGrow}`}>
              <span>命令</span>
              <input
                value={draftCommand}
                onChange={(e) => setDraftCommand(e.target.value)}
                placeholder="如 npx -y @modelcontextprotocol/server-filesystem"
                aria-label="启动命令"
                data-testid="mcp-form-command"
              />
            </label>
          </div>
          <div className={styles.mcpFormRow}>
            <label className={`${styles.mcpField} ${styles.mcpFieldGrow}`}>
              <span>参数（空格分隔，可留空——命令含参数时也可全填这里）</span>
              <input
                value={draftArgs}
                onChange={(e) => setDraftArgs(e.target.value)}
                placeholder="如 /path/to/dir"
                aria-label="参数"
                data-testid="mcp-form-args"
              />
            </label>
            <button
              type="button"
              className={styles.mcpAddBtn}
              onClick={() => void handleAdd()}
              data-testid="mcp-form-submit"
            >
              保存
            </button>
          </div>
          {formError && <p className={styles.mcpFormError} role="alert">{formError}</p>}
        </div>
      )}

      {notice && (
        <p className={styles.mcpNotice} role="status" data-testid="mcp-notice">{notice}</p>
      )}
      {error && <p className={styles.mcpFormError} role="alert">后端不可达：{error}</p>}

      {loading ? (
        <div className={skillStyles.skillsEmpty}>
          <h3 className={skillStyles.emptyTitle}>加载 MCP 服务清单…</h3>
        </div>
      ) : servers.length === 0 ? (
        <div className={skillStyles.skillsEmpty} data-testid="mcp-empty">
          <div className={skillStyles.emptyIcon}>
            <Icon name="zap" size={24} />
          </div>
          <h3 className={skillStyles.emptyTitle}>还没有配置 MCP 服务</h3>
          <p className={skillStyles.emptyText}>点右上「添加 server」接入第一个第三方 MCP server</p>
        </div>
      ) : (
        <div className={styles.mcpList}>
          {servers.map((row) => (
            <div
              key={row.id}
              className={styles.mcpCard}
              data-testid={`mcp-card-${row.id}`}
              data-status={row.status}
            >
              <div className={styles.mcpCardHead}>
                <span className={styles.mcpCardId}>{row.id}</span>
                <span
                  className={`${styles.mcpStatusBadge} ${styles[`mcpStatus_${row.status}`] ?? ''}`}
                >
                  {STATUS_LABELS[row.status]}
                </span>
              </div>
              <div className={styles.mcpCardCmd} title={[row.command, ...row.args].join(' ')}>
                {row.command} {row.args.join(' ')}
              </div>
              <div className={styles.mcpCardMeta}>
                {row.status === 'connected' && (
                  <span>{row.toolCount} 个工具</span>
                )}
                {row.status === 'error' && row.error && (
                  <span className={styles.mcpErrorText} title={row.error}>{row.error}</span>
                )}
                {row.autoConnect && row.status === 'disconnected' && <span>启动时自动连接</span>}
              </div>
              <div className={styles.mcpCardActions}>
                {row.status === 'connected' || row.status === 'error' ? (
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void disconnect(row.id)}
                    data-testid={`mcp-disconnect-${row.id}`}
                  >
                    断开
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === row.id || row.status === 'connecting'}
                    onClick={() => void connect(row.id)}
                    data-testid={`mcp-connect-${row.id}`}
                  >
                    {row.status === 'connecting' ? '连接中…' : '连接'}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => void removeServer(row.id)}
                  data-testid={`mcp-remove-${row.id}`}
                >
                  移除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {/* BLOCK-160 W2 P5（DIST-2）— MCP 配置文件导入（对话框一条龙，skills 导入先例） */}
        <button
          type="button"
          className={styles.mcpRefresh}
          title="从 JSON 文件导入 MCP server 配置（{servers:[…]} 或数组；坏条目跳过并提示）"
          onClick={() => {
            void (async () => {
            const bridge = (window as unknown as { biof3Desktop?: { mcpConfigImportDialog?: () => Promise<{ ok: boolean; canceled?: boolean; imported?: number; skipped?: Array<{ id: string; error: string }>; error?: string }> } }).biof3Desktop;
            if (!bridge?.mcpConfigImportDialog) return;
            const result = await bridge.mcpConfigImportDialog();
            if (result?.canceled) return;
            if (result?.ok) {
              const skippedNote = result.skipped?.length ? `，跳过 ${result.skipped.length} 条（${result.skipped.map((x) => `${x.id}:${x.error}`).join('；')}）` : '';
              setFormError(`导入完成：${result.imported} 条${skippedNote}`);
              void refresh();
            } else if (result?.error) {
              setFormError(`导入失败：${result.error}`);
            }
            })();
          }}
        >
          <Icon name="file" size={12} />
          <span>导入配置</span>
        </button>
        <button
          type="button"
          className={styles.mcpRefresh}
          onClick={() => void refresh()}
          title="刷新状态"
        >
          <Icon name="refresh" size={12} />
          <span>刷新</span>
        </button>
      </div>
    </div>
  );
}
