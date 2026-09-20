/**
 * BLOCK-57 — 执行目标注册表（设计评审 D6/D9）
 *
 * execution_targets 表是唯一注册事实；~/.ssh/config 只读解析结果作为
 * 「可发现候选」合并进列表（不自动注册）。探测 = agent probe（一次性 ssh）。
 * 本机永远是默认目标，不入表（execution_target_id 为 NULL 即本机）。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { parseSshConfig, isValidHostAlias } = require('./ssh-config-parser');
const { runSshOp } = require('./ssh-transport');
const { remoteAgentCommand } = require('./node-agent');

function newTargetId(alias) {
  return 'tgt_' + crypto.createHash('sha256').update(String(alias)).digest('hex').slice(0, 12);
}

// db = biof3-server 的 async facade（get/all/run 均返回 Promise）——一切访问必须 await。
// ensureAgent：可选注入（remote-job-runner.ensureAgent）——probe 是用户与节点的首次接触，
// 必须自带 agent 引导部署，否则新节点的首次探测必然失败（agent 尚不在节点上）。
function createTargetRegistry({ db, ensureAgent }) {
  async function listRegistered() {
    return db.prepare('SELECT * FROM execution_targets ORDER BY created_at').all();
  }

  /**
   * 列表 = 注册表 + ssh-config 发现候选（discovered:true，未注册）。
   */
  async function listWithDiscovery() {
    const registered = await listRegistered();
    const knownAliases = new Set(registered.map((row) => row.alias));
    let discovered = [];
    try {
      const configPath = path.join(os.homedir(), '.ssh', 'config');
      const parsed = parseSshConfig(fs.readFileSync(configPath, 'utf8'));
      discovered = parsed.hosts
        .filter((host) => isValidHostAlias(host.host) && !knownAliases.has(host.host))
        .map((host) => ({
          id: null,
          alias: host.host,
          hostName: host.hostName,
          user: host.user,
          port: host.port,
          discovered: true,
        }));
    } catch {
      // 无 ~/.ssh/config 或不可读：发现列表为空，注册表照常工作。
    }
    return { registered, discovered };
  }

  async function register({ alias, label, runtime }) {
    if (!isValidHostAlias(alias)) {
      return { ok: false, error: 'invalid_alias' };
    }
    const existing = await db.prepare('SELECT id FROM execution_targets WHERE alias=?').get(alias);
    if (existing) {
      return { ok: false, error: 'alias_already_registered', id: existing.id };
    }
    let runtimeJson = null;
    if (runtime && typeof runtime === 'object' && !Array.isArray(runtime)) {
      for (const binPath of Object.values(runtime)) {
        if (typeof binPath !== 'string' || /\s/.test(binPath)) {
          return { ok: false, error: 'invalid_runtime_override' };
        }
      }
      runtimeJson = JSON.stringify(runtime);
    }
    const id = newTargetId(alias);
    db.prepare(
      'INSERT INTO execution_targets (id, alias, label, created_at, status, runtime_json) VALUES (?,?,?,?,?,?)'
    ).run(id, alias, String(label || ''), Date.now(), 'unprobed', runtimeJson);
    return { ok: true, id, alias };
  }

  async function remove({ id }) {
    const result = await db.prepare('DELETE FROM execution_targets WHERE id=?').run(String(id || ''));
    return { ok: result.changes > 0 };
  }

  async function getById({ id }) {
    return db.prepare('SELECT * FROM execution_targets WHERE id=?').get(String(id || ''));
  }

  async function getByAlias({ alias }) {
    return db.prepare('SELECT * FROM execution_targets WHERE alias=?').get(String(alias || ''));
  }

  /**
   * 探测：agent probe（os / hostname / 调度器，通用面）。领域运行时探测（r/python）
   * 已随 BLOCK-96 F6 退役——运行时在位改由领域包 requires.runtimes 契约推导（BLOCK-86）。
   * 结果持久化 last_probe_json。传输失败如实返回分类结果，不猜测节点能力。
   */
  async function probe({ id }) {
    const target = await getById({ id });
    if (!target) return { ok: false, error: 'target_not_found' };
    if (typeof ensureAgent === 'function') {
      const deployed = await ensureAgent({ alias: target.alias });
      if (!deployed.ok) {
        await db.prepare("UPDATE execution_targets SET status='unreachable', last_probe_at=? WHERE id=?")
          .run(Date.now(), target.id);
        return { ok: false, error: deployed.error.kind, detail: deployed.error.detail };
      }
    }
    const startedAt = Date.now();
    const op = await runSshOp({ alias: target.alias, remoteCommand: remoteAgentCommand(['probe']), timeoutMs: 20000 });
    const handshakeMs = Date.now() - startedAt;
    if (op.classified.kind !== 'ok') {
      await db.prepare("UPDATE execution_targets SET status='unreachable', last_probe_at=? WHERE id=?")
        .run(Date.now(), target.id);
      return { ok: false, error: op.classified.kind, detail: op.classified.detail };
    }
    const info = {};
    for (const line of op.stdout.split('\n')) {
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      info[line.slice(0, eq)] = line.slice(eq + 1);
    }
    // BLOCK-96 F1 — 首连握手计时：>2s 提示疑似地址族黑洞（IPv6 ::1 先挂满超时
    // 才回落 IPv4 的典型症状，ConnectTimeout 封不住）。落 last_probe_json 供管理页提示。
    if (handshakeMs > 2000) info.handshakeMs = handshakeMs;
    await db.prepare('UPDATE execution_targets SET status=?, last_probe_json=?, last_probe_at=? WHERE id=?')
      .run('ready', JSON.stringify(info), Date.now(), target.id);
    return { ok: true, targetId: target.id, alias: target.alias, info, handshakeMs };
  }

  return {
    listRegistered,
    listWithDiscovery,
    register,
    remove,
    getById,
    getByAlias,
    probe,
  };
}

module.exports = { createTargetRegistry, newTargetId };
