// Sentinel's own Redis state. All keys are prefixed so it can share an instance safely.
import Redis from 'ioredis';
import type { Decision } from '../rules/filters';

const P = 'sentinel:';
export const KEYS = {
  tickers: `${P}tickers`,
  decisions: `${P}decisions`,
  lastScan: `${P}lastScan`,
  scanLock: `${P}lock:scan`,
};

let client: Redis | null = null;
export function redis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL not set');
    client = new Redis(url, { maxRetriesPerRequest: 2 });
  }
  return client;
}

export function normalizeTickers(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const t of input) {
    const s = String(t).trim().toUpperCase();
    if (/^[A-Z.]{1,6}$/.test(s)) out.add(s);
  }
  return [...out];
}

// Starting list, used until Dean sets his own via /api/tickers.
export const DEFAULT_TICKERS = ['SPY', 'IWM', 'XLF', 'AAPL', 'NVDA', 'MRVL'];

export async function getTickers(r = redis()): Promise<string[]> {
  const raw = await r.get(KEYS.tickers);
  return raw ? normalizeTickers(JSON.parse(raw)) : DEFAULT_TICKERS;
}

export async function setTickers(list: string[], r = redis()): Promise<string[]> {
  const clean = normalizeTickers(list);
  await r.set(KEYS.tickers, JSON.stringify(clean));
  return clean;
}

export async function logDecisions(ds: Decision[], at: string, r = redis()): Promise<void> {
  if (!ds.length) return;
  const rows = ds.map((d) => JSON.stringify({ at, ...d }));
  await r.lpush(KEYS.decisions, ...rows);
  await r.ltrim(KEYS.decisions, 0, 999);
}

export async function recentDecisions(n = 50, r = redis()): Promise<unknown[]> {
  return (await r.lrange(KEYS.decisions, 0, n - 1)).map((s) => JSON.parse(s));
}

export async function acquireScanLock(ttlSec = 120, r = redis()): Promise<boolean> {
  return (await r.set(KEYS.scanLock, '1', 'EX', ttlSec, 'NX')) === 'OK';
}
export async function releaseScanLock(r = redis()): Promise<void> {
  await r.del(KEYS.scanLock);
}
