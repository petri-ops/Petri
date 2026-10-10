'use strict';

/**
 * BLOCK-162 P0 — 零依赖 RFC6455 最小 WebSocket 服务端（mobile-gateway 专用面）。
 *
 * 背景：`ws` 包在依赖树中不可解析；依赖变更清单默认「不新增」→ 自写最小实现。
 * 支持面（如实边界）：
 *   ✅ 握手（Sec-WebSocket-Accept）、text 帧收发（7/16/64 位长度）、
 *      客户端掩码解码、ping→pong、pong 判活、close 握手、慢消费者保护
 *      （socket.writableLength 越限主动断开，防内存被拖爆）。
 *   ❌ 分片帧（continuation，opcode 0x0）与二进制帧：按协议错误显式 close
 *      (1002/1003)——浏览器对小 JSON 帧不分片；显式拒绝优于静默错解。
 */

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_SEND_BUFFER_BYTES = 1024 * 1024; // 慢消费者保护：待发队列越限断开
const OPCODE_TEXT = 0x1;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

function acceptKey(key) {
  return crypto.createHash('sha1').update(String(key) + WS_GUID).digest('base64');
}

/** 服务端→客户端帧不掩码（RFC6455 §5.1）。 */
function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function encodeTextFrame(obj) {
  return encodeFrame(OPCODE_TEXT, Buffer.from(JSON.stringify(obj), 'utf8'));
}

/**
 * 单连接包装。事件：'message'(obj) / 'close'()。
 * 所有失败路径（协议错/掩码缺失/背压越限）都收敛到 close()，绝不 throw 出网关。
 */
class WsConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.alive = true; // pong 刷新；ping 未回累计判死由 hub 心跳处理
    this.missedPongs = 0;
    socket.on('data', (chunk) => this.#feed(chunk));
    socket.on('error', () => this.close(1011));
    socket.on('close', () => this.#finish());
    socket.setNoDelay(true);
  }

  send(obj) {
    if (this.closed || this.socket.destroyed) return;
    this.socket.write(encodeTextFrame(obj));
    // 慢消费者保护：待发字节越限=对端收不动，断开止损（事件可经水位重连补齐）。
    if (this.socket.writableLength > MAX_SEND_BUFFER_BYTES) {
      this.close(1009, 'slow consumer');
    }
  }

  ping() {
    if (this.closed || this.socket.destroyed) return;
    this.socket.write(encodeFrame(0x9, Buffer.alloc(0)));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    this.closed = true;
    try {
      const reasonBuf = Buffer.from(reason, 'utf8').subarray(0, 120);
      const payload = Buffer.alloc(2 + reasonBuf.length);
      payload.writeUInt16BE(code, 0);
      reasonBuf.copy(payload, 2);
      this.socket.write(encodeFrame(OPCODE_CLOSE, payload));
    } catch { /* socket 已死即目标达成 */ }
    const t = setTimeout(() => this.#finish(), 1000);
    if (t.unref) t.unref();
  }

  #finish() {
    if (this.finished) return;
    this.finished = true;
    this.closed = true;
    try { this.socket.destroy(); } catch { /* 已死 */ }
    this.emit('close');
  }

  #feed(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (true) {
      const frame = this.#parseOne();
      if (!frame) break;
      this.#handleFrame(frame);
      if (this.closed) break;
    }
  }

  #parseOne() {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buf.length < offset + 2) return null;
      len = buf.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (buf.length < offset + 8) return null;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) { this.close(1009, 'frame too large'); return null; }
      len = Number(big);
      offset += 8;
    }
    if (!masked) { this.close(1002, 'client frames must be masked'); return null; }
    if (buf.length < offset + 4 + len) return null;
    const mask = buf.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.from(buf.subarray(offset, offset + len));
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    this.buffer = buf.subarray(offset + len);
    return { fin, opcode, payload };
  }

  #handleFrame({ fin, opcode, payload }) {
    if (!fin || opcode === 0x0 || opcode === 0x2) {
      // 分片/二进制：显式拒绝（模块头边界声明）
      this.close(opcode === 0x2 ? 1003 : 1002, 'unsupported frame type');
      return;
    }
    if (opcode === OPCODE_CLOSE) {
      this.close(1000);
      return;
    }
    if (opcode === OPCODE_PING) {
      if (!this.closed) this.socket.write(encodeFrame(0xa, payload));
      return;
    }
    if (opcode === OPCODE_PONG) {
      this.alive = true;
      this.missedPongs = 0;
      return;
    }
    if (opcode === OPCODE_TEXT) {
      let obj;
      try { obj = JSON.parse(payload.toString('utf8')); } catch { this.close(1007, 'bad json'); return; }
      this.emit('message', obj);
    }
  }
}

/**
 * 挂到 http.Server 的 upgrade 事件。返回 hub（EventEmitter：'connection'）与
 * 心跳句柄。authenticate(req) 返回真值才升级，否则写 401 后销毁——
 * 会话门语义与 HTTP 中间件同源，由调用方注入（网关=stores.sessions.authenticate）。
 */
function attachWsServer(server, { path: wsPath, authenticate, pingIntervalMs = 15_000 } = {}) {
  const hub = new EventEmitter();
  const connections = new Set();

  server.on('upgrade', (req, socket) => {
    let urlPath = '/';
    try { urlPath = new URL(req.url || '/', 'http://localhost').pathname; } catch { /* destroy below */ }
    if (urlPath !== wsPath) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!authenticate || !authenticate(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n` +
      '\r\n'
    );
    const conn = new WsConnection(socket);
    connections.add(conn);
    conn.on('close', () => connections.delete(conn));
    hub.emit('connection', conn, req);
  });

  // 心跳：15s ping 一轮；连续 2 轮无 pong 判死（30s 半开窗口，与 BLOCK-159 ServerAlive 对齐）
  const heartbeat = setInterval(() => {
    for (const conn of connections) {
      if (conn.closed) { connections.delete(conn); continue; }
      if (!conn.alive) {
        conn.missedPongs += 1;
        if (conn.missedPongs >= 2) { conn.close(1001, 'ping timeout'); continue; }
      } else {
        conn.missedPongs = 0;
      }
      conn.alive = false;
      conn.ping();
    }
  }, pingIntervalMs);
  if (heartbeat.unref) heartbeat.unref();

  return { hub, connections, close: () => clearInterval(heartbeat) };
}

module.exports = {
  MAX_SEND_BUFFER_BYTES,
  acceptKey,
  encodeFrame,
  encodeTextFrame,
  WsConnection,
  attachWsServer,
};
