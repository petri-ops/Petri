/**
 * PM2 config for BioF3 Python Server + py-worker.
 *
 * Production (Dell):
 *   set -a && source /opt/biof3-py-server/.env && source /etc/biof3.env && set +a
 *   export BIOF3_RUN_MODE=api BIOF3_WORKER_ID=py-dell
 *   pm2 start ecosystem.config.js --update-env
 */

module.exports = {
  apps: [
    {
      name: 'biof3-py-server',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        BIOF3_RUN_MODE: process.env.BIOF3_RUN_MODE || 'api',
        PY_SERVER_PORT: process.env.PY_SERVER_PORT || '3002',
        DATABASE_URL: process.env.DATABASE_URL || '',
        BIOF3_P2_PG: process.env.BIOF3_P2_PG || '1',
        OSS_REGION: process.env.OSS_REGION || 'oss-cn-hangzhou',
        OSS_AK: process.env.OSS_AK || '',
        OSS_SK: process.env.OSS_SK || '',
        OSS_BUCKET: process.env.OSS_BUCKET || 'biof3-uploads',
        JWT_SECRET: process.env.JWT_SECRET || '',
      },
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,
      max_memory_restart: '1G',
      error_file: '/var/log/biof3/py-server-error.log',
      out_file: '/var/log/biof3/py-server-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      kill_timeout: 10000,
    },
    {
      name: 'biof3-py-worker',
      script: 'worker.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        BIOF3_RUN_MODE: 'worker',
        BIOF3_WORKER_ID: process.env.BIOF3_WORKER_ID || 'py-dell',
        DATABASE_URL: process.env.DATABASE_URL || '',
        BIOF3_P2_PG: process.env.BIOF3_P2_PG || '1',
        OSS_REGION: process.env.OSS_REGION || 'oss-cn-hangzhou',
        OSS_AK: process.env.OSS_AK || '',
        OSS_SK: process.env.OSS_SK || '',
        OSS_BUCKET: process.env.OSS_BUCKET || 'biof3-uploads',
      },
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,
      max_memory_restart: '1G',
      error_file: '/var/log/biof3/py-worker-error.log',
      out_file: '/var/log/biof3/py-worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      kill_timeout: 10000,
    },
  ],
};