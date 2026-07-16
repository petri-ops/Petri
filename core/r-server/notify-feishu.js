/**
 * BioF3 Feishu Realtime Notifier
 *
 * Sends realtime notifications to the Feishu group via the same webhook used by
 * the daily digest. Designed to be:
 *   - Fail-silent (a webhook outage NEVER takes down the main service)
 *   - Deduped (same alert key within DEDUPE_WINDOW_MS only sent once)
 *   - Easy to gate via env var (FEISHU_REALTIME_ENABLED=false to disable)
 *
 * Usage:
 *   const notify = require('./notify-feishu');
 *   notify.toolJobFailed({jobId, toolId, username, error, durationMs});
 *   notify.smokeTest({ok: false, summary: '5/5 ✓', details: '...', duration: 12345});
 *   notify.custom({title, lines, template: 'red'});
 */

const https = require('https');
const http = require('http');

// ---- Config (read at first use, refresh per env change is not needed in pm2) ----
const WEBHOOK_URL = process.env.ALERT_WEBHOOK || '';
const ENABLED = (process.env.FEISHU_REALTIME_ENABLED || 'true').toLowerCase() !== 'false';
const SITE_URL = process.env.BIOF3_SITE_URL || 'https://biof3.com';
const DEDUPE_WINDOW_MS = parseInt(process.env.NOTIFY_DEDUPE_WINDOW_MS || '300000', 10); // 5 min default

// ---- Dedupe cache (in-process; pm2 restart = reset) ----
const _dedupe = new Map(); // key -> lastSentMs
const _MAX_DEDUPE_SIZE = 500;

function _shouldSkip(key) {
  if (!key) return false;
  const now = Date.now();
  const last = _dedupe.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return true;
  _dedupe.set(key, now);
  // simple LRU pruning
  if (_dedupe.size > _MAX_DEDUPE_SIZE) {
    const cutoff = now - DEDUPE_WINDOW_MS * 2;
    for (const [k, t] of _dedupe.entries()) {
      if (t < cutoff) _dedupe.delete(k);
    }
  }
  return false;
}

// ---- Low-level send ----
function _send(payload) {
  if (!ENABLED) return;
  if (!WEBHOOK_URL) return;
  let url;
  try { url = new URL(WEBHOOK_URL); } catch { return; }
  const body = JSON.stringify(payload);
  const lib = url.protocol === 'http:' ? http : https;
  const req = lib.request({
    hostname: url.hostname,
    port: url.port || (url.protocol === 'http:' ? 80 : 443),
    path: url.pathname + url.search,
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)},
    timeout: 5000,
  }, (res) => {
    let buf = '';
    res.on('data', (c) => { buf += c.toString(); });
    res.on('end', () => {
      // Surface non-success responses (e.g. 19024 Key Words Not Found, 19002 invalid sign)
      // in pm2 logs so future webhook misconfig is debuggable.
      try {
        const j = JSON.parse(buf);
        if (j.code && j.code !== 0) {
          console.warn('[notify-feishu] webhook non-success:', j.code, j.msg, '— payload title:', payload.card?.header?.title?.content || '<no card>');
        }
      } catch {}
    });
  });
  req.on('error', (e) => { console.warn('[notify-feishu] send error:', e.message); });
  req.on('timeout', () => { try { req.destroy(); } catch {} });
  req.write(body);
  req.end();
}

// ---- Public: custom card with title + lines ----
//   template: 'green' | 'blue' | 'orange' | 'red' | 'wathet' | 'turquoise' | 'purple' | 'indigo' | 'violet' | 'carmine'
function custom({title, lines = [], template = 'blue', dedupeKey, button}) {
  if (dedupeKey && _shouldSkip(dedupeKey)) return;
  // Feishu bot security: inject the required keyword "BioF3" if absent.
  // Without this, the webhook returns 19024 "Key Words Not Found" and silently drops the message.
  const KEYWORD = 'BioF3';
  let safeTitle = title;
  if (!String(title).includes(KEYWORD)) {
    safeTitle = `[${KEYWORD}] ${title}`;
  }
  const elements = [];
  if (lines.length) {
    elements.push({tag: 'div', text: {tag: 'lark_md', content: lines.join('\n')}});
  }
  if (button) {
    elements.push({tag: 'hr'});
    elements.push({
      tag: 'action',
      actions: [{
        tag: 'button',
        text: {tag: 'plain_text', content: button.label || '查看详情'},
        type: button.type || 'default',
        url: button.url,
      }],
    });
  }
  _send({
    msg_type: 'interactive',
    card: {
      config: {wide_screen_mode: true},
      header: {
        title: {tag: 'plain_text', content: safeTitle},
        template,
      },
      elements,
    },
  });
}

// ---- Public: tool job failed ----
function toolJobFailed({jobId, toolId, username, error, durationMs, stage}) {
  // Truncate noisy R errors to first meaningful line + crop to 300 chars
  const errStr = String(error || '').trim();
  const firstError = errStr.split('\n').find(l => /Error|error|Permission denied/i.test(l)) || errStr.split('\n').slice(-3).join('\n');
  const errPreview = (firstError || errStr).slice(0, 300);
  const dur = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : '?';
  const stageLabel = stage ? ` · ${stage}` : '';
  custom({
    title: `🚨 工具任务失败: ${toolId}`,
    template: 'red',
    dedupeKey: `tool_failed:${toolId}:${(errPreview).slice(0, 80)}`,
    lines: [
      `**${username || '<匿名>'}**${stageLabel} · 用时 ${dur}`,
      `\`${jobId}\``,
      '',
      '```',
      errPreview,
      '```',
    ],
    button: {
      label: '管理后台',
      type: 'primary',
      url: `${SITE_URL}/admin`,
    },
  });
}

// ---- Public: smoke test result (one-shot summary at end of run) ----
function smokeTest({ok, totalCount, passCount, failCount, durationMs, failures = []}) {
  const dur = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : '?';
  const lines = [
    `**${passCount}/${totalCount} 通过** · 用时 ${dur}`,
  ];
  if (!ok && failures.length) {
    lines.push('');
    lines.push('**失败明细：**');
    for (const f of failures.slice(0, 5)) {
      lines.push(`· **${f.toolId}**: ${(f.error || '').slice(0, 120)}`);
    }
    if (failures.length > 5) {
      lines.push(`· ...还有 ${failures.length - 5} 个失败`);
    }
  }
  custom({
    title: ok ? `✅ Smoke Test 全部通过` : `🟥 Smoke Test 失败 (${failCount}/${totalCount})`,
    template: ok ? 'green' : 'red',
    // No dedupe — each smoke test run should always notify
    lines,
    button: {
      label: '管理后台',
      type: ok ? 'default' : 'primary',
      url: `${SITE_URL}/admin`,
    },
  });
}

// ---- Public: simple text (for quick debug; rarely use directly) ----
function text(content) {
  _send({msg_type: 'text', content: {text: content}});
}

module.exports = {
  custom,
  toolJobFailed,
  smokeTest,
  text,
  // Exposed for testing
  _internals: {_send, _shouldSkip, _dedupe},
};
