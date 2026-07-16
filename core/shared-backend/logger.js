/**
 * BioF3 shared backend — Structured Logger
 *
 * Canonical logger implementation shared by r-server and py-server.
 * JSON-formatted logs in production; pretty console in development.
 */

const isDev = process.env.NODE_ENV !== 'production';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LEVELS[process.env.LOG_LEVEL || (isDev ? 'debug' : 'info')];

function formatLog(level, msg, meta) {
  if (isDev) {
    const prefix = { debug: '🔍', info: '✅', warn: '⚠️', error: '❌' }[level];
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `${prefix} [${new Date().toISOString()}] ${msg}${metaStr}`;
  }
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  });
}

function log(level, msg, meta) {
  if (LEVELS[level] < minLevel) return;
  const line = formatLog(level, msg, meta);
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

/**
 * Create a child logger that automatically includes requestId in all log entries.
 * Usage: const rlog = logger.child(req.requestId); rlog.info('...');
 */
function child(requestId) {
  return {
    debug: (msg, meta) => log('debug', msg, { ...meta, rid: requestId }),
    info: (msg, meta) => log('info', msg, { ...meta, rid: requestId }),
    warn: (msg, meta) => log('warn', msg, { ...meta, rid: requestId }),
    error: (msg, meta) => log('error', msg, { ...meta, rid: requestId }),
  };
}

module.exports = {
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  child,
};
