'use strict';

/**
 * BLOCK-85 P4 — 投影终端引擎（node-pty 会话管理器，core 侧）。
 *
 * 手机/协作成员的桌面投影里点终端 → gateway 会话门内走本模块：真 pty
 * （powershell/bash），输出 SSE 流，输入 POST。会话驻留本模块（手机锁屏
 * 断流回来可续看，环形缓冲重放），闲置 TTL 清理。上限 4 会话/实例（与
 * 桌面 terminal.js 同值）。
 */

const path = require('node:path');
const os = require('node:os');

const MAX_SESSIONS = 4;
const RING_BUFFER_BYTES = 256 * 1024;
const IDLE_TTL_MS = 30 * 60_000;

const sessions = new Map(); // id -> { pty, ring, ringLen, subscribers:Set<fn>, exited, exitCode, lastWriteAt, platform }

function shellFor(platform) {
  if (platform === 'win32') {
    return { file: `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, args: ['-NoLogo'] };
  }
  return { file: process.env.SHELL || '/bin/bash', args: ['-l'] };
}

function createTerminalEngine() {
  let ptyModule = null;
  try {
    ptyModule = require('node-pty');
  } catch (error) {
    return { available: false, reason: `node-pty unavailable: ${error.message}` };
  }

  function ringWrite(session, text) {
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length >= RING_BUFFER_BYTES) {
      session.ring = bytes.slice(bytes.length - RING_BUFFER_BYTES);
      session.ringLen = session.ring.length;
      return;
    }
    const next = Buffer.concat([session.ring, bytes]);
    session.ring = next.length > RING_BUFFER_BYTES ? next.slice(next.length - RING_BUFFER_BYTES) : next;
    session.ringLen = session.ring.length;
  }

  function broadcast(session, event, payload) {
    for (const send of session.subscribers) {
      try { send(event, payload); } catch { /* 单订阅者失败不影响其他 */ }
    }
  }

  function sweep() {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (!session.exited && now - session.lastWriteAt > IDLE_TTL_MS) {
        try { session.pty.kill(); } catch { /* already dead */ }
        session.exited = true;
      }
      if (session.exited && session.subscribers.size === 0 && now - session.lastWriteAt > IDLE_TTL_MS) {
        sessions.delete(id);
      }
    }
  }
  const sweeper = setInterval(sweep, 60_000);
  if (typeof sweeper.unref === 'function') sweeper.unref();

  return {
    available: true,

    /** 列出活跃会话（安全投影）。 */
    list() {
      return [...sessions.entries()].map(([id, s]) => ({
        sessionId: id,
        exited: s.exited,
        subscribers: s.subscribers.size,
        lastWriteAt: s.lastWriteAt,
      }));
    },

    /** 起新 pty 会话。返回 { sessionId } 或 { error }。 */
    start({ cwd } = {}) {
      const live = [...sessions.values()].filter((s) => !s.exited).length;
      if (live >= MAX_SESSIONS) {
        return { error: 'too_many_sessions', message: `终端会话已达上限（${MAX_SESSIONS}），请先关闭空闲会话` };
      }
      const shell = shellFor(process.platform);
      const id = `pter_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const session = {
        pty: null,
        ring: Buffer.alloc(0),
        ringLen: 0,
        subscribers: new Set(),
        exited: false,
        exitCode: null,
        lastWriteAt: Date.now(),
      };
      let ptyProc;
      try {
        ptyProc = ptyModule.spawn(shell.file, shell.args, {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: cwd && typeof cwd === 'string' && cwd.trim() ? cwd.trim() : os.homedir(),
          env: { ...process.env, TERM: 'xterm-256color' },
        });
      } catch (error) {
        return { error: 'pty_spawn_failed', message: error.message };
      }
      session.pty = ptyProc;
      ptyProc.onData((data) => {
        session.lastWriteAt = Date.now();
        ringWrite(session, data);
        broadcast(session, 'terminal:data', { data });
      });
      ptyProc.onExit(({ exitCode }) => {
        session.exited = true;
        session.exitCode = exitCode;
        session.lastWriteAt = Date.now();
        broadcast(session, 'terminal:exit', { exitCode });
      });
      sessions.set(id, session);
      return { sessionId: id };
    },

    /** 取会话（含环形缓冲文本，供重连重放）。 */
    getSession(id) {
      return sessions.get(id) || null;
    },

    ringText(session) {
      return session.ring.toString('utf8');
    },

    write(session, data) {
      if (session.exited) return { ok: false, error: 'session_exited' };
      session.pty.write(String(data));
      session.lastWriteAt = Date.now();
      return { ok: true };
    },

    resize(session, cols, rows) {
      if (session.exited) return { ok: false };
      const c = Math.min(Math.max(Number(cols) || 80, 2), 500);
      const r = Math.min(Math.max(Number(rows) || 24, 2), 200);
      try { session.pty.resize(c, r); return { ok: true }; } catch { return { ok: false }; }
    },

    kill(session) {
      if (session.exited) return { ok: true };
      try { session.pty.kill(); } catch { /* already dead */ }
      session.exited = true;
      return { ok: true };
    },

    subscribe(session, send) {
      session.subscribers.add(send);
      return () => session.subscribers.delete(send);
    },
  };
}

module.exports = { createTerminalEngine, shellFor };
