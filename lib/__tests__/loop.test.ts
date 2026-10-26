// lib/__tests__/loop.test.ts
import { describe, it, expect } from 'vitest';
import { chain, NOW } from './fixtures';
import { runTradeCycle, type TradeDeps } from '../trade/loop';
import type { PaperPosition } from '../paper/ledger';
import type { AccountRow, TradeLogEntry } from '../store/ledger';
import type { OptionQuote } from '../trading/types';

function harness(over: Partial<TradeDeps> = {}, account: Partial<AccountRow> = {}) {
  const positions = new Map<string, PaperPosition>();
  const logs: TradeLogEntry[] = [];
  const acct: AccountRow = { startingEquity: 10_000, peakEquity: 10_000, halted: false, ...account };
  let n = 0;
  const c = chain();
  const bySymbol = new Map<string, OptionQuote>(c.quotes.map((q) => [q.symbol, q]));
  const deps: TradeDeps = {
    now: () => NOW,
    eligibleSymbols: async () => ['SPY'],
    earningsInDays: () => null,
    fetchChain: async () => c,
    fetchLegQuotes: async (syms) => new Map(syms.flatMap((s) => (bySymbol.has(s) ? [[s, bySymbol.get(s)!] as const] : []))),
    fetchUnderlying: async () => 500,
    listPositions: async () => [...positions.values()],
    savePosition: async (p) => { positions.set(p.id, p); },
    getAccount: async () => acct,
    saveAccount: async (a) => { Object.assign(acct, a); },
    log: async (e) => { logs.push(e); },
    newId: () => `p${++n}`,
    ...over,
  };
  return { deps, positions, logs, bySymbol, acct };
}

describe('runTradeCycle', () => {
  it('opens one paper position when entries are allowed', async () => {
    const h = harness();
    const r = await runTradeCycle(h.deps, { entriesAllowed: true });
    expect(r.opened).toBe(1);
    const p = [...h.positions.values()][0];
    expect(p.status).toBe('OPEN');
    expect(p.maxLoss).toBeLessThanOrEqual(300);
    expect(h.logs.some((l) => l.type === 'OPEN')).toBe(true);
  });

  it('does not open outside the entry window', async () => {
    const h = harness();
    const r = await runTradeCycle(h.deps, { entriesAllowed: false });
    expect(r.opened).toBe(0);
    expect(h.positions.size).toBe(0);
  });

  it('does not open a second position in the same underlying', async () => {
    const h = harness();
    await runTradeCycle(h.deps, { entriesAllowed: true });
    const r2 = await runTradeCycle(h.deps, { entriesAllowed: true });
    expect(r2.opened).toBe(0);
    expect(h.positions.size).toBe(1);
  });

  it('respects the kill switch', async () => {
    const h = harness({}, { halted: true });
    const r = await runTradeCycle(h.deps, { entriesAllowed: true });
    expect(r.opened).toBe(0);
    expect(h.logs.some((l) => /kill switch/.test(l.message))).toBe(true);
  });

  it('closes at the profit target and books P&L', async () => {
    const h = harness();
    await runTradeCycle(h.deps, { entriesAllowed: true });
    const p = [...h.positions.values()][0];
    // option prices decay to 30% of their value
    for (const [sym, q] of h.bySymbol) {
      h.bySymbol.set(sym, { ...q, bid: q.bid * 0.3, ask: q.ask * 0.3 });
    }
    const r = await runTradeCycle(h.deps, { entriesAllowed: false });
    expect(r.closed).toBe(1);
    const closed = h.positions.get(p.id)!;
    expect(closed.status).toBe('CLOSED');
    expect(closed.realizedPnl).toBeGreaterThan(0);
    expect(r.netLiq).toBeGreaterThan(10_000);
  });

  it('holds when quotes are missing', async () => {
    const h = harness();
    await runTradeCycle(h.deps, { entriesAllowed: true });
    h.deps.fetchLegQuotes = async () => new Map();
    const r = await runTradeCycle(h.deps, { entriesAllowed: false });
    expect(r.closed).toBe(0);
    expect(r.skipped).toBe(1);
  });
});
