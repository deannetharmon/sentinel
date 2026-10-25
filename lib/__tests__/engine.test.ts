// lib/__tests__/engine.test.ts
import { describe, it, expect } from 'vitest';
import { chain, NOW } from './fixtures';
import { selectSpread } from '../trading/select';
import { riskGate, type AccountState } from '../risk/gate';
import { closePosition, openPosition, unrealizedPnl } from '../paper/ledger';
import { evaluateExit } from '../exit/rules';

const acct = (over: Partial<AccountState> = {}): AccountState => ({
  netLiq: 10_000, peakEquity: 10_000, realizedToday: 0, open: [], halted: false, ...over,
});

function pick(trend: 'UP' | 'DOWN' | 'NEUTRAL' = 'UP') {
  const r = selectSpread(chain(), trend, NOW);
  if (!r.candidate) throw new Error(`no candidate: ${r.reasons.join('; ')}`);
  return r.candidate;
}

describe('selectSpread', () => {
  it('uptrend -> put credit spread near 18 delta, sized under the loss cap', () => {
    const c = pick('UP');
    expect(c.strategy).toBe('PUT_CREDIT_SPREAD');
    expect(c.short.strike).toBe(470);
    expect(c.long.strike).toBeLessThan(470);
    expect(c.width).toBe(3);
    expect(c.maxLossPerContract).toBeLessThanOrEqual(300);
    expect(c.creditFill).toBeGreaterThan(0);
    expect(c.creditFill).toBeLessThanOrEqual(c.creditMid);
    expect(c.dte).toBe(38);
  });
  it('downtrend -> call credit spread', () => {
    const c = pick('DOWN');
    expect(c.strategy).toBe('CALL_CREDIT_SPREAD');
    expect(c.short.strike).toBe(530);
    expect(c.long.strike).toBeGreaterThan(530);
  });
  it('neutral returns one of the two', () => {
    expect(['PUT_CREDIT_SPREAD', 'CALL_CREDIT_SPREAD']).toContain(pick('NEUTRAL').strategy);
  });
  it('refuses stale quotes', () => {
    const later = new Date(NOW.getTime() + 5 * 60_000);
    const r = selectSpread(chain(), 'UP', later);
    expect(r.candidate).toBeNull();
    expect(r.reasons).toContain('stale quotes');
  });
  it('refuses when no expiration is in the DTE window', () => {
    const r = selectSpread(chain({ expiration: '2027-03-19' }), 'UP', NOW);
    expect(r.candidate).toBeNull();
    expect(r.reasons[0]).toMatch(/no expiration/);
  });
  it('refuses thin open interest', () => {
    const r = selectSpread(chain({ oi: 10 }), 'UP', NOW);
    expect(r.candidate).toBeNull();
  });
});

describe('riskGate', () => {
  it('allows a clean entry at 1 contract', () => {
    const g = riskGate(pick(), acct());
    expect(g.allowed).toBe(true);
    expect(g.contracts).toBe(1);
  });
  it('blocks when the kill switch is on', () => expect(riskGate(pick(), acct({ halted: true })).allowed).toBe(false));
  it('blocks a second position in the same underlying', () =>
    expect(riskGate(pick(), acct({ open: [{ underlying: 'SPY', maxLoss: 100 }] })).reasons[0]).toMatch(/already have/));
  it('blocks at max positions', () =>
    expect(
      riskGate(pick(), acct({ open: ['A', 'B', 'C', 'D', 'E', 'F'].map((u) => ({ underlying: u, maxLoss: 50 })) })).allowed,
    ).toBe(false));
  it('blocks when the correlated cluster is full', () => {
    const g = riskGate(pick(), acct({ open: [{ underlying: 'IWM', maxLoss: 700 }] }));
    expect(g.allowed).toBe(false);
    expect(g.reasons[0]).toMatch(/cluster/);
  });
  it('blocks after the daily loss limit', () => expect(riskGate(pick(), acct({ realizedToday: -300 })).allowed).toBe(false));
  it('blocks on 10% drawdown', () => expect(riskGate(pick(), acct({ netLiq: 8_900 })).allowed).toBe(false));
  it('blocks when the per-position cap is smaller than the trade risk', () =>
    expect(riskGate(pick(), acct({ netLiq: 5_000, peakEquity: 5_000 })).allowed).toBe(false));
});

describe('paper ledger', () => {
  it('opens at the modeled fill and books P&L on close', () => {
    const c = pick();
    const p = openPosition(c, 1, NOW, 't1');
    expect(p.openCredit).toBe(c.creditFill);
    expect(p.maxLoss).toBe(c.maxLossPerContract);
    expect(unrealizedPnl(p, p.openCredit)).toBe(0);
    const closed = closePosition(p, p.openCredit / 2, 'profit target', NOW);
    expect(closed.status).toBe('CLOSED');
    expect(closed.realizedPnl).toBeCloseTo(p.openCredit * 50, 1);
  });
  it('never loses more than max loss', () => {
    const p = openPosition(pick(), 1, NOW, 't2');
    const closed = closePosition(p, 99, 'blown through', NOW);
    expect(closed.realizedPnl).toBeCloseTo(-p.maxLoss, 1);
  });
});

describe('exit rules', () => {
  const p = openPosition(pick(), 1, NOW, 't3');
  const base = { position: p, debit: p.openCredit * 0.8, underlyingPrice: 500, dte: 30, earningsInDays: null };
  it('holds a normal position', () => expect(evaluateExit(base).close).toBe(false));
  it('takes 50% profit', () => expect(evaluateExit({ ...base, debit: p.openCredit * 0.5 }).reason).toMatch(/profit/));
  it('stops at 2x loss', () => expect(evaluateExit({ ...base, debit: p.openCredit * 3 }).reason).toMatch(/stop/));
  it('exits when the short strike is tested', () =>
    expect(evaluateExit({ ...base, underlyingPrice: p.shortStrike }).reason).toMatch(/tested/));
  it('exits at 21 DTE', () => expect(evaluateExit({ ...base, dte: 21 }).reason).toMatch(/21 DTE/));
  it('exits before earnings', () => expect(evaluateExit({ ...base, earningsInDays: 1 }).reason).toMatch(/earnings/));
});
