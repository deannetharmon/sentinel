// Pre-trade eligibility filters. Pure functions, no I/O.
import type { MetricRow } from '../tastytrade/client';

export interface FilterConfig {
  minIvRank: number; // premium selling needs rich IV
  minLiquidityRating: number;
  earningsBlockDays: number; // block if earnings within N days
  maxDataAgeMs: number;
}

export const DEFAULT_FILTERS: FilterConfig = {
  minIvRank: 30,
  minLiquidityRating: 3,
  earningsBlockDays: 14,
  maxDataAgeMs: 15 * 60 * 1000,
};

export interface Decision {
  symbol: string;
  eligible: boolean;
  reasons: string[]; // why blocked, or why passed
  metrics: MetricRow;
}

function daysUntil(dateStr: string, now: Date): number {
  const d = new Date(`${dateStr}T00:00:00Z`).getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((d - today) / 86400000);
}

export function evaluate(m: MetricRow, now: Date, cfg: FilterConfig = DEFAULT_FILTERS): Decision {
  const blocks: string[] = [];

  if (now.getTime() - new Date(m.fetchedAt).getTime() > cfg.maxDataAgeMs) {
    blocks.push('stale data');
  }
  if (m.ivRank === null) blocks.push('no IV rank');
  else if (m.ivRank < cfg.minIvRank) blocks.push(`IV rank ${m.ivRank} < ${cfg.minIvRank}`);

  if (m.liquidityRating !== null && m.liquidityRating < cfg.minLiquidityRating) {
    blocks.push(`liquidity ${m.liquidityRating} < ${cfg.minLiquidityRating}`);
  }
  if (m.earningsDate) {
    const d = daysUntil(m.earningsDate, now);
    if (d >= 0 && d <= cfg.earningsBlockDays) blocks.push(`earnings in ${d}d`);
  }

  return blocks.length
    ? { symbol: m.symbol, eligible: false, reasons: blocks, metrics: m }
    : { symbol: m.symbol, eligible: true, reasons: ['passed all filters'], metrics: m };
}
