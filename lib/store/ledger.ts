// lib/store/ledger.ts
import type { PaperPosition } from '../paper/ledger';
import { redis } from './redis';

const POSITIONS = 'sentinel:positions';
const ACCOUNT = 'sentinel:account';

export const STARTING_EQUITY = 10_000;

export async function savePosition(p: PaperPosition, r = redis()): Promise<void> {
  await r.hset(POSITIONS, p.id, JSON.stringify(p));
}

export async function listPositions(r = redis()): Promise<PaperPosition[]> {
  const all = await r.hgetall(POSITIONS);
  return Object.values(all).map((s) => JSON.parse(s) as PaperPosition);
}

export interface AccountRow {
  startingEquity: number;
  peakEquity: number;
  halted: boolean;
}

export async function getAccount(r = redis()): Promise<AccountRow> {
  const raw = await r.get(ACCOUNT);
  return raw
    ? (JSON.parse(raw) as AccountRow)
    : { startingEquity: STARTING_EQUITY, peakEquity: STARTING_EQUITY, halted: false };
}

export async function saveAccount(a: AccountRow, r = redis()): Promise<void> {
  await r.set(ACCOUNT, JSON.stringify(a));
}

const TRADELOG = 'sentinel:tradelog';

export interface TradeLogEntry {
  at: string;
  type: 'OPEN' | 'CLOSE' | 'SKIP' | 'INFO';
  symbol: string;
  message: string;
  positionId?: string;
  pnl?: number;
}

export async function logTrade(e: TradeLogEntry, r = redis()): Promise<void> {
  await r.lpush(TRADELOG, JSON.stringify(e));
  await r.ltrim(TRADELOG, 0, 499);
}

export async function recentTrades(n = 50, r = redis()): Promise<TradeLogEntry[]> {
  return (await r.lrange(TRADELOG, 0, n - 1)).map((s) => JSON.parse(s) as TradeLogEntry);
}
