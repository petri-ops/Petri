// ============================================================
// Site-level Admin Dashboard — /admin
//
// Unified admin page combining:
//   - Operational analytics (realtime, trends, retention, content, funnel)
//   - Governance tools (cache, OSS, backup, errors, users, AI gov, AI usage)
//
// Visible only to users with role === 'admin'.
// ============================================================

import { errMsg } from '@/lib/error';
import React, { useEffect, useState, useCallback } from 'react';
import { getStoredUser, getToken, getApiPrefix, subscribeAuth } from '@/lib/authClient';
import { AdminPanel, fetchWithAuth } from '@/pages/single-cell/_AdminPanel';
import styles from './admin.module.css';

type OpTab = 'realtime' | 'trends' | 'retention' | 'content' | 'funnel' | 'visitors';
type GovTab =
  | 'local'
  | 'compute'
  | 'assets'
  | 'oss'
  | 'backup'
  | 'errors'
  | 'users'
  | 'ai'
  | 'usage';
type Tab = OpTab | GovTab | 'feedbacks';

interface RealtimeStats {
  online: number;
  dau: number;
  totalUsers: number;
  newToday: number;
  aiActiveStreams: number;
  onlineList: Array<{ user_id: string; username: string; last_seen: number; page: string }>;
  timestamp: number;
}

// ── Analytics API response types (from r-server/routes/analytics.js) ──
interface TrendRow {
  date: string;
  dau: number;
  page_views: number;
  new_users: number;
  ai_messages: number;
}
interface VisitorTrendRow {
  date: string;
  page_views: number;
  page_sessions: number;
  unique_ips: number;
}
interface TopIpRow {
  ip: string;
  visits: number;
  distinct_pages: number;
  distinct_sessions: number;
  distinct_users: number;
  first_seen: number;
  last_seen: number;
  location?: string;
  geo?: { isp?: string; location?: string };
}
interface RecentVisitor {
  id: number;
  ts: number;
  ip: string;
  user_id: string | null;
  session_id: string | null;
  path: string;
  title: string | null;
  referrer: string | null;
  username?: string;
  location?: string;
  geo?: { isp?: string; location?: string };
}
interface CohortRow {
  date: string;
  cohortSize: number;
  day1Retained: number;
  day1Rate: number;
  day7Retained: number;
  day7Rate: number;
}
interface ContentRow {
  path: string;
  title: string | null;
  views: number;
  unique_users: number;
}
interface FunnelStep {
  step: string;
  count: number;
  rate: number;
}
interface FeedbackItem {
  id: string;
  category: string;
  content: string;
  page_url: string;
  status: string;
  created_at: string;
  image_urls: string | null;
  ip: string | null;
  user_agent: string | null;
  username: string | null;
  location?: string;
  geo?: { isp?: string; location?: string };
  ai_summary?: string;
  ai_severity?: string;
  ai_module?: string;
  ai_reproducible?: boolean;
  admin_notes?: string;
}

function _authHeaders() {
  const t = getToken();
  return t ? { Authorization: 'Bearer ' + t } : {};
}

function api(path: string): string {
  return getApiPrefix() + path;
}

// ---------- Global Admin Data Cache for SWR Pattern ----------
const adminDataCache: {
  realtime?: RealtimeStats;
  trends?: { days: number; trend: TrendRow[]; visitorTrend: VisitorTrendRow[] };
  retention?: CohortRow[];
  content?: { days: number; content: ContentRow[] };
  funnel?: FunnelStep[];
  visitors?: {
    days: number;
    topIps: TopIpRow[];
    recent?: RecentVisitor[];
    showRecent?: boolean;
    recentLimit?: number;
  };
  feedbacks?: { filter: string; items: FeedbackItem[]; counts: Record<string, number> };
} = {};

// ---------- Realtime tab ----------
function RealtimeTab() {
  const [stats, setStats] = useState<RealtimeStats | null>(adminDataCache.realtime || null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(!adminDataCache.realtime);

  const load = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const r = await fetchWithAuth(api('/admin/realtime-stats'), undefined, 15_000);
      const j = await r.json();
      if (j.ok) {
        setStats(j);
        adminDataCache.realtime = j;
        setErr(null);
      } else {
        setErr(j.error || '加载失败');
      }
    } catch (e: unknown) {
      setErr(e.message || '网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(!!adminDataCache.realtime);
    const t = setInterval(() => load(true), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (err && !stats) return <div className={styles.error}>错误: {err}</div>;
  if (loading && !stats) return <div className={styles.loading}>加载中...</div>;
  if (!stats) return <div className={styles.loading}>加载中...</div>;

  return (
    <div>
      <div className={styles.statGrid}>
        <StatCard label="当前在线" value={stats.online} hint="5 分钟内有心跳" emphasis />
        <StatCard label="AI 对话中" value={stats.aiActiveStreams} hint="正在 streaming 的请求" />
        <StatCard label="今日活跃" value={stats.dau} hint="DAU（含访问 + 对话）" />
        <StatCard label="总注册" value={stats.totalUsers} hint="所有时间累计" />
        <StatCard label="今日新增" value={stats.newToday} hint="今天注册的用户" />
      </div>

      <div className={styles.section}>
        <h3>当前在线用户（最近 5 分钟）</h3>
        {stats.onlineList.length === 0 ? (
          <p className={styles.muted}>暂无在线用户</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>用户</th>
                <th>最后活动</th>
                <th>页面</th>
              </tr>
            </thead>
            <tbody>
              {stats.onlineList.map((u) => (
                <tr key={u.user_id}>
                  <td>{u.username || u.user_id}</td>
                  <td>{Math.round((Date.now() - u.last_seen) / 1000)}s ago</td>
                  <td className={styles.path}>{u.page}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.refreshHint}>
        每 30 秒自动刷新 · 上次更新: {new Date(stats.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}

// ---------- Trends tab ----------
function TrendsTab() {
  const cached = adminDataCache.trends;
  const [days, setDays] = useState(cached?.days || 30);
  const [trend, setTrend] = useState<TrendRow[]>(cached?.days === days ? cached.trend : []);
  const [visitorTrend, setVisitorTrend] = useState<VisitorTrendRow[]>(
    cached?.days === days ? cached.visitorTrend : []
  );
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cached || cached.days !== days);

  const reload = useCallback(
    async (isSilent = false) => {
      if (!isSilent) setLoading(true);
      setLoadErr(null);
      try {
        const [r1, r2] = await Promise.all([
          fetchWithAuth(api('/admin/dau-trend?days=' + days)).then((r) => r.json()),
          fetchWithAuth(api('/admin/visitor-trend?days=' + days)).then((r) => r.json()),
        ]);
        if (r1.ok && r2.ok) {
          setTrend(r1.trend);
          setVisitorTrend(r2.trend);
          adminDataCache.trends = { days, trend: r1.trend, visitorTrend: r2.trend };
        } else {
          setLoadErr(r1.error || r2.error || '加载失败');
        }
      } catch (e: unknown) {
        setLoadErr(errMsg(e) || '网络错误');
      } finally {
        setLoading(false);
      }
    },
    [days]
  );

  useEffect(() => {
    const isSilent = adminDataCache.trends && adminDataCache.trends.days === days;
    reload(isSilent);
  }, [reload, days]);

  const maxDau = Math.max(1, ...trend.map((r) => r.dau));
  const maxPv = Math.max(1, ...trend.map((r) => r.page_views));
  const maxIp = Math.max(1, ...visitorTrend.map((r) => r.unique_ips));

  return (
    <div>
      <div className={styles.controls}>
        <label>时间范围: </label>
        <select value={days} onChange={(e) => setDays(parseInt(e.target.value))}>
          <option value={7}>最近 7 天</option>
          <option value={30}>最近 30 天</option>
          <option value={90}>最近 90 天</option>
        </select>
        <button
          className={styles.btn}
          onClick={async () => {
            await fetchWithAuth(api('/admin/aggregate-daily'), { method: 'POST', body: '{}' });
            reload();
          }}
        >
          立即聚合昨日
        </button>
      </div>
      {loadErr && <div className={styles.error}>趋势：{loadErr}</div>}

      {loading && trend.length === 0 ? (
        <div className={styles.loading}>加载中...</div>
      ) : trend.length === 0 ? (
        <p className={styles.muted}>
          暂无聚合数据。系统每日 01:00 自动聚合昨日数据，也可点上方按钮立即触发。
        </p>
      ) : (
        <>
          <div className={styles.section}>
            <h3>DAU（日活跃用户）</h3>
            <ChartBar
              data={trend.map((r) => ({ label: r.date.slice(5), value: r.dau }))}
              max={maxDau}
              color="#10b981"
            />
          </div>
          <div className={styles.section}>
            <h3>独立 IP（接近"实际访问人数"）</h3>
            {visitorTrend.length === 0 ? (
              <p className={styles.muted}>等待新数据（IP 列于 2026-05-28 启用）</p>
            ) : (
              <ChartBar
                data={visitorTrend.map((r) => ({ label: r.date.slice(5), value: r.unique_ips }))}
                max={maxIp}
                color="#06b6d4"
              />
            )}
          </div>
          <div className={styles.section}>
            <h3>页面访问量</h3>
            <ChartBar
              data={trend.map((r) => ({ label: r.date.slice(5), value: r.page_views }))}
              max={maxPv}
              color="#3b82f6"
            />
          </div>
          <div className={styles.section}>
            <h3>新用户注册</h3>
            <ChartBar
              data={trend.map((r) => ({ label: r.date.slice(5), value: r.new_users }))}
              max={Math.max(1, ...trend.map((r) => r.new_users))}
              color="#f59e0b"
            />
          </div>
          <div className={styles.section}>
            <h3>AI 消息数</h3>
            <ChartBar
              data={trend.map((r) => ({ label: r.date.slice(5), value: r.ai_messages }))}
              max={Math.max(1, ...trend.map((r) => r.ai_messages))}
              color="#8b5cf6"
            />
          </div>
        </>
      )}
    </div>
  );
}

function RetentionTab() {
  const [cohorts, setCohorts] = useState<CohortRow[]>(adminDataCache.retention || []);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(!adminDataCache.retention);

  const load = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setLoadErr(null);
    try {
      const r = await fetchWithAuth(api('/admin/retention?days=30'));
      const j = await r.json();
      if (j.ok) {
        setCohorts(j.cohorts);
        adminDataCache.retention = j.cohorts;
      } else {
        setLoadErr(j.error || '加载失败');
      }
    } catch (e: unknown) {
      setLoadErr(errMsg(e) || '网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(!!adminDataCache.retention);
  }, [load]);

  return (
    <div>
      <div className={styles.section}>
        <h3>留存表（按注册日期 cohort）</h3>
        {loadErr && <div className={styles.error}>{loadErr}</div>}
        {cohorts.length === 0 ? (
          <p className={styles.muted}>暂无 cohort 数据（需要至少 1 天前有用户注册）</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>注册日期</th>
                <th>cohort 大小</th>
                <th>次日留存</th>
                <th>7 日留存</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => (
                <tr key={c.date}>
                  <td>{c.date}</td>
                  <td>{c.cohortSize}</td>
                  <td>
                    {c.day1Retained} / {c.cohortSize}
                    <span className={styles.rate}> ({(c.day1Rate * 100).toFixed(0)}%)</span>
                  </td>
                  <td>
                    {c.day7Retained} / {c.cohortSize}
                    <span className={styles.rate}> ({(c.day7Rate * 100).toFixed(0)}%)</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ContentTab() {
  const cached = adminDataCache.content;
  const [days, setDays] = useState(cached?.days || 7);
  const [content, setContent] = useState<ContentRow[]>(cached?.days === days ? cached.content : []);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cached || cached.days !== days);

  const load = useCallback(
    async (isSilent = false) => {
      if (!isSilent) setLoading(true);
      setLoadErr(null);
      try {
        const r = await fetchWithAuth(api('/admin/content-popular?days=' + days));
        const j = await r.json();
        if (j.ok) {
          setContent(j.content);
          adminDataCache.content = { days, content: j.content };
        } else {
          setLoadErr(j.error || '加载失败');
        }
      } catch (e: unknown) {
        setLoadErr(errMsg(e) || '网络错误');
      } finally {
        setLoading(false);
      }
    },
    [days]
  );

  useEffect(() => {
    const isSilent = adminDataCache.content && adminDataCache.content.days === days;
    load(isSilent);
  }, [load, days]);

  return (
    <div>
      <div className={styles.controls}>
        <label>时间范围: </label>
        <select value={days} onChange={(e) => setDays(parseInt(e.target.value))}>
          <option value={1}>今天</option>
          <option value={7}>最近 7 天</option>
          <option value={30}>最近 30 天</option>
        </select>
      </div>

      <div className={styles.section}>
        <h3>热门页面</h3>
        {loadErr && <div className={styles.error}>{loadErr}</div>}
        {loading && content.length === 0 ? (
          <p className={styles.muted}>加载中...</p>
        ) : content.length === 0 ? (
          <p className={styles.muted}>暂无访问数据</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>页面</th>
                <th>访问</th>
                <th>独立访客</th>
              </tr>
            </thead>
            <tbody>
              {content.map((c, i) => (
                <tr key={c.path}>
                  <td>{i + 1}</td>
                  <td>
                    <a href={c.path} target="_blank" rel="noopener">
                      {c.title || c.path}
                    </a>
                    <div className={styles.pathSmall}>{c.path}</div>
                  </td>
                  <td>{c.views}</td>
                  <td>{c.unique_users || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FunnelTab() {
  const [funnel, setFunnel] = useState<FunnelStep[]>(adminDataCache.funnel || []);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(!adminDataCache.funnel);

  const load = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setLoadErr(null);
    try {
      const r = await fetchWithAuth(api('/admin/funnel'));
      const j = await r.json();
      if (j.ok) {
        setFunnel(j.funnel);
        adminDataCache.funnel = j.funnel;
      } else {
        setLoadErr(j.error || '加载失败');
      }
    } catch (e: unknown) {
      setLoadErr(errMsg(e) || '网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(!!adminDataCache.funnel);
  }, [load]);

  if (loadErr && funnel.length === 0)
    return <div className={styles.error}>加载失败：{loadErr}</div>;
  if (loading && funnel.length === 0) return <div className={styles.loading}>加载中...</div>;
  if (funnel.length === 0) return <div className={styles.loading}>加载中...</div>;
  const max = funnel[0]?.count || 1;

  return (
    <div className={styles.section}>
      <h3>用户行为漏斗</h3>
      <div className={styles.funnel}>
        {funnel.map((f) => (
          <div key={f.step} className={styles.funnelRow}>
            <div className={styles.funnelLabel}>{f.step}</div>
            <div className={styles.funnelBar}>
              <div className={styles.funnelFill} style={{ width: (f.count / max) * 100 + '%' }}>
                <span className={styles.funnelValue}>{f.count}</span>
              </div>
            </div>
            <div className={styles.funnelRate}>{(f.rate * 100).toFixed(1)}%</div>
          </div>
        ))}
      </div>
      <p className={styles.muted}>说明：每一步显示从注册用户中达到该行为的人数和比例。</p>
    </div>
  );
}

function referrerHost(referrer: string | null | undefined): string {
  if (!referrer || !referrer.trim()) return '-';
  try {
    const u = referrer.startsWith('http')
      ? referrer
      : `https://placeholder${referrer.startsWith('/') ? '' : '/'}${referrer}`;
    return new URL(u).hostname || '-';
  } catch (e) {
    return referrer.length > 40 ? referrer.slice(0, 40) + '…' : referrer;
  }
}

// ---------- Visitors (IP 详情) ----------
function VisitorsTab() {
  const cached = adminDataCache.visitors;
  const [days, setDays] = useState(cached?.days || 7);
  const [topIps, setTopIps] = useState<TopIpRow[]>(cached?.days === days ? cached.topIps : []);
  const [recent, setRecent] = useState<RecentVisitor[]>(cached?.recent || []);
  const [showRecent, setShowRecent] = useState(cached?.showRecent || false);
  const [recentLimit, setRecentLimit] = useState(cached?.recentLimit || 50);
  const [loading, setLoading] = useState(!cached || cached.days !== days);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const reload = useCallback(
    async (isSilent = false) => {
      if (!isSilent) setLoading(true);
      setLoadErr(null);
      try {
        const r = await fetchWithAuth(api('/admin/top-ips?days=' + days + '&limit=50'));
        const j = await r.json();
        if (j.ok) {
          const ips = Array.isArray(j.ips) ? j.ips : [];
          setTopIps(ips);
          adminDataCache.visitors = {
            days,
            topIps: ips,
            recent,
            showRecent,
            recentLimit,
          };
        } else {
          setLoadErr(j.error || '加载失败');
        }
      } catch (e: unknown) {
        setLoadErr(errMsg(e) || '网络错误');
      } finally {
        setLoading(false);
      }
    },
    [days, recent, showRecent, recentLimit]
  );

  useEffect(() => {
    const isSilent = adminDataCache.visitors && adminDataCache.visitors.days === days;
    reload(isSilent);
  }, [reload, days]);

  useEffect(() => {
    if (!showRecent) return;
    fetchWithAuth(api('/admin/recent-visitors?limit=' + recentLimit))
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          const vis = j.visitors || [];
          setRecent(vis);
          if (adminDataCache.visitors) {
            adminDataCache.visitors.recent = vis;
          }
        }
      })
      .catch(() => {});
  }, [showRecent, recentLimit]);

  useEffect(() => {
    if (adminDataCache.visitors) {
      adminDataCache.visitors.showRecent = showRecent;
      adminDataCache.visitors.recentLimit = recentLimit;
    }
  }, [showRecent, recentLimit]);

  const totalVisits = topIps.reduce((s, r) => s + Number(r.visits) || 0, 0);
  const totalUniqueIps = topIps.length;
  const fmtTime = (ms: number | string) => {
    const n = Number(ms);
    if (!n) return '-';
    const d = new Date(n);
    const now = Date.now();
    const diff = now - n;
    if (diff < 60_000) return Math.round(diff / 1000) + 's ago';
    if (diff < 3600_000) return Math.round(diff / 60_000) + 'm ago';
    if (diff < 86400_000) return Math.round(diff / 3600_000) + 'h ago';
    return d.toISOString().slice(5, 16).replace('T', ' ');
  };

  return (
    <div>
      <div className={styles.controls}>
        <label>时间范围: </label>
        <select value={days} onChange={(e) => setDays(parseInt(e.target.value))}>
          <option value={1}>今天</option>
          <option value={7}>最近 7 天</option>
          <option value={30}>最近 30 天</option>
          <option value={90}>最近 90 天</option>
        </select>
        <button className={styles.btn} onClick={() => reload(false)}>
          刷新
        </button>
      </div>

      {loadErr && <div className={styles.error}>访客 IP：{loadErr}</div>}

      <div className={styles.statGrid}>
        <StatCard
          label="独立 IP 数"
          value={totalUniqueIps}
          hint={`最近 ${days} 天 · 接近实际访问人数`}
          emphasis
        />
        <StatCard label="总访问次数" value={totalVisits} hint="所有展示 IP 的访问总和" />
      </div>

      <div className={styles.section}>
        <h3>IP 排行（按访问次数）</h3>
        {loading && topIps.length === 0 ? (
          <p className={styles.muted}>加载中...</p>
        ) : topIps.length === 0 ? (
          <p className={styles.muted}>
            该时段无访客记录（IP 列于 2026-05-28 启用，老数据 IP=null）
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>IP</th>
                <th>地区</th>
                <th>访问次数</th>
                <th>独立页</th>
                <th>会话</th>
                <th>登录用户</th>
                <th>首次访问</th>
                <th>最近访问</th>
              </tr>
            </thead>
            <tbody>
              {topIps.map((r, i) => (
                <tr key={r.ip}>
                  <td>{i + 1}</td>
                  <td className={styles.path}>
                    <code>{r.ip}</code>
                  </td>
                  <td title={r.geo?.isp ? `ISP: ${r.geo.isp}` : undefined}>
                    {r.location || r.geo?.location || <span className={styles.muted}>-</span>}
                  </td>
                  <td>{r.visits}</td>
                  <td>{r.distinct_pages}</td>
                  <td>{r.distinct_sessions}</td>
                  <td>
                    {Number(r.distinct_users) > 0 ? (
                      r.distinct_users
                    ) : (
                      <span className={styles.muted}>匿名</span>
                    )}
                  </td>
                  <td className={styles.muted}>{fmtTime(r.first_seen)}</td>
                  <td>{fmtTime(r.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.section}>
        <h3>
          最近访客流水{' '}
          <button
            className={styles.btn}
            style={{ marginLeft: 8 }}
            onClick={() => setShowRecent((s) => !s)}
          >
            {showRecent ? '收起' : '展开'}
          </button>
        </h3>
        {showRecent && (
          <>
            <div className={styles.controls}>
              <label>显示条数: </label>
              <select
                value={recentLimit}
                onChange={(e) => setRecentLimit(parseInt(e.target.value))}
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
              </select>
            </div>
            {recent.length === 0 ? (
              <p className={styles.muted}>暂无数据</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>IP</th>
                    <th>地区</th>
                    <th>用户</th>
                    <th>页面</th>
                    <th>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((v) => (
                    <tr key={v.id}>
                      <td>{fmtTime(v.ts)}</td>
                      <td className={styles.path}>
                        <code>{v.ip}</code>
                      </td>
                      <td title={v.geo?.isp ? `ISP: ${v.geo.isp}` : undefined}>
                        {v.location || v.geo?.location || <span className={styles.muted}>-</span>}
                      </td>
                      <td>{v.username || <span className={styles.muted}>匿名</span>}</td>
                      <td className={styles.path}>{v.path}</td>
                      <td className={styles.muted}>{referrerHost(v.referrer)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      <p className={styles.muted}>
        ⚠️ IP 是 PII 类数据，仅 admin 可见。系统按 90 天滚动清理 page_views。
        <br />
        同 NAT 多人（实验室/校园网）会算 1 IP；同人切网络会算多 IP。已注册用户优先按 user_id 去重。
        <br />
        地区列由服务端按 IP 解析（缓存 7 天），格式一般为「城市 · 省/州 · 国家」；悬停可看
        ISP。内网地址显示「内网」。
      </p>
    </div>
  );
}

// ---------- Helpers ----------
function StatCard({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: number;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`${styles.stat} ${emphasis ? styles.statEmphasis : ''}`}>
      <div className={styles.statValue}>{value.toLocaleString()}</div>
      <div className={styles.statLabel}>{label}</div>
      {hint && <div className={styles.statHint}>{hint}</div>}
    </div>
  );
}

function ChartBar({
  data,
  max,
  color,
}: {
  data: Array<{ label: string; value: number }>;
  max: number;
  color: string;
}) {
  return (
    <div className={styles.chart}>
      {data.map((d, i) => (
        <div key={i} className={styles.chartCol}>
          <div className={styles.chartBarWrap}>
            <div
              className={styles.chartBar}
              style={{ height: (d.value / max) * 100 + '%', background: color }}
              title={`${d.label}: ${d.value}`}
            />
          </div>
          <div className={styles.chartLabel}>{d.label}</div>
          <div className={styles.chartValue}>{d.value}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- Feedbacks tab (FEEDBACK_TRIAGE_v1) ----------
interface FeedbackRow {
  id: number;
  user_id: string | null;
  username: string | null;
  category: string;
  content: string;
  page_url: string | null;
  user_agent: string | null;
  ip: string | null;
  status: string;
  admin_notes: string | null;
  created_at: number;
  resolved_at: number | null;
  image_urls: string | null;
  ai_severity: string | null;
  ai_module: string | null;
  ai_reproducible: string | null;
  ai_summary: string | null;
  location?: string | null;
  geo?: {
    city?: string | null;
    region?: string | null;
    country?: string | null;
    isp?: string | null;
    location?: string | null;
  } | null;
}

const CAT_LABEL: Record<string, string> = {
  bug: '🐛 Bug',
  suggestion: '💡 建议',
  content: '📝 内容',
  other: '💬 其他',
};
const STATUS_LABEL: Record<string, string> = {
  new: '🆕 新',
  in_progress: '🔧 处理中',
  resolved: '✅ 已解决',
  dismissed: '🚫 已忽略',
};
const SEV_COLOR: Record<string, string> = {
  P0: '#dc2626',
  P1: '#ea580c',
  P2: '#ca8a04',
  unknown: '#94a3b8',
};

function fmtFeedbackTime(v: number | string | null | undefined): string {
  const n = Number(v);
  if (!n || Number.isNaN(n)) return '未知时间';
  return new Date(n).toLocaleString('zh-CN');
}

function FeedbacksTab() {
  const cached = adminDataCache.feedbacks;
  const [filter, setFilter] = useState<string>(cached?.filter || '');
  const [items, setItems] = useState<FeedbackRow[] | null>(
    cached?.filter === filter ? cached.items : null
  );
  const [counts, setCounts] = useState<Record<string, number>>(
    cached?.filter === filter ? cached.counts : {}
  );
  const [busy, setBusy] = useState(!cached || cached.filter !== filter);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(
    async (isSilent = false) => {
      if (!isSilent) setBusy(true);
      try {
        const url = api('/feedback/admin' + (filter ? `?status=${filter}` : ''));
        const r = await fetchWithAuth(url);
        const j = await r.json();
        if (j.status === 'ok') {
          setItems(j.items);
          setCounts(j.counts || {});
          adminDataCache.feedbacks = { filter, items: j.items, counts: j.counts || {} };
        } else {
          console.warn('[feedbacks] load failed:', j.error);
        }
      } catch (e) {
        console.warn('[feedbacks] network error:', e.message);
      } finally {
        setBusy(false);
      }
    },
    [filter]
  );

  useEffect(() => {
    const isSilent = adminDataCache.feedbacks && adminDataCache.feedbacks.filter === filter;
    load(isSilent);
  }, [load, filter]);

  const setStatus = useCallback(
    async (id: number, status: string) => {
      try {
        await fetchWithAuth(api(`/feedback/admin/${id}`), {
          method: 'PUT',
          body: JSON.stringify({ status }),
        });
        load(true);
      } catch (e) {
        alert(e.message);
      }
    },
    [load]
  );

  const saveNotes = useCallback(
    async (id: number, adminNotes: string) => {
      try {
        await fetchWithAuth(api(`/feedback/admin/${id}`), {
          method: 'PUT',
          body: JSON.stringify({ adminNotes }),
        });
        load(true);
      } catch (e) {
        alert(e.message);
      }
    },
    [load]
  );

  const FILTERS = [
    { v: '', label: '全部' },
    { v: 'new', label: `新 (${counts.new || 0})` },
    { v: 'in_progress', label: `处理中 (${counts.in_progress || 0})` },
    { v: 'resolved', label: `已解决 (${counts.resolved || 0})` },
    { v: 'dismissed', label: `已忽略 (${counts.dismissed || 0})` },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          marginBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        {FILTERS.map((f) => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            style={{
              fontSize: 12,
              padding: '5px 12px',
              borderRadius: 16,
              cursor: 'pointer',
              fontWeight: 600,
              border:
                '1px solid ' +
                (filter === f.v ? 'var(--ifm-color-primary)' : 'var(--ifm-color-emphasis-300)'),
              background: filter === f.v ? 'var(--ifm-color-primary)' : 'transparent',
              color: filter === f.v ? '#fff' : 'var(--ifm-color-emphasis-700)',
            }}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={() => load(false)}
          disabled={busy}
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            padding: '5px 12px',
            borderRadius: 6,
            cursor: 'pointer',
            border: '1px solid var(--ifm-color-emphasis-300)',
            background: 'transparent',
          }}
        >
          {busy ? '加载中…' : '刷新'}
        </button>
      </div>

      {busy && items === null ? (
        <div className={styles.loading}>加载中...</div>
      ) : items === null ? (
        <div className={styles.loading}>加载中...</div>
      ) : items.length === 0 ? (
        <p className={styles.muted}>暂无反馈</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((f) => {
            const imgs: string[] = (() => {
              try {
                return f.image_urls ? JSON.parse(f.image_urls) : [];
              } catch {
                return [];
              }
            })();
            const isOpen = expanded === f.id;
            return (
              <div
                key={f.id}
                style={{
                  border: '1px solid var(--ifm-color-emphasis-200)',
                  borderRadius: 10,
                  padding: '12px 14px',
                  background: 'var(--ifm-card-background-color, #fff)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: 'var(--ifm-color-emphasis-500)' }}>
                    #{f.id}
                  </span>
                  <span>{CAT_LABEL[f.category] || f.category}</span>
                  {f.ai_severity && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '1px 8px',
                        borderRadius: 10,
                        color: '#fff',
                        background: SEV_COLOR[f.ai_severity] || '#94a3b8',
                      }}
                    >
                      {f.ai_severity}
                    </span>
                  )}
                  {f.ai_module && (
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--ifm-color-emphasis-600)',
                        background: 'var(--ifm-color-emphasis-100)',
                        padding: '1px 8px',
                        borderRadius: 10,
                      }}
                    >
                      {f.ai_module}
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--ifm-color-emphasis-600)' }}>
                    {f.username ? '👤 ' + f.username : '👻 匿名'}
                  </span>
                  {(f.location || f.ip) && (
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--ifm-color-emphasis-600)',
                        background: 'var(--ifm-color-emphasis-100)',
                        padding: '1px 8px',
                        borderRadius: 10,
                      }}
                      title={
                        [f.ip ? `IP: ${f.ip}` : '', f.geo?.isp ? `ISP: ${f.geo.isp}` : '']
                          .filter(Boolean)
                          .join(' · ') || undefined
                      }
                    >
                      📍 {f.location || '未知'}
                      {f.ip ? ` · ${f.ip}` : ''}
                    </span>
                  )}
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 11,
                      color: 'var(--ifm-color-emphasis-500)',
                    }}
                  >
                    {fmtFeedbackTime(f.created_at)}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600 }}>
                    {STATUS_LABEL[f.status] || f.status}
                  </span>
                </div>

                {f.ai_summary && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--ifm-color-emphasis-700)',
                      marginTop: 6,
                      fontStyle: 'italic',
                    }}
                  >
                    🤖 {f.ai_summary}
                    {f.ai_reproducible ? ` · 可复现: ${f.ai_reproducible}` : ''}
                  </div>
                )}

                <div
                  style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6 }}
                >
                  {f.content}
                </div>

                {imgs.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {imgs.map((u, i) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer">
                        <img
                          src={u}
                          alt={`截图${i + 1}`}
                          style={{
                            width: 80,
                            height: 80,
                            objectFit: 'cover',
                            borderRadius: 6,
                            border: '1px solid var(--ifm-color-emphasis-200)',
                          }}
                        />
                      </a>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    marginTop: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  {['new', 'in_progress', 'resolved', 'dismissed'].map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatus(f.id, s)}
                      disabled={f.status === s}
                      style={{
                        fontSize: 11,
                        padding: '3px 10px',
                        borderRadius: 6,
                        cursor: f.status === s ? 'default' : 'pointer',
                        border: '1px solid var(--ifm-color-emphasis-300)',
                        background:
                          f.status === s ? 'var(--ifm-color-emphasis-200)' : 'transparent',
                        color:
                          f.status === s
                            ? 'var(--ifm-color-emphasis-500)'
                            : 'var(--ifm-color-emphasis-800)',
                        fontWeight: f.status === s ? 700 : 400,
                      }}
                    >
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                  <button
                    onClick={() => setExpanded(isOpen ? null : f.id)}
                    style={{
                      marginLeft: 'auto',
                      fontSize: 11,
                      padding: '3px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      border: '1px solid var(--ifm-color-emphasis-300)',
                      background: 'transparent',
                    }}
                  >
                    {isOpen ? '收起' : '详情 / 备注'}
                  </button>
                </div>

                {isOpen && (
                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: '1px dashed var(--ifm-color-emphasis-200)',
                      fontSize: 12,
                      color: 'var(--ifm-color-emphasis-700)',
                    }}
                  >
                    <div>
                      来源页:{' '}
                      <a href={f.page_url || '#'} target="_blank" rel="noreferrer">
                        {f.page_url || '<未提供>'}
                      </a>
                    </div>
                    {f.user_agent && (
                      <div style={{ marginTop: 4, wordBreak: 'break-all' }}>UA: {f.user_agent}</div>
                    )}
                    {f.ip && (
                      <div style={{ marginTop: 4 }}>
                        IP: {f.ip}
                        {f.location ? ` · 📍 ${f.location}` : ''}
                        {f.geo?.isp ? ` · ${f.geo.isp}` : ''}
                      </div>
                    )}
                    <div style={{ marginTop: 8 }}>
                      <textarea
                        defaultValue={f.admin_notes || ''}
                        placeholder="管理员备注（处理记录、关联 commit 等）"
                        rows={2}
                        style={{
                          width: '100%',
                          fontSize: 12,
                          padding: 8,
                          borderRadius: 6,
                          border: '1px solid var(--ifm-color-emphasis-300)',
                          background: 'var(--ifm-background-color)',
                          color: 'inherit',
                        }}
                        onBlur={(e) => {
                          if (e.target.value !== (f.admin_notes || ''))
                            saveNotes(f.id, e.target.value);
                        }}
                      />
                      <div style={{ fontSize: 10, color: 'var(--ifm-color-emphasis-500)' }}>
                        失焦自动保存
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const TAB_GROUPS = [
  {
    title: '运营数据',
    tabs: [
      { id: 'realtime' as Tab, label: '实时总览' },
      { id: 'trends' as Tab, label: '趋势' },
      { id: 'retention' as Tab, label: '留存' },
      { id: 'content' as Tab, label: '内容热度' },
      { id: 'funnel' as Tab, label: '行为漏斗' },
      { id: 'visitors' as Tab, label: '访客 IP' },
    ],
  },
  {
    title: '用户与治理',
    tabs: [
      { id: 'users' as Tab, label: '用户管理' },
      { id: 'feedbacks' as Tab, label: '用户反馈' },
      { id: 'ai' as Tab, label: 'AI 治理' },
      { id: 'usage' as Tab, label: 'AI 看板' },
    ],
  },
  {
    title: '运维',
    tabs: [
      { id: 'local' as Tab, label: '本地存储' },
      { id: 'compute' as Tab, label: '算力健康' },
      { id: 'assets' as Tab, label: '资产巡检' },
      { id: 'oss' as Tab, label: 'OSS' },
      { id: 'backup' as Tab, label: '备份' },
      { id: 'errors' as Tab, label: '错误日志' },
    ],
  },
];

// ---------- Main ----------
function AdminInner() {
  const [user, setUser] = useState(getStoredUser());
  const [tab, setTab] = useState<Tab>('realtime');

  useEffect(() => {
    return subscribeAuth((u) => setUser(u));
  }, []);

  // Open the tab named in the URL hash (e.g. Feishu deep-link /admin#feedbacks).
  useEffect(() => {
    const applyHash = () => {
      const h = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '');
      const valid = [
        'realtime',
        'trends',
        'retention',
        'content',
        'funnel',
        'visitors',
        'users',
        'feedbacks',
        'ai',
        'usage',
        'local',
        'compute',
        'assets',
        'oss',
        'backup',
        'errors',
      ];
      if (valid.includes(h)) setTab(h as Tab);
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  if (!user) {
    return (
      <div className={styles.notice}>
        <h2>需要登录</h2>
        <p>请先登录管理员账号才能查看运营数据。</p>
      </div>
    );
  }

  if (user.role !== 'admin') {
    return (
      <div className={styles.notice}>
        <h2>无权限</h2>
        <p>
          当前用户 <code>{user.username}</code> 不是管理员。
        </p>
      </div>
    );
  }

  const isOpTab = ['realtime', 'trends', 'retention', 'content', 'funnel', 'visitors'].includes(
    tab
  );
  const isStandaloneTab = tab === 'feedbacks';

  return (
    <div className={styles.wrapper}>
      <h1 className={styles.title}>BioF3 管理控制台</h1>

      <div className={styles.tabsContainer}>
        {TAB_GROUPS.map((group) => (
          <div key={group.title} className={styles.tabGroup}>
            <div className={styles.tabGroupTitle}>{group.title}</div>
            <div className={styles.tabs}>
              {group.tabs.map((t) => (
                <button
                  key={t.id}
                  className={`${styles.tabBtn} ${tab === t.id ? styles.tabBtnActive : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.tabContent}>
        {tab === 'realtime' && <RealtimeTab />}
        {tab === 'trends' && <TrendsTab />}
        {tab === 'retention' && <RetentionTab />}
        {tab === 'content' && <ContentTab />}
        {tab === 'funnel' && <FunnelTab />}
        {tab === 'visitors' && <VisitorsTab />}
        {tab === 'feedbacks' && <FeedbacksTab />}
        {!isOpTab && !isStandaloneTab && <AdminPanel embedded activeTab={tab as GovTab} />}
      </div>
    </div>
  );
}

export default function AdminPage(): React.ReactElement {
  return <AdminInner />;
}
