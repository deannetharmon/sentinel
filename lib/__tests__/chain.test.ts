// lib/__tests__/chain.test.ts
import { describe, it, expect } from 'vitest';
import { parseNested, parseOptionQuotes, parseUnderlyingPrice } from '../tastytrade/chain';
import { inEntryWindow, isMarketOpen } from '../time/market';

const NOW = new Date('2026-10-26T15:00:00Z');
const nested = {
  data: {
    items: [{
      expirations: [
        { 'expiration-date': '2026-11-06', strikes: [{ 'strike-price': '500', call: 'C-NEAR', put: 'P-NEAR' }] },
        {
          'expiration-date': '2026-12-03',
          strikes: [
            { 'strike-price': '300', call: 'C300', put: 'P300' },
            { 'strike-price': '480', call: 'C480', put: 'P480' },
            { 'strike-price': '520', call: 'C520', put: 'P520' },
          ],
        },
      ],
    }],
  },
};

describe('parseNested', () => {
  it('picks the expiration in the DTE window and filters strikes to the band', () => {
    const m = parseNested(nested, 500, NOW, { minDte: 30, maxDte: 45, targetDte: 38, band: 0.15 });
    expect(m.map((x) => x.symbol).sort()).toEqual(['C480', 'C520', 'P480', 'P520']);
    expect(m.every((x) => x.expiration === '2026-12-03')).toBe(true);
  });
  it('returns nothing when no expiration fits', () => {
    expect(parseNested(nested, 500, NOW, { minDte: 60, maxDte: 90, targetDte: 70, band: 0.15 })).toEqual([]);
  });
});

describe('parseOptionQuotes', () => {
  const meta = new Map([['P480', { symbol: 'P480', right: 'P' as const, strike: 480, expiration: '2026-12-03' }]]);
  it('reads bid, ask, delta and open interest from dasherized fields', () => {
    const q = parseOptionQuotes(
      { data: { items: [{ symbol: 'P480', bid: '2.10', ask: '2.20', delta: '-0.21', 'open-interest': '1500' }] } },
      meta, NOW.toISOString(),
    );
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ bid: 2.1, ask: 2.2, delta: -0.21, openInterest: 1500, strike: 480, right: 'P' });
  });
  it('skips rows without a two-sided quote and unknown symbols', () => {
    const q = parseOptionQuotes(
      { data: { items: [{ symbol: 'P480', bid: '2.10' }, { symbol: 'X', bid: '1', ask: '2' }] } },
      meta, NOW.toISOString(),
    );
    expect(q).toEqual([]);
  });
});

describe('parseUnderlyingPrice', () => {
  it('prefers mark, then mid, then last', () => {
    expect(parseUnderlyingPrice({ data: { items: [{ mark: '500.5' }] } })).toBe(500.5);
    expect(parseUnderlyingPrice({ data: { items: [{ bid: '500', ask: '501' }] } })).toBe(500.5);
    expect(parseUnderlyingPrice({ data: { items: [{ last: '499' }] } })).toBe(499);
    expect(parseUnderlyingPrice({ data: { items: [] } })).toBeNull();
  });
});

describe('market time', () => {
  it('knows the regular session and entry windows (ET)', () => {
    expect(isMarketOpen(new Date('2026-10-26T14:00:00Z'))).toBe(true); // 10:00 ET Mon
    expect(isMarketOpen(new Date('2026-10-24T14:00:00Z'))).toBe(false); // Saturday
    expect(inEntryWindow(new Date('2026-10-26T14:30:00Z'))).toBe(true); // 10:30 ET
    expect(inEntryWindow(new Date('2026-10-26T17:00:00Z'))).toBe(false); // 13:00 ET
    expect(inEntryWindow(new Date('2026-10-26T18:30:00Z'))).toBe(true); // 14:30 ET
  });
});
