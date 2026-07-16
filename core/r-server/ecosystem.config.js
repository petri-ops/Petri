/**
 * PM2 Ecosystem Configuration for BioF3 R Server.
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 restart biof3-r-server
 *   pm2 logs biof3-r-server
 *   pm2 monit
 *
 * Install PM2:
 *   npm install -g pm2
 *   pm2 startup  (auto-start on boot)
 *   pm2 save
 */

module.exports = {
  apps: [{
    name: 'biof3-r-server',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,  // Single instance (R pool handles concurrency internally)
    exec_mode: 'fork',

    // Environment
    env: {
      NODE_ENV: 'production',
      // Dell r-server MUST stay 3001 — frps tunnel + ECS nginx proxy_pass all
      // target 172.17.0.1:3001. server.js falls back to 3003 if this is unset,
      // so never `pm2 restart --update-env` from a shell lacking R_SERVER_PORT
      // (it drops this value → process rebinds 3003 → frps backend dead → 504).
      // Restart via: pm2 restart ecosystem.config.js --only biof3-r-server
      R_SERVER_PORT: 3001,
      BIOF3_INTERNAL_TOKEN: process.env.BIOF3_INTERNAL_TOKEN || '',
      BIOF3_REQUIRE_INTERNAL_CACHE_OPS: process.env.BIOF3_REQUIRE_INTERNAL_CACHE_OPS || '',
      // Override the global /etc/biof3.env BIOF3_RUN_MODE=worker (meant for
      // biof3-r-worker). This HTTP node must stay up for /api/r/* compute
      // compatibility and ECS -> Dell internal ops, but it should not drain
      // the PG task queue itself. Queue execution belongs to biof3-r-worker.
      BIOF3_RUN_MODE: 'api',
    },

    // Auto-restart
    watch: false,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 3000,

    // Memory limit — restart if exceeds 1GB
    max_memory_restart: '1G',

    // Logging
    error_file: '/var/log/biof3/r-server-error.log',
    out_file: '/var/log/biof3/r-server-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,

    // Graceful shutdown
    kill_timeout: 10000,
    listen_timeout: 8000,
    shutdown_with_message: true,
  }],
};
