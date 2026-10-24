import { describe, it, expect } from 'vitest';
import { evaluate } from '../rules/filters';
import { parseMetrics } from '../tastytrade/client';
import { runScan } from '../scan/run';

const NOW = new Date('2026-10-26T15:00:00Z');
const base = {
  symbol: 'SPY', ivRank: 50, twIvRank: 35, ivPercentile: 60, liquidityRating: 4,
  beta: 1, corrSpy3m: 1, earningsDate: null, fetchedAt: NOW.toISOString(),
};

describe('evaluate', () => {
  it('passes a healthy ticker', () => expect(evaluate(base, NOW).eligible).toBe(true));
  it('blocks low IV rank', () => expect(evaluate({ ...base, ivRank: 10 }, NOW).eligible).toBe(false));
  it('blocks missing IV rank', () => expect(evaluate({ ...base, ivRank: null }, NOW).reasons).toContain('no IV rank'));
  it('blocks earnings within 14 days', () => {
    const d = evaluate({ ...base, earningsDate: '2026-10-30' }, NOW);
    expect(d.eligible).toBe(false);
    expect(d.reasons[0]).toMatch(/earnings in 4d/);
  });
  it('allows earnings far out', () => expect(evaluate({ ...base, earningsDate: '2026-12-01' }, NOW).eligible).toBe(true));
  it('blocks stale data', () =>
    expect(evaluate({ ...base, fetchedAt: '2026-10-26T14:00:00Z' }, NOW).reasons).toContain('stale data'));
  it('blocks poor liquidity', () => expect(evaluate({ ...base, liquidityRating: 1 }, NOW).eligible).toBe(false));
});

describe('parseMetrics', () => {
  it('converts fractions to percent', () => {
    const rows = parseMetrics({ data: { items: [{ symbol: 'SPY', 'implied-volatility-index-rank': '0.519', 'liquidity-rating': 4 }] } });
    expect(rows[0].ivRank).toBe(51.9);
    expect(rows[0].liquidityRating).toBe(4);
    expect(rows[0].earningsDate).toBeNull();
  });
});

describe('runScan', () => {
  it('logs decisions and reports missing symbols', async () => {
    const logged: unknown[] = [];
    const r = await runScan({
      getTickers: async () => ['SPY', 'ZZZ'],
      fetchMetrics: async () => [base],
      logDecisions: async (ds) => { logged.push(...ds); },
      now: () => NOW,
    });
    expect(r.missing).toEqual(['ZZZ']);
    expect(logged).toHaveLength(1);
  });
  it('does nothing with an empty ticker list', async () => {
    const r = await runScan({
      getTickers: async () => [],
      fetchMetrics: async () => { throw new Error('should not call'); },
      logDecisions: async () => {},
      now: () => NOW,
    });
    expect(r.decisions).toEqual([]);
  });
});
