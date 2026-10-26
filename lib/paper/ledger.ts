// lib/paper/ledger.ts
// Simulated positions with a pessimistic fill model. Pure functions; persistence is in lib/store/ledger.ts.
import { type OptionQuote, type SpreadCandidate, type Strategy, fillPrice, round2 } from '../trading/types';

export interface PaperPosition {
  id: string;
  underlying: string;
  strategy: Strategy;
  expiration: string;
  shortStrike: number;
  longStrike: number;
  shortSymbol: string;
  longSymbol: string;
  right: 'P' | 'C';
  contracts: number;
  openCredit: number; // per share, modeled fill
  width: number;
  maxLoss: number; // dollars, total
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt?: string;
  closeDebit?: number;
  closeReason?: string;
  realizedPnl?: number;
}

export function openPosition(c: SpreadCandidate, contracts: number, now: Date, id: string): PaperPosition {
  return {
    id,
    underlying: c.underlying,
    strategy: c.strategy,
    expiration: c.expiration,
    shortStrike: c.short.strike,
    longStrike: c.long.strike,
    shortSymbol: c.short.symbol,
    longSymbol: c.long.symbol,
    right: c.short.right,
    contracts,
    openCredit: c.creditFill,
    width: c.width,
    maxLoss: round2(c.maxLossPerContract * contracts),
    status: 'OPEN',
    openedAt: now.toISOString(),
  };
}

// Debit to close right now, modeled pessimistically: buy back the short at its ask side, sell the long at its bid side.
export function closeDebit(shortQ: OptionQuote, longQ: OptionQuote, k = 0.75): number {
  return round2(Math.max(0, fillPrice(shortQ, 'BUY', k) - fillPrice(longQ, 'SELL', k)));
}

export function unrealizedPnl(p: PaperPosition, debit: number): number {
  return round2((p.openCredit - debit) * 100 * p.contracts);
}

export function closePosition(p: PaperPosition, debit: number, reason: string, now: Date): PaperPosition {
  const capped = Math.min(debit, p.width); // a spread can never cost more than its width
  return {
    ...p,
    status: 'CLOSED',
    closedAt: now.toISOString(),
    closeDebit: capped,
    closeReason: reason,
    realizedPnl: unrealizedPnl(p, capped),
  };
}
