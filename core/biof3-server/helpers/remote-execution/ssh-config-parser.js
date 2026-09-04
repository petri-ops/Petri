/**
 * BLOCK-57 — ~/.ssh/config 只读解析器（最小实现，0 依赖）
 *
 * 设计评审 D6/D9：「你的 SSH 配置就是你的集群列表」。只提取发现目标清单
 * 所需字段（Host/HostName/User/Port）；IdentityFile/ProxyJump 等一律不解析、
 * 不落库——连接时交给系统 ssh 按用户配置自行执行，BioF3 永不碰私钥。
 */

/**
 * @param {string} text - ssh config 文件内容
 * @returns {{hosts: Array<{host: string, hostName: string|null, user: string|null, port: string|null}>, warnings: string[]}}
 */
function parseSshConfig(text) {
  const hosts = [];
  const warnings = [];
  if (!text || typeof text !== 'string') return { hosts, warnings };

  let current = null;
  const flush = () => {
    if (current) hosts.push(current);
    current = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s*#.*$/, '').trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    let key, value;
    if (eq > 0 && !/\s/.test(line.slice(0, eq))) {
      key = line.slice(0, eq).toLowerCase();
      value = line.slice(eq + 1).trim();
    } else {
      const m = line.match(/^(\S+)\s+(.*)$/);
      if (!m) continue;
      key = m[1].toLowerCase();
      value = m[2].trim();
    }
    if (key === 'host') {
      flush();
      const patterns = value.split(/\s+/).filter(Boolean);
      // 通配 pattern（* / ?）不作为可注册目标——只收字面 Host 别名。
      const literal = patterns.filter((p) => !/[*?]/.test(p));
      if (literal.length === 1) {
        current = { host: literal[0], hostName: null, user: null, port: null };
      } else if (literal.length > 1) {
        warnings.push(`Host 块含多个别名，跳过: ${value}`);
      } else if (patterns.length > 0) {
        current = null; // 纯通配块（如 Host *）仅作默认段，不产生目标
      }
    } else if (current) {
      if (key === 'hostname') current.hostName = value;
      else if (key === 'user') current.user = value;
      else if (key === 'port') current.port = value;
    }
  }
  flush();
  return { hosts, warnings };
}

/** 判断 Host 别名是否可安全用于命令面（与 agent verbs 参数共用同一约束）。 */
const HOST_ALIAS_RE = /^[A-Za-z0-9._-]{1,128}$/;

function isValidHostAlias(alias) {
  return typeof alias === 'string' && HOST_ALIAS_RE.test(alias);
}

module.exports = { parseSshConfig, isValidHostAlias };
