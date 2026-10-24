// Read-only tastytrade client. Uses Sentinel's own OAuth app (env secrets only).

const API = 'https://api.tastyworks.com';
const UA = 'sentinel/0.1';

export interface MetricRow {
  symbol: string;
  ivRank: number | null; // 0-100, from implied-volatility-index-rank
  twIvRank: number | null; // 0-100, tastytrade's own rank, logged for comparison
  ivPercentile: number | null; // 0-100
  liquidityRating: number | null;
  beta: number | null;
  corrSpy3m: number | null;
  earningsDate: string | null; // YYYY-MM-DD, single stocks only
  fetchedAt: string;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n * 1000) / 10;
}

export function parseMetrics(payload: any, fetchedAt = new Date().toISOString()): MetricRow[] {
  const items: any[] = payload?.data?.items ?? [];
  return items.map((it) => ({
    symbol: String(it['symbol']),
    ivRank: pct(it['implied-volatility-index-rank']),
    twIvRank: pct(it['tw-implied-volatility-index-rank']),
    ivPercentile: pct(it['implied-volatility-percentile']),
    liquidityRating: num(it['liquidity-rating']),
    beta: num(it['beta']),
    corrSpy3m: num(it['corr-spy-3month']),
    earningsDate: it['earnings']?.['expected-report-date'] ?? null,
    fetchedAt,
  }));
}

export async function getAccessToken(): Promise<string> {
  const secret = process.env.TT_CLIENT_SECRET;
  const refresh = process.env.TT_REFRESH_TOKEN;
  if (!secret || !refresh) throw new Error('TT_CLIENT_SECRET / TT_REFRESH_TOKEN not set');
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_secret: secret,
      scope: 'read',
    }),
  });
  if (!res.ok) throw new Error(`tastytrade token refresh failed: ${res.status}`);
  const json: any = await res.json();
  if (!json.access_token) throw new Error('tastytrade token refresh returned no access_token');
  return json.access_token;
}

export async function fetchMarketMetrics(symbols: string[]): Promise<MetricRow[]> {
  if (symbols.length === 0) return [];
  const token = await getAccessToken();
  const url = `${API}/market-metrics?symbols=${encodeURIComponent(symbols.join(','))}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`market-metrics failed: ${res.status}`);
  return parseMetrics(await res.json());
}
