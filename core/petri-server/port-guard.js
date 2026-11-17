'use strict';

// BLOCK-457 P1 — 端口守卫（bind-first fail-fast 的可测内核）。
// bootstrap（server.js）在 require 任何业务模块之前先 tryBindPort：
// 绑定成功 → 把持有的 net.Server 作为 handle 交给 HTTP server（零竞窗）；
// 绑定失败 → 调用方单行日志后 process.exit(PORT_IN_USE_EXIT_CODE)。
// 设计约束：本模块零依赖（仅 node:net）、零副作用（不开 DB、不写文件），
// 使「第二个后端」在触碰任何共享状态前就退出。

const net = require('net');

// 专用退出码：supervisor 以 noRetryExitCodes 识别「绑定类永久失败」，不重试。
const PORT_IN_USE_EXIT_CODE = 77;

/**
 * 尝试绑定 host:port。
 * @returns {Promise<net.Server|null>} 成功=已监听的 net.Server（调用方负责转发给
 *   http server 或 close）；失败=null（端口被占）。
 */
function tryBindPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      // EADDRINUSE / EACCES 等一律视为「不可绑定」——bootstrap 只关心能不能占住。
      resolve(null);
    });
    server.listen(port, host, () => resolve(server));
  });
}

module.exports = { tryBindPort, PORT_IN_USE_EXIT_CODE };
