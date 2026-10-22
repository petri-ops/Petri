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
import { McpPolicyEditor } from './McpPolicyEditor';
import styles from './extensions.module.css';
import { EmptyState, LoadingBlock } from '../../components/ui/controls/Status';

const STATUS_LABELS: Record<McpServerStatus, string> = {
  connected: '已连接',
  connecting: '连接中…',
  disconnected: '未连接',
  error: '错误',
  auth_required: '需要授权',
  authorizing: '等待授权…',
};

function parseArgs(raw: string): string[] {
  // 简单空格分参（带引号的复杂场景留给未来；v1 如实按空白切分）
  return raw.trim().length ? raw.trim().split(/\s+/) : [];
}

export function McpShelfPane(): React.ReactElement {
  const {
    servers, loading, error, notice, busyId,
    refresh, addServer, removeServer, connect, disconnect, updatePolicy, authenticate,
  } = useMcpServers();

  const [formOpen, setFormOpen] = useState(false);
  const [draftId, setDraftId] = useState('');
  const [draftTransport, setDraftTransport] = useState<'stdio' | 'http'>('stdio');
  const [draftCommand, setDraftCommand] = useState('');
  const [draftArgs, setDraftArgs] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  const handleAuthenticate = async (row: { id: string }) => {
    const result = await authenticate(row.id);
    if (result.authorizationUrl) {
      setAuthUrl(result.authorizationUrl);
      try {
        window.open(result.authorizationUrl, '_blank', 'noopener');
      } catch { /* 浏览器未打开时下方链接兜底 */ }
    } else {
      setAuthUrl(null);
    }
  };

  const handleAdd = async () => {
    const id = draftId.trim();
    const isHttp = draftTransport === 'http';
    const command = draftCommand.trim();
    const url = draftUrl.trim();
    if (!id || /[\s/\\]/.test(id)) {
      setFormError('ID 不能为空，且不含空格/斜杠');
      return;
    }
    if (isHttp && !/^https?:\/\//.test(url)) {
      setFormError('URL 必须以 http:// 或 https:// 开头');
      return;
    }
    if (!isHttp && !command) {
      setFormError('命令不能为空（如 node / npx / uvx）');
      return;
    }
    setFormError(null);
    const ok = await addServer({
      id,
      command: isHttp ? 'http' : command,
      args: isHttp ? [] : parseArgs(draftArgs),
      transport: draftTransport,
      ...(isHttp ? { url } : {}),
    });
    if (ok) {
      setDraftId('');
      setDraftCommand('');
      setDraftArgs('');
      setDraftUrl('');
      setDraftTransport('stdio');
      setFormOpen(false);
    } else {
      setFormError('添加失败（检查 ID 是否重复或 URL 是否合法）');
    }
  };

  return (
    <div className={styles.shelfPane} data-testid="mcp-shelf">
      <div className={styles.mcpHeaderRow}>
        <div className={styles.mcpIntro}>
          <Icon name="zap" size={16} />
          <span>连接第三方 MCP server（本地 stdio 或 HTTP/OAuth）；已连接 server 的工具自动进入 agent 可用集</span>
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
              <span>传输</span>
              <select
                value={draftTransport}
                onChange={(e) => setDraftTransport(e.target.value === 'http' ? 'http' : 'stdio')}
                aria-label="传输类型"
                data-testid="mcp-form-transport"
              >
                <option value="stdio">本地 stdio</option>
                <option value="http">HTTP（OAuth）</option>
              </select>
            </label>
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
            {draftTransport === 'http' ? (
              <label className={`${styles.mcpField} ${styles.mcpFieldGrow}`}>
                <span>URL</span>
                <input
                  value={draftUrl}
                  onChange={(e) => setDraftUrl(e.target.value)}
                  placeholder="https://example.com/mcp"
                  aria-label="MCP URL"
                  data-testid="mcp-form-url"
                />
              </label>
            ) : (
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
            )}
          </div>
          <div className={styles.mcpFormRow}>
            {draftTransport === 'http' ? (
              <span className={`${styles.mcpAuthHint} ${styles.mcpFieldGrow}`}>
                保存后点卡片上的「授权」完成 OAuth；授权前工具不会投影。
              </span>
            ) : (
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
            )}
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
      {authUrl && (
        <p className={styles.mcpNotice} data-testid="mcp-auth-url">
          若浏览器未打开，请手动访问：
          <a href={authUrl} target="_blank" rel="noreferrer">{authUrl}</a>
        </p>
      )}

      {loading ? (
        <LoadingBlock label="加载 MCP 服务清单…" />
      ) : servers.length === 0 ? (
        <div data-testid="mcp-empty">
          <EmptyState
            icon={<Icon name="zap" size={24} />}
            title="还没有配置 MCP 服务"
            description="点右上「添加 server」接入第一个第三方 MCP server"
          />
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
              <div
                className={styles.mcpCardCmd}
                title={row.transport === 'http' ? row.url : [row.command, ...row.args].join(' ')}
              >
                {row.transport === 'http' ? row.url : `${row.command} ${row.args.join(' ')}`}
              </div>
              <div className={styles.mcpCardMeta}>
                {row.status === 'connected' && (
                  <span>{row.toolCount} 个工具</span>
                )}
                {row.auth === 'authorized' && (
                  <span data-testid={`mcp-auth-badge-${row.id}`}>已授权</span>
                )}
                {row.status === 'error' && row.error && (
                  <span className={styles.mcpErrorText} title={row.error}>{row.error}</span>
                )}
                {row.status === 'auth_required' && (
                  <span className={styles.mcpAuthHint}>授权后才能发现并调用该 server 的工具</span>
                )}
                {row.autoConnect && row.status === 'disconnected' && <span>启动时自动连接</span>}
              </div>
              <McpPolicyEditor
                server={row}
                onSave={(patch) => updatePolicy(row.id, patch)}
              />
              <div className={styles.mcpCardActions}>
                {row.status === 'auth_required' ? (
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void handleAuthenticate(row)}
                    data-testid={`mcp-authenticate-${row.id}`}
                  >
                    授权
                  </button>
                ) : row.status === 'authorizing' ? (
                  <button type="button" disabled data-testid={`mcp-authorizing-${row.id}`}>
                    等待授权…
                  </button>
                ) : row.status === 'connected' || row.status === 'error' ? (
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
            const bridge = (window as unknown as { petriDesktop?: { mcpConfigImportDialog?: () => Promise<{ ok: boolean; canceled?: boolean; imported?: number; skipped?: Array<{ id: string; error: string }>; error?: string }> } }).petriDesktop;
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
