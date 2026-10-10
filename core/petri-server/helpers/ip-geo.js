/**
 * IP → 地区（admin 访客统计用）
 * 使用 ip-api.com 免费接口，带内存缓存；内网/本地 IP 不请求外网。
 */

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;
const FIELDS = 'status,message,country,regionName,city,isp,query';

/** @type {Map<string, { at: number, geo: object }>} */
const cache = new Map();

function isPrivateOrLocal(ip) {
  if (!ip || typeof ip !== 'string') return true;
  const s = ip.trim();
  if (s === '127.0.0.1' || s === '::1' || s.startsWith('fe80:')) return true;
  if (/^10\./.test(s)) return true;
  if (/^192\.168\./.test(s)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(s)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(s)) return true; // CGNAT
  return false;
}

function formatLocation(geo) {
  if (!geo) return '-';
  if (geo.location) return geo.location;
  const parts = [geo.city, geo.region, geo.country].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  if (geo.isp) return geo.isp;
  return '-';
}

function rowFromApi(item) {
  if (!item || item.status !== 'success') {
    return {
      country: null,
      region: null,
      city: null,
      isp: null,
      location: item?.message === 'private range' ? '内网' : '未知',
    };
  }
  const geo = {
    country: item.country || null,
    region: item.regionName || null,
    city: item.city || null,
    isp: item.isp || null,
    location: null,
  };
  geo.location = formatLocation(geo);
  return geo;
}

function getCached(ip) {
  const hit = cache.get(ip);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(ip);
    return null;
  }
  return hit.geo;
}

function setCache(ip, geo) {
  cache.set(ip, { at: Date.now(), geo });
}

async function fetchBatch(ips) {
  if (!ips.length) return {};
  const url = `http://ip-api.com/batch?fields=${FIELDS}`;
  const body = ips.map((ip) => ({ query: ip }));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`ip-api HTTP ${res.status}`);
  const data = await res.json();
  const out = {};
  if (!Array.isArray(data)) return out;
  for (let i = 0; i < ips.length; i++) {
    out[ips[i]] = rowFromApi(data[i]);
    setCache(ips[i], out[ips[i]]);
  }
  return out;
}

/**
 * @param {string[]} ips
 * @returns {Promise<Record<string, object>>}
 */
async function lookupIps(ips) {
  const unique = [...new Set(ips.filter((ip) => ip && !isPrivateOrLocal(ip)))];
  const result = {};

  for (const ip of ips) {
    if (!ip) continue;
    if (isPrivateOrLocal(ip)) {
      const geo = { country: null, region: null, city: null, isp: null, location: '内网' };
      result[ip] = geo;
      setCache(ip, geo);
    }
  }

  const needLookup = unique.filter((ip) => {
    const c = getCached(ip);
    if (c) {
      result[ip] = c;
      return false;
    }
    return true;
  });

  for (let i = 0; i < needLookup.length; i += BATCH_SIZE) {
    const chunk = needLookup.slice(i, i + BATCH_SIZE);
    try {
      const batch = await fetchBatch(chunk);
      Object.assign(result, batch);
    } catch (e) {
      console.warn('[ip-geo] batch lookup failed:', e.message);
      for (const ip of chunk) {
        result[ip] = { country: null, region: null, city: null, isp: null, location: '解析失败' };
      }
    }
    if (i + BATCH_SIZE < needLookup.length) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return result;
}

/**
 * @template T
 * @param {T[]} rows
 * @param {string} ipKey
 * @returns {Promise<(T & { geo: object, location: string })[]>}
 */
async function attachGeoToRows(rows, ipKey = 'ip') {
  const ips = rows.map((r) => r[ipKey]).filter(Boolean);
  const map = await lookupIps(ips);
  return rows.map((r) => {
    const ip = r[ipKey];
    const geo = map[ip] || { location: '-' };
    return {
      ...r,
      geo,
      location: geo.location || formatLocation(geo),
    };
  });
}

module.exports = {
  lookupIps,
  attachGeoToRows,
  formatLocation,
  isPrivateOrLocal,
};