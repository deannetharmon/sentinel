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
