// lib/trading/types.ts
export type Right = 'P' | 'C';
export type Strategy = 'PUT_CREDIT_SPREAD' | 'CALL_CREDIT_SPREAD';
export type Trend = 'UP' | 'DOWN' | 'NEUTRAL';

export interface OptionQuote {
  symbol: string; // option symbol
  right: Right;
  strike: number;
  expiration: string; // YYYY-MM-DD
  bid: number;
  ask: number;
  delta: number; // signed, as reported
  openInterest: number;
  quotedAt: string; // ISO
}

export interface ChainSnapshot {
  underlying: string;
  price: number;
  asOf: string; // ISO
  quotes: OptionQuote[];
}

export interface SpreadCandidate {
  underlying: string;
  strategy: Strategy;
  expiration: string;
  dte: number;
  short: OptionQuote;
  long: OptionQuote;
  width: number;
  creditMid: number; // per share
  creditFill: number; // per share, pessimistic modeled fill
  maxLossPerContract: number; // dollars
}

export function dteOf(expiration: string, now: Date): number {
  const exp = new Date(`${expiration}T00:00:00Z`).getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((exp - today) / 86400000);
}

export const mid = (q: OptionQuote) => (q.bid + q.ask) / 2;
export const round2 = (n: number) => Math.round(n * 100) / 100;

// k=1 fills at the natural price (sell at bid, buy at ask); k=0 fills at mid.
export function fillPrice(q: OptionQuote, side: 'SELL' | 'BUY', k: number): number {
  const half = (q.ask - q.bid) / 2;
  return side === 'SELL' ? mid(q) - k * half : mid(q) + k * half;
}
