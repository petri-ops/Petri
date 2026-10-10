'use strict';

/**
 * BLOCK-162 测试基建 — 最小 WS 测试客户端（RFC6455 客户端方向掩码发送）。
 * 供 block162-ws-server / block162-agent-ws-endpoint 两测试共用；零测试依赖。
 */

import crypto from 'node:crypto';
import http from 'node:http';

export class WsTestClient {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.queue = [];
    this.waiters = [];
    this.closed = false;
    this.closeCode = null;
    this.autoPong = true;
    socket.on('data', (c) => this.#feed(c));
    socket.on('close', () => { this.closed = true; this.#wake(); });
    socket.on('error', () => {});
  }

  /** 升级成功 → WsTestClient；被拒 → { rejected: statusCode }。 */
  static connect(port, wsPath, headers = {}) {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: wsPath,
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': key,
          'Sec-WebSocket-Version': '13',
          ...headers,
        },
      });
      req.on('upgrade', (res, socket) => resolve(new WsTestClient(socket)));
      req.on('response', (res) => {
        res.resume();
        resolve({ rejected: res.statusCode });
      });
      req.on('error', reject);
      req.end();
    });
  }

  #feed(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (true) {
      const buf = this.buffer;
      if (buf.length < 2) return;
      const opcode = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + len) return;
      const payload = buf.subarray(off, off + len);
      this.buffer = buf.subarray(off + len);
      if (opcode === 0x1) this.#push(JSON.parse(payload.toString('utf8')));
      else if (opcode === 0x9) { // 服务端 ping → 自动 pong（可关）
        if (this.autoPong) this.#sendFrame(0x8a, payload); // FIN|pong（firstByte 直传）
        this.#push({ __ping: true });
      } else if (opcode === 0xa) this.#push({ __pong: true });
      else if (opcode === 0x8) {
        this.closed = true;
        this.closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : null;
        this.#wake();
        try { this.socket.destroy(); } catch { /* 已死 */ }
        return;
      }
    }
  }

  #push(msg) {
    this.queue.push(msg);
    this.#wake();
  }

  #wake() {
    for (const w of this.waiters.splice(0)) w();
  }

  #sendFrame(firstByte, payload) {
    const mask = crypto.randomBytes(4);
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i % 4];
    let header;
    if (payload.length < 126) header = Buffer.from([firstByte, 0x80 | payload.length]);
    else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = firstByte;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = firstByte;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  send(obj) {
    this.#sendFrame(0x81, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  /** fin=false 用于构造分片首帧（协议错误面测试）。 */
  sendRawMasked(opcode, payload, fin = true) {
    this.#sendFrame((fin ? 0x80 : 0) | opcode, payload);
  }

  sendUnmaskedText(obj) {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    this.socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
  }

  /** 下一条消息（含 __ping/__pong 标记）；closed 且无排队 → null。 */
  next(timeoutMs = 1500) {
    return new Promise((resolve) => {
      const done = () => {
        const msg = this.queue.shift();
        resolve(msg === undefined ? null : msg);
      };
      if (this.queue.length) return done();
      if (this.closed) return resolve(null);
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(wake);
        if (idx >= 0) this.waiters.splice(idx, 1);
        done();
      }, timeoutMs);
      const wake = () => { clearTimeout(timer); done(); };
      this.waiters.push(wake);
    });
  }

  close() {
    try {
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(1000, 0);
      this.#sendFrame(0x8, payload);
      this.socket.destroy();
    } catch { /* 已死 */ }
  }
}
