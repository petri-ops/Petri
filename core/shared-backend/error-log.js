/**
 * BioF3 shared backend — Error Log
 *
 * Append-only JSONL error log shared by all backend roles. Replaces the
 * previous biof3-server/helpers/error-log.js. No external dependencies.
 */

const fsPromises = require('fs').promises;

const errorLogFile = process.env.BIOF3_ERROR_LOG_FILE || '/var/log/biof3-errors.log';

function normalizeError(err) {
  if (err && typeof err === 'object') {
    return {
      message: err.message || String(err),
      stack: err.stack,
    };
  }
  return {
    message: String(err),
    stack: undefined,
  };
}

function logError(source, err, meta = {}) {
  const normalized = normalizeError(err);
  const entry = {
    time: new Date().toISOString(),
    source,
    message: normalized.message,
    stack: normalized.stack,
    ...meta,
  };

  fsPromises.appendFile(errorLogFile, JSON.stringify(entry) + '\n').catch(() => {});
  console.error('[' + source + ']', entry.message);
}

async function readRecentErrors(limit = 200) {
  const content = await fsPromises.readFile(errorLogFile, 'utf-8').catch(() => '');
  return content
    .split('\n')
    .filter((line) => line.trim())
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = {
  errorLogFile,
  logError,
  readRecentErrors,
};
