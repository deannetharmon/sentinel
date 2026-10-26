// lib/tastytrade/chain.ts
// Option chain + quotes over REST, following the response shapes TradeEdge already uses in production.
import { getAccessToken } from './client';
import { type ChainSnapshot, type OptionQuote, type Right, dteOf } from '../trading/types';

const API = 'https://api.tastyworks.com';
const UA = 'sentinel/0.1';

async function ttGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`tastytrade GET ${path.split('?')[0]} failed: ${res.status}`);
  return res.json();
}

export interface OptionMeta {
  symbol: string;
  right: Right;
  strike: number;
  expiration: string;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

// Pick the expiration closest to targetDte inside [minDte, maxDte] and list strikes within +/- band of price.
export function parseNested(
  payload: any, price: number, now: Date,
  opts: { minDte: number; maxDte: number; targetDte: number; band: number },
): OptionMeta[] {
  const exps: any[] = payload?.data?.items?.[0]?.expirations ?? [];
  const inWindow = exps
    .map((e) => ({ e, date: String(e['expiration-date'] ?? ''), dte: dteOf(String(e['expiration-date'] ?? ''), now) }))
    .filter((x) => x.date && x.dte >= opts.minDte && x.dte <= opts.maxDte)
    .sort((a, b) => Math.abs(a.dte - opts.targetDte) - Math.abs(b.dte - opts.targetDte));
  if (!inWindow.length) return [];
  const { e, date } = inWindow[0];
  const lo = price * (1 - opts.band);
  const hi = price * (1 + opts.band);
  const out: OptionMeta[] = [];
  for (const s of e.strikes ?? []) {
    const strike = num(s['strike-price']);
    if (strike === null || strike < lo || strike > hi) continue;
    if (s.put) out.push({ symbol: s.put, right: 'P', strike, expiration: date });
    if (s.call) out.push({ symbol: s.call, right: 'C', strike, expiration: date });
  }
  return out;
}

export function parseOptionQuotes(payload: any, meta: Map<string, OptionMeta>, fetchedAt: string): OptionQuote[] {
  const out: OptionQuote[] = [];
  for (const it of payload?.data?.items ?? []) {
    const m = meta.get(it.symbol);
    if (!m) continue;
    const bid = num(it.bid);
    const ask = num(it.ask);
    if (bid === null || ask === null) continue;
    out.push({
      symbol: m.symbol, right: m.right, strike: m.strike, expiration: m.expiration,
      bid, ask,
      delta: num(it.delta) ?? 0,
      openInterest: num(it['open-interest']) ?? 0,
      quotedAt: typeof it['updated-at'] === 'string' ? it['updated-at'] : fetchedAt,
    });
  }
  return out;
}

export function parseUnderlyingPrice(payload: any): number | null {
  const it = payload?.data?.items?.[0];
  if (!it) return null;
  const bid = num(it.bid);
  const ask = num(it.ask);
  return num(it.mark) ?? (bid !== null && ask !== null && ask >= bid ? (bid + ask) / 2 : null) ?? num(it.last);
}

async function quotesFor(symbols: string[], token: string): Promise<any[]> {
  const items: any[] = [];
  for (let i = 0; i < symbols.length; i += 100) {
    const qs = symbols.slice(i, i + 100).map((s) => `equity-option=${encodeURIComponent(s)}`).join('&');
    const json = await ttGet(`/market-data/by-type?${qs}`, token);
    items.push(...(json?.data?.items ?? []));
  }
  return items;
}

export async function fetchUnderlyingPrice(symbol: string, token?: string): Promise<number> {
  const t = token ?? (await getAccessToken());
  const price = parseUnderlyingPrice(await ttGet(`/market-data/by-type?equity=${encodeURIComponent(symbol)}`, t));
  if (price === null || price <= 0) throw new Error(`no price for ${symbol}`);
  return price;
}

export async function fetchChainSnapshot(
  symbol: string, now: Date,
  opts = { minDte: 30, maxDte: 45, targetDte: 38, band: 0.15 },
): Promise<ChainSnapshot> {
  const token = await getAccessToken();
  const price = await fetchUnderlyingPrice(symbol, token);
  const nested = await ttGet(`/option-chains/${encodeURIComponent(symbol)}/nested`, token);
  const metas = parseNested(nested, price, now, opts);
  const meta = new Map(metas.map((m) => [m.symbol, m]));
  const fetchedAt = new Date().toISOString();
  const items = await quotesFor([...meta.keys()], token);
  return { underlying: symbol, price, asOf: fetchedAt, quotes: parseOptionQuotes({ data: { items } }, meta, fetchedAt) };
}

// Current quotes for specific option symbols (open positions).
export async function fetchLegQuotes(symbols: string[]): Promise<Map<string, OptionQuote>> {
  const token = await getAccessToken();
  const fetchedAt = new Date().toISOString();
  const items = await quotesFor(symbols, token);
  const out = new Map<string, OptionQuote>();
  for (const it of items) {
    const bid = num(it.bid);
    const ask = num(it.ask);
    if (bid === null || ask === null) continue;
    out.set(it.symbol, {
      symbol: it.symbol, right: 'P', strike: 0, expiration: '', bid, ask,
      delta: num(it.delta) ?? 0, openInterest: num(it['open-interest']) ?? 0,
      quotedAt: typeof it['updated-at'] === 'string' ? it['updated-at'] : fetchedAt,
    });
  }
  return out;
}
